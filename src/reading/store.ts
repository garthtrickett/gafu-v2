import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type { Reading, ReadingFailure, ReadingSentence } from "./contracts.ts";

const READING_SCHEMA_VERSION = 1;

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Readings are kept because writing one is a dozen generations: a reader who
 * comes back to 桃太郎 should find the tale they were part way through, not a
 * different one. A reading is replaced wholesale when regenerated, so a
 * learner whose vocabulary has grown can ask for an easier telling.
 */
const migrate = (database: Database, appliedAt: string): void => {
  const apply = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS reading_migration (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const current = database
      .query("SELECT coalesce(max(version), 0) AS version FROM reading_migration")
      .get() as { version: number };
    if (current.version > READING_SCHEMA_VERSION) {
      throw new Error(`unsupported Reading schema ${current.version}`);
    }
    if (current.version < 1) {
      database.exec(`
        CREATE TABLE reading (
          tale_id TEXT PRIMARY KEY,
          generated_at TEXT NOT NULL,
          sentences_json TEXT NOT NULL
        );
      `);
      database
        .query("INSERT INTO reading_migration(version, applied_at) VALUES (1, ?)")
        .run(appliedAt);
    }
  });
  apply.immediate();
};

export type ReadingStore = Readonly<{
  save: (reading: Reading) => Result<void, ReadingFailure>;
  load: (
    taleId: string,
  ) => Result<
    { generatedAt: string; sentences: readonly ReadingSentence[] } | null,
    ReadingFailure
  >;
  /** Which tales already have a reading, for the list to say so. */
  generated: () => Result<ReadonlyMap<string, string>, ReadingFailure>;
  close: () => void;
}>;

export const openReadingStore = (options: {
  databasePath: string;
  now: () => Date;
}): Result<ReadingStore, ReadingFailure> => {
  try {
    const database = new Database(options.databasePath, { create: true });
    database.exec("PRAGMA foreign_keys = ON");
    migrate(database, options.now().toISOString());
    return ok({
      save: (reading) => {
        try {
          database
            .query(
              `INSERT INTO reading(tale_id, generated_at, sentences_json)
               VALUES (?, ?, ?)
               ON CONFLICT(tale_id) DO UPDATE SET
                 generated_at = excluded.generated_at,
                 sentences_json = excluded.sentences_json`,
            )
            .run(
              reading.taleId,
              reading.generatedAt,
              JSON.stringify(reading.sentences),
            );
          return ok(undefined);
        } catch (cause) {
          return err({ kind: "writeFailed", detail: detail(cause) });
        }
      },
      load: (taleId) => {
        try {
          const row = database
            .query("SELECT generated_at, sentences_json FROM reading WHERE tale_id = ?")
            .get(taleId) as { generated_at: string; sentences_json: string } | null;
          if (row === null) return ok(null);
          return ok({
            generatedAt: row.generated_at,
            sentences: JSON.parse(row.sentences_json) as readonly ReadingSentence[],
          });
        } catch (cause) {
          return err({ kind: "readFailed", detail: detail(cause) });
        }
      },
      generated: () => {
        try {
          const rows = database
            .query("SELECT tale_id, generated_at FROM reading")
            .all() as { tale_id: string; generated_at: string }[];
          return ok(new Map(rows.map((row) => [row.tale_id, row.generated_at])));
        } catch (cause) {
          return err({ kind: "readFailed", detail: detail(cause) });
        }
      },
      close: () => database.close(),
    });
  } catch (cause) {
    return err({ kind: "writeFailed", detail: detail(cause) });
  }
};
