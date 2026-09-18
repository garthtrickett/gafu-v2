import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type { Reading, ReadingFailure, ReadingSentence } from "./contracts.ts";

const READING_SCHEMA_VERSION = 2;

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
    if (current.version < 2) {
      // A tale of a hundred sentences is a hundred generations, which is
      // minutes. Writing it in one request would hold a connection open long
      // enough for anything in front of the server to give up, so a reading
      // is written a beat at a time and what is written survives: a tale
      // half told can be carried on rather than begun again.
      database.exec(`
        CREATE TABLE reading_beat (
          tale_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'written', 'failed')),
          sentence_json TEXT,
          reasons_json TEXT,
          PRIMARY KEY (tale_id, seq)
        );
        CREATE INDEX reading_beat_pending ON reading_beat(tale_id, status, seq);
      `);
      database
        .query("INSERT INTO reading_migration(version, applied_at) VALUES (2, ?)")
        .run(appliedAt);
    }
  });
  apply.immediate();
};

export type ReadingProgress = Readonly<{
  total: number;
  written: number;
  failed: number;
  done: boolean;
  /** The beat the next advance will write, or null when none is pending. */
  next: number | null;
  reasons: readonly string[];
}>;

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
  /** Clears any part-written reading and lays out one pending beat each. */
  begin: (taleId: string, beats: number) => Result<void, ReadingFailure>;
  progress: (taleId: string) => Result<ReadingProgress, ReadingFailure>;
  /** The sentences written so far, in order, for the next beat's context. */
  written: (taleId: string) => Result<readonly ReadingSentence[], ReadingFailure>;
  record: (
    taleId: string,
    seq: number,
    outcome: { sentence: ReadingSentence } | { reasons: readonly string[] },
  ) => Result<void, ReadingFailure>;
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
      begin: (taleId, beats) => {
        try {
          const start = database.transaction(() => {
            database.query("DELETE FROM reading_beat WHERE tale_id = ?").run(taleId);
            database.query("DELETE FROM reading WHERE tale_id = ?").run(taleId);
            const insert = database.query(
              "INSERT INTO reading_beat(tale_id, seq, status) VALUES (?, ?, 'pending')",
            );
            for (let seq = 0; seq < beats; seq += 1) insert.run(taleId, seq);
          });
          start.immediate();
          return ok(undefined);
        } catch (cause) {
          return err({ kind: "writeFailed", detail: detail(cause) });
        }
      },
      progress: (taleId) => {
        try {
          const rows = database
            .query(
              "SELECT seq, status, reasons_json FROM reading_beat WHERE tale_id = ? ORDER BY seq",
            )
            .all(taleId) as {
            seq: number;
            status: string;
            reasons_json: string | null;
          }[];
          const pending = rows.filter((row) => row.status === "pending");
          const failed = rows.filter((row) => row.status === "failed");
          return ok({
            total: rows.length,
            written: rows.filter((row) => row.status === "written").length,
            failed: failed.length,
            done: rows.length > 0 && pending.length === 0,
            next: pending[0]?.seq ?? null,
            reasons: failed.flatMap((row) =>
              row.reasons_json === null
                ? []
                : (JSON.parse(row.reasons_json) as readonly string[]),
            ),
          });
        } catch (cause) {
          return err({ kind: "readFailed", detail: detail(cause) });
        }
      },
      written: (taleId) => {
        try {
          const rows = database
            .query(
              `SELECT sentence_json FROM reading_beat
               WHERE tale_id = ? AND status = 'written' ORDER BY seq`,
            )
            .all(taleId) as { sentence_json: string }[];
          return ok(
            rows.map((row) => JSON.parse(row.sentence_json) as ReadingSentence),
          );
        } catch (cause) {
          return err({ kind: "readFailed", detail: detail(cause) });
        }
      },
      record: (taleId, seq, outcome) => {
        try {
          database
            .query(
              `UPDATE reading_beat
               SET status = ?, sentence_json = ?, reasons_json = ?
               WHERE tale_id = ? AND seq = ?`,
            )
            .run(
              "sentence" in outcome ? "written" : "failed",
              "sentence" in outcome ? JSON.stringify(outcome.sentence) : null,
              "reasons" in outcome ? JSON.stringify(outcome.reasons) : null,
              taleId,
              seq,
            );
          return ok(undefined);
        } catch (cause) {
          return err({ kind: "writeFailed", detail: detail(cause) });
        }
      },
      close: () => database.close(),
    });
  } catch (cause) {
    return err({ kind: "writeFailed", detail: detail(cause) });
  }
};
