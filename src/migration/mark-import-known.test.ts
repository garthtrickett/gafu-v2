import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v1Snapshot } from "../../tests/fixtures/migration/v1.ts";
import { acquireDatabaseLock } from "../recovery/database-lock.ts";
import { markImportedCardsKnown } from "./mark-import-known.ts";
import { createV1Migration, initializeMigrationDestination } from "./v1-migration.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-known-cutover-"));
  directories.push(directory);
  const databasePath = join(directory, "study.sqlite");
  const now = new Date("2026-09-09T12:00:00.000Z");
  let id = 0;
  const nextId = () => `known-cutover-${++id}`;
  const migration = createV1Migration({
    clock: () => now,
    nextId,
    initializeDestination: (path) =>
      initializeMigrationDestination(path, () => now, nextId),
  });
  const applied = migration.apply({
    importKey: "owner-cutover",
    snapshotBytes: v1Snapshot(),
    destinationPath: databasePath,
  });
  if (!applied.ok) throw new Error(applied.error.kind);
  return { databasePath, now };
};

describe("mark imported Cards known", () => {
  test("marks only imported Cards known while preserving imported evidence", () => {
    const context = setup();
    const before = new Database(context.databasePath);
    const unrelated = "unrelated-card";
    before
      .query(
        `INSERT INTO card(id, type, content_json, searchable_text, staged_at, staging_priority)
         VALUES (?, 'grammar', ?, 'unrelated', ?, 0)`,
      )
      .run(
        unrelated,
        JSON.stringify({
          canonicalForm: "unrelated",
          meaning: "unrelated",
          formation: "unrelated",
          usageNotes: "unrelated",
        }),
        context.now.toISOString(),
      );
    before
      .query("INSERT INTO card_progress(card_id, state) VALUES (?, 'staged')")
      .run(unrelated);
    before.close();

    const result = markImportedCardsKnown({
      ...context,
      importKey: "owner-cutover",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        sourceItems: 6,
        uniqueCards: 4,
        changedCards: 3,
        alreadyKnownCards: 1,
        statesBefore: { staged: 1, active: 1, known: 1, suspended: 1 },
        knownCardsAfter: 4,
        schedulesPreserved: 2,
        reviewsPreserved: 0,
        quarantinesPreserved: 3,
      },
    });

    const database = new Database(context.databasePath, { readonly: true });
    expect(
      database
        .query(
          `SELECT state, count(*) AS count FROM card_progress p
           JOIN legacy_import_item i ON i.card_id = p.card_id
           WHERE i.import_key = 'owner-cutover' GROUP BY state`,
        )
        .all(),
    ).toEqual([{ state: "known", count: 4 }]);
    expect(
      database
        .query("SELECT state FROM card_progress WHERE card_id = ?")
        .get(unrelated),
    ).toEqual({ state: "staged" });
    expect(
      database
        .query(
          `SELECT count(*) AS count FROM card_progress p
           JOIN legacy_import_item i ON i.card_id = p.card_id
           WHERE i.import_key = 'owner-cutover'
             AND (p.known_return_state IS NULL OR p.support_ready_at IS NULL
                  OR p.suspended_return_state IS NOT NULL)`,
        )
        .get(),
    ).toEqual({ count: 0 });
    database.close();

    expect(
      markImportedCardsKnown({ ...context, importKey: "owner-cutover" }),
    ).toMatchObject({
      ok: true,
      value: { changedCards: 0, alreadyKnownCards: 4, knownCardsAfter: 4 },
    });
  });

  test("rejects an unknown receipt and a database held by another owner", () => {
    const context = setup();
    expect(markImportedCardsKnown({ ...context, importKey: "missing" })).toEqual({
      ok: false,
      error: { kind: "importNotFound" },
    });

    const lock = acquireDatabaseLock(context.databasePath);
    if (!lock.ok) throw new Error(lock.error);
    expect(markImportedCardsKnown({ ...context, importKey: "owner-cutover" })).toEqual({
      ok: false,
      error: { kind: "databaseInUse" },
    });
    lock.value.release();
  });

  test("rolls back the whole correction when an evidence postcondition fails", () => {
    const context = setup();
    const database = new Database(context.databasePath);
    const statesBefore = database
      .query("SELECT card_id, state FROM card_progress ORDER BY card_id")
      .all();
    const schedulesBefore = database
      .query("SELECT card_id, due_at FROM schedule ORDER BY card_id")
      .all();
    database.exec(`
      CREATE TRIGGER sabotage_imported_known_evidence
      AFTER UPDATE OF state ON card_progress
      WHEN NEW.state = 'known'
      BEGIN
        DELETE FROM schedule WHERE card_id = NEW.card_id;
      END;
    `);
    database.close();

    expect(markImportedCardsKnown({ ...context, importKey: "owner-cutover" })).toEqual({
      ok: false,
      error: { kind: "importInconsistent" },
    });

    const after = new Database(context.databasePath, { readonly: true });
    expect(
      after.query("SELECT card_id, state FROM card_progress ORDER BY card_id").all(),
    ).toEqual(statesBefore);
    expect(
      after.query("SELECT card_id, due_at FROM schedule ORDER BY card_id").all(),
    ).toEqual(schedulesBefore);
    after.close();
  });
});
