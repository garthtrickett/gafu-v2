import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { acquireDatabaseLock } from "../recovery/database-lock.ts";
import { err, ok, type Result } from "../result.ts";
import type { CardState } from "../study/contracts.ts";

export type MarkImportKnownFailure =
  | { readonly kind: "invalidImportKey" }
  | { readonly kind: "databaseMissing" }
  | { readonly kind: "databaseInUse" }
  | { readonly kind: "importNotFound" }
  | { readonly kind: "importHasNoCards" }
  | { readonly kind: "importInconsistent" }
  | { readonly kind: "databaseInvalid" }
  | { readonly kind: "writeFailed"; readonly detail: string };

export type MarkImportKnownReceipt = Readonly<{
  sourceItems: number;
  uniqueCards: number;
  changedCards: number;
  alreadyKnownCards: number;
  statesBefore: Readonly<Record<CardState, number>>;
  knownCardsAfter: number;
  schedulesPreserved: number;
  reviewsPreserved: number;
  quarantinesPreserved: number;
}>;

class ImportPostconditionFailure extends Error {}

const count = (database: Database, sql: string, importKey?: string): number => {
  const row = (
    importKey === undefined
      ? database.query(sql).get()
      : database.query(sql).get(importKey)
  ) as { count: number };
  return row.count;
};

const imported = (suffix: string): string =>
  `SELECT count(DISTINCT p.card_id) AS count
   FROM card_progress p
   JOIN legacy_import_item i ON i.card_id = p.card_id
   WHERE i.import_key = ? ${suffix}`;

const stateCounts = (
  database: Database,
  importKey: string,
): Readonly<Record<CardState, number>> => {
  const rows = database
    .query(
      `SELECT p.state, count(DISTINCT p.card_id) AS count
       FROM card_progress p
       JOIN legacy_import_item i ON i.card_id = p.card_id
       WHERE i.import_key = ?
       GROUP BY p.state`,
    )
    .all(importKey) as { state: CardState; count: number }[];
  const result: Record<CardState, number> = {
    staged: 0,
    active: 0,
    known: 0,
    suspended: 0,
  };
  for (const row of rows) result[row.state] = row.count;
  return result;
};

export const markImportedCardsKnown = (command: {
  readonly databasePath: string;
  readonly importKey: string;
  readonly now: Date;
}): Result<MarkImportKnownReceipt, MarkImportKnownFailure> => {
  const importKey = command.importKey.trim();
  if (importKey === "" || importKey.length > 256) {
    return err({ kind: "invalidImportKey" });
  }
  if (!existsSync(command.databasePath)) return err({ kind: "databaseMissing" });
  if (!Number.isFinite(command.now.getTime())) return err({ kind: "databaseInvalid" });

  const lock = acquireDatabaseLock(command.databasePath);
  if (!lock.ok) return err({ kind: "databaseInUse" });
  let database: Database | null = null;
  try {
    database = new Database(command.databasePath, { strict: true });
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const integrity = database.query("PRAGMA quick_check").get() as {
      quick_check: string;
    };
    if (integrity.quick_check !== "ok") return err({ kind: "databaseInvalid" });

    const importReceipt = database
      .query("SELECT 1 AS present FROM legacy_import WHERE import_key = ?")
      .get(importKey) as { present: number } | null;
    if (importReceipt === null) return err({ kind: "importNotFound" });

    const sourceItems = count(
      database,
      "SELECT count(*) AS count FROM legacy_import_item WHERE import_key = ?",
      importKey,
    );
    const uniqueCards = count(database, imported(""), importKey);
    if (uniqueCards === 0) return err({ kind: "importHasNoCards" });
    const linkedCards = count(
      database,
      `SELECT count(DISTINCT card_id) AS count FROM legacy_import_item
       WHERE import_key = ? AND card_id IS NOT NULL`,
      importKey,
    );
    if (linkedCards !== uniqueCards) return err({ kind: "importInconsistent" });

    const statesBefore = stateCounts(database, importKey);
    const changedCards = uniqueCards - statesBefore.known;
    const schedulesBefore = count(
      database,
      `SELECT count(*) AS count FROM schedule s
       WHERE s.card_id IN (
         SELECT card_id FROM legacy_import_item WHERE import_key = ? AND card_id IS NOT NULL
       )`,
      importKey,
    );
    const reviewsBefore = count(
      database,
      `SELECT count(*) AS count FROM review_event r
       WHERE r.card_id IN (
         SELECT card_id FROM legacy_import_item WHERE import_key = ? AND card_id IS NOT NULL
       )`,
      importKey,
    );
    const quarantinesBefore = count(
      database,
      "SELECT count(*) AS count FROM legacy_quarantine WHERE import_key = ?",
      importKey,
    );

    const connection = database;
    const update = connection.transaction((): MarkImportKnownReceipt => {
      connection
        .query(
          `UPDATE card_progress
           SET known_return_state = CASE
                 WHEN state = 'known' THEN coalesce(known_return_state, 'staged')
                 WHEN state = 'suspended' THEN coalesce(suspended_return_state, 'staged')
                 ELSE state
               END,
               state = 'known',
               suspended_return_state = NULL,
               support_ready_at = coalesce(support_ready_at, ?)
           WHERE card_id IN (
             SELECT card_id FROM legacy_import_item
             WHERE import_key = ? AND card_id IS NOT NULL
           )`,
        )
        .run(command.now.toISOString(), importKey);

      const knownCardsAfter = count(
        connection,
        imported("AND p.state = 'known'"),
        importKey,
      );
      const schedulesAfter = count(
        connection,
        `SELECT count(*) AS count FROM schedule s
         WHERE s.card_id IN (
           SELECT card_id FROM legacy_import_item WHERE import_key = ? AND card_id IS NOT NULL
         )`,
        importKey,
      );
      const reviewsAfter = count(
        connection,
        `SELECT count(*) AS count FROM review_event r
         WHERE r.card_id IN (
           SELECT card_id FROM legacy_import_item WHERE import_key = ? AND card_id IS NOT NULL
         )`,
        importKey,
      );
      const quarantinesAfter = count(
        connection,
        "SELECT count(*) AS count FROM legacy_quarantine WHERE import_key = ?",
        importKey,
      );
      const foreignKeys = connection.query("PRAGMA foreign_key_check").all();
      if (
        knownCardsAfter !== uniqueCards ||
        schedulesAfter !== schedulesBefore ||
        reviewsAfter !== reviewsBefore ||
        quarantinesAfter !== quarantinesBefore ||
        foreignKeys.length !== 0
      ) {
        throw new ImportPostconditionFailure();
      }

      return {
        sourceItems,
        uniqueCards,
        changedCards,
        alreadyKnownCards: statesBefore.known,
        statesBefore,
        knownCardsAfter,
        schedulesPreserved: schedulesAfter,
        reviewsPreserved: reviewsAfter,
        quarantinesPreserved: quarantinesAfter,
      };
    });
    return ok(update.immediate());
  } catch (cause) {
    if (cause instanceof ImportPostconditionFailure) {
      return err({ kind: "importInconsistent" });
    }
    return err({
      kind: "writeFailed",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    database?.close();
    lock.value.release();
  }
};
