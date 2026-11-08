import type { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type { MaterialFailure } from "./generated-contracts.ts";
export const MATERIAL_SCHEMA_VERSION = 12;
const BACKGROUND_RETRY_COOLDOWN_MS = 24 * 60 * 60_000;
const _WORD_CARD_PROVIDER = "word-card";
const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const migrateMaterial = (
  database: Database,
  appliedAt: string,
): Result<void, MaterialFailure> => {
  try {
    const apply = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS learning_material_migration (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
      const current = database
        .query(
          "SELECT coalesce(max(version), 0) AS version FROM learning_material_migration",
        )
        .get() as { version: number };
      if (current.version > MATERIAL_SCHEMA_VERSION) {
        throw new Error(`unsupported Learning Material schema ${current.version}`);
      }
      const applied = database
        .query("SELECT version FROM learning_material_migration ORDER BY version")
        .all() as { version: number }[];
      if (!applied.every(({ version }, index) => version === index + 1)) {
        throw new Error("Learning Material migration history is not contiguous");
      }
      // Each step applies when the database is below its version. No step
      // returns early: a database at version 2 must still receive 3 and 4.
      // (An early return here once left production without the tables the
      // later steps create, while fresh databases in tests had them all.)
      if (current.version < 1) {
        database.exec(`
        CREATE TABLE validated_presentation (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('teach', 'review')),
          payload_json TEXT NOT NULL,
          normalized_japanese TEXT NOT NULL,
          exact_signature TEXT NOT NULL,
          near_signature TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          shown_at TEXT,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          validation_version TEXT NOT NULL,
          UNIQUE(card_id, exact_signature)
        );
        CREATE INDEX validated_reserve_idx
          ON validated_presentation(card_id, mode, shown_at, generated_at);
        CREATE TABLE teaching_acknowledgement (
          card_id TEXT PRIMARY KEY,
          presentation_id TEXT NOT NULL,
          acknowledged_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (1, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 2) {
        // Review batches: one row per card. Generation banks reserves without
        // taking, so work-through serves with fresh permits through the
        // normal path.
        database.exec(`
        CREATE TABLE IF NOT EXISTS review_batch_item (
          batch_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          card_id TEXT NOT NULL,
          input_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
          failure_kind TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (batch_id, seq)
        );
        CREATE INDEX IF NOT EXISTS review_batch_pending_idx
          ON review_batch_item(batch_id, status, seq);
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (2, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 3) {
        // Spoken sentences, one clip per presentation, and the daily ceiling
        // that bounds what a runaway session can spend on synthesis.
        database.exec(`
        CREATE TABLE IF NOT EXISTS presentation_audio (
          presentation_id TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          bytes BLOB NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          voice TEXT NOT NULL,
          synthesis_version INTEGER NOT NULL,
          generated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS speech_daily_usage (
          usage_date TEXT PRIMARY KEY,
          attempted_count INTEGER NOT NULL DEFAULT 0 CHECK (attempted_count >= 0),
          updated_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (3, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 4) {
        // The provider job a review batch dispatched, so polls across
        // processes find it again instead of generating twice.
        database.exec(`
        CREATE TABLE IF NOT EXISTS review_batch_job (
          batch_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          dispatched_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (4, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 5) {
        // Retry rounds: how many whole-batch requests a Card has been in, and
        // why its last candidates were refused, fed back to the next request.
        const columns = new Set(
          (
            database.query("PRAGMA table_info(review_batch_item)").all() as {
              name: string;
            }[]
          ).map((column) => column.name),
        );
        if (!columns.has("attempts")) {
          database.exec(
            "ALTER TABLE review_batch_item ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
          );
        }
        if (!columns.has("hints_json")) {
          database.exec("ALTER TABLE review_batch_item ADD COLUMN hints_json TEXT");
        }
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (5, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 6) {
        // Permits outlive a process now that a session is downloaded whole:
        // a deploy mid-session must not strand twenty answers in the outbox.
        database.exec(`
        CREATE TABLE IF NOT EXISTS presentation_permit (
          token TEXT PRIMARY KEY,
          id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          presentation_id TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          contract_version TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (6, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 7) {
        // The learner's knowledge was copied into every batch item — some
        // 700 KB each, twenty times a batch, never removed — and became the
        // bulk of the database. It is stored once per batch now.
        database.exec(`
        CREATE TABLE IF NOT EXISTS review_batch (
          batch_id TEXT PRIMARY KEY,
          knowledge_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (7, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 8) {
        // A prompt that asked only for the written fields to reconstruct the
        // sentence let a model answer with one segment and no reading at
        // all, and the page then showed a sentence with no furigana over any
        // of it. The provider refuses that now, but the sentences already
        // banked would each be served once before going away, so they are
        // dropped here and written again. Only unshown ones: a sentence
        // already seen is history, and history is not rewritten.
        for (const row of database
          .query(
            `SELECT id, payload_json FROM validated_presentation WHERE shown_at IS NULL`,
          )
          .all() as { id: string; payload_json: string }[]) {
          let unreadable = false;
          try {
            const payload = JSON.parse(row.payload_json) as {
              readingSegments?: { written?: string; reading?: string }[];
            };
            unreadable = (payload.readingSegments ?? []).some(
              (segment) =>
                typeof segment.written === "string" &&
                /[一-鿿々〆]/u.test(segment.written) &&
                (segment.reading ?? "").trim() === "",
            );
          } catch {
            // A payload that will not parse cannot be served either.
            unreadable = true;
          }
          if (unreadable) {
            database
              .query("DELETE FROM validated_presentation WHERE id = ?")
              .run(row.id);
          }
        }
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (8, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 9) {
        // A word-only fallback was also banked for Grammar Cards. It cannot
        // demonstrate the construction, so let unshown Cards be generated
        // again. Already shown presentations remain part of review history.
        for (const row of database
          .query(
            "SELECT id, payload_json FROM validated_presentation WHERE shown_at IS NULL AND provider = 'word-card'",
          )
          .all() as { id: string; payload_json: string }[]) {
          let grammar = false;
          try {
            grammar =
              (JSON.parse(row.payload_json) as { targetKind?: string }).targetKind ===
              "grammar";
          } catch {
            grammar = true;
          }
          if (grammar)
            database
              .query("DELETE FROM validated_presentation WHERE id = ?")
              .run(row.id);
        }
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (9, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 10) {
        // Keep a small, durable pause for Cards whose last generation failed.
        // Batch rows are purged after an hour, so they cannot protect a hidden
        // tab from retrying the same impossible grammar Card all day.
        database.exec(`
        CREATE TABLE IF NOT EXISTS review_batch_cooldown (
          card_id TEXT PRIMARY KEY,
          failed_at TEXT NOT NULL
        );
      `);
        const since = new Date(
          Date.parse(appliedAt) - BACKGROUND_RETRY_COOLDOWN_MS,
        ).toISOString();
        database
          .query(
            `INSERT INTO review_batch_cooldown(card_id, failed_at)
             SELECT i.card_id, max(i.updated_at)
             FROM review_batch_item i
             WHERE i.status = 'failed' AND i.updated_at > ?
               AND NOT EXISTS (
                 SELECT 1 FROM review_batch_item newer
                 WHERE newer.card_id = i.card_id AND newer.status = 'ready'
                   AND newer.updated_at > i.updated_at
               )
             GROUP BY i.card_id`,
          )
          .run(since);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (10, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 11) {
        // A word-only first exposure can introduce a word whose sentence is
        // not yet writable. A review must exercise it in a sentence. Discard
        // unshown review fallbacks from older versions; shown rows remain
        // immutable review history.
        database.exec(
          "DELETE FROM validated_presentation WHERE mode = 'review' AND shown_at IS NULL AND provider = 'word-card'",
        );
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (11, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 12) {
        database.exec(`
          ALTER TABLE validated_presentation ADD COLUMN context_json TEXT;
          ALTER TABLE presentation_permit ADD COLUMN context_json TEXT;
          ALTER TABLE review_batch ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
          ALTER TABLE review_batch ADD COLUMN blocked_reason TEXT;
          ALTER TABLE review_batch ADD COLUMN retry_at TEXT;
          ALTER TABLE review_batch_job ADD COLUMN phase TEXT NOT NULL DEFAULT 'running';
          ALTER TABLE review_batch_job ADD COLUMN owner_token TEXT;
          ALTER TABLE review_batch_job ADD COLUMN response_json TEXT;
          ALTER TABLE review_batch_job ADD COLUMN provider_identity TEXT;
          CREATE TABLE review_batch_attempt (
            id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,created_at TEXT NOT NULL,
            disposition TEXT NOT NULL,provider_job_id TEXT
          );
          CREATE TABLE review_preparation_control (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), blocked_reason TEXT,retry_at TEXT,provider_identity TEXT
          );
          INSERT INTO review_preparation_control(singleton) VALUES (1);
          CREATE TABLE material_speech_job (
            presentation_id TEXT NOT NULL,voice_identity TEXT NOT NULL,japanese TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('queued','dispatching','ready','failed','uncertain')),
            updated_at TEXT NOT NULL,automatic INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(presentation_id,voice_identity)
          );
          CREATE TABLE review_batch_claim (
            card_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,context_json TEXT NOT NULL
          );
          -- Before v7, items carried their own knowledge and had no parent scope.
          INSERT INTO review_batch(batch_id,knowledge_json,created_at,origin)
          SELECT i.batch_id,coalesce(json_extract(i.input_json,'$.knowledge'),'{}'),min(i.updated_at),'manual'
          FROM review_batch_item i WHERE i.status='pending'
            AND NOT EXISTS(SELECT 1 FROM review_batch b WHERE b.batch_id=i.batch_id)
          GROUP BY i.batch_id;
          INSERT INTO review_batch_job(batch_id,job_id,dispatched_at,phase)
          SELECT b.batch_id,'',b.created_at,'uncertain' FROM review_batch b
          WHERE EXISTS(SELECT 1 FROM review_batch_item i WHERE i.batch_id=b.batch_id AND i.status='pending')
            AND NOT EXISTS(SELECT 1 FROM review_batch_job j WHERE j.batch_id=b.batch_id);
        `);
        // Legacy work can have accepted remote requests. Keep claims even if no ID survived.
        database.exec(`
          INSERT OR IGNORE INTO review_batch_claim(card_id,batch_id,context_json)
          SELECT i.card_id,i.batch_id,'{}' FROM review_batch_item i
          WHERE i.status='pending' ORDER BY i.updated_at,i.batch_id;
        `);
        database
          .query("INSERT INTO learning_material_migration VALUES (12,?)")
          .run(appliedAt);
      }
    });
    apply.immediate();
    return ok(undefined);
  } catch (cause) {
    return err({ kind: "migrationFailed", detail: detail(cause) });
  }
};
