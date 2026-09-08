import type { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type { StudyFailure } from "./contracts.ts";

type Migration = Readonly<{ version: number; sql: string }>;

export const STUDY_SCHEMA_VERSION = 3;

const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE card (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('grammar', 'vocabulary')),
        content_json TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        staged_at TEXT NOT NULL,
        staging_priority INTEGER NOT NULL
      );

      CREATE TABLE identity_claim (
        authority TEXT NOT NULL,
        claim_key TEXT NOT NULL,
        card_id TEXT NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
        PRIMARY KEY (authority, claim_key)
      );

      CREATE TABLE card_progress (
        card_id TEXT PRIMARY KEY REFERENCES card(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('staged', 'active', 'known', 'suspended')),
        known_return_state TEXT CHECK (known_return_state IN ('staged', 'active')),
        suspended_return_state TEXT CHECK (suspended_return_state IN ('staged', 'active', 'known')),
        support_ready_at TEXT,
        first_success_at TEXT,
        first_success_day TEXT
      );

      CREATE TABLE schedule (
        card_id TEXT PRIMARY KEY REFERENCES card(id) ON DELETE RESTRICT,
        due_at TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('new', 'learning', 'review', 'relearning')),
        schedule_json TEXT NOT NULL,
        scheduler_version TEXT NOT NULL
      );

      CREATE TABLE admission_event (
        card_id TEXT PRIMARY KEY REFERENCES card(id) ON DELETE RESTRICT,
        admitted_at TEXT NOT NULL,
        local_day TEXT NOT NULL,
        time_zone TEXT NOT NULL
      );

      CREATE INDEX admission_day_idx ON admission_event(local_day, time_zone);

      CREATE TABLE admission_window (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        local_day TEXT NOT NULL,
        time_zone TEXT NOT NULL
      );

      CREATE TABLE review_event (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
        permit_id TEXT NOT NULL UNIQUE,
        grade TEXT NOT NULL CHECK (grade IN ('again', 'hard', 'good', 'easy')),
        reviewed_at TEXT NOT NULL,
        local_day TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        before_schedule_json TEXT NOT NULL,
        after_schedule_json TEXT NOT NULL,
        scheduler_version TEXT NOT NULL,
        presentation_contract_version TEXT NOT NULL
      );

      CREATE INDEX review_card_idx ON review_event(card_id, reviewed_at);

      CREATE TABLE study_preferences (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        new_cards_per_day INTEGER NOT NULL CHECK (new_cards_per_day BETWEEN 0 AND 100),
        time_zone TEXT NOT NULL
      );

      INSERT INTO study_preferences(singleton, new_cards_per_day, time_zone)
      VALUES (1, 15, 'UTC');

      CREATE TABLE time_zone_change (
        id INTEGER PRIMARY KEY,
        changed_at TEXT NOT NULL,
        previous_time_zone TEXT NOT NULL,
        next_time_zone TEXT NOT NULL
      );

      CREATE TABLE known_word (
        seed_id TEXT NOT NULL,
        seed_key TEXT NOT NULL,
        seed_version TEXT NOT NULL,
        lemma TEXT NOT NULL,
        reading TEXT NOT NULL,
        meaning TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        PRIMARY KEY (seed_id, seed_key)
      );

      CREATE TABLE seed_ledger (
        seed_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable')),
        applied_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE known_word ADD COLUMN part_of_speech TEXT;
      DELETE FROM seed_ledger;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE staging_source (
        card_id TEXT NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'plan', 'capture')),
        source_key TEXT NOT NULL,
        priority INTEGER NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (card_id, source_kind, source_key)
      );

      INSERT INTO staging_source(card_id, source_kind, source_key, priority, active, created_at)
      SELECT c.id, 'manual', c.id, c.staging_priority, 1, c.staged_at
      FROM card c JOIN card_progress p ON p.card_id = c.id
      WHERE p.state = 'staged';

      CREATE TABLE preparation_plan (
        id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'paused')),
        draft_digest TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        analysis_run_id TEXT NOT NULL,
        study_digest TEXT NOT NULL,
        revision INTEGER NOT NULL,
        episodes_json TEXT NOT NULL,
        created_cards INTEGER NOT NULL,
        reused_cards INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE plan_start_operation (
        operation_key TEXT PRIMARY KEY,
        draft_digest TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES preparation_plan(id) ON DELETE CASCADE,
        committed_at TEXT NOT NULL
      );

      CREATE TABLE preparation_plan_member (
        plan_id TEXT NOT NULL REFERENCES preparation_plan(id) ON DELETE CASCADE,
        finding_key TEXT NOT NULL,
        card_id TEXT NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
        classification TEXT NOT NULL CHECK (classification IN ('required', 'helpful')),
        preparation_priority INTEGER NOT NULL,
        staging_priority INTEGER NOT NULL,
        first_needed_episode_key TEXT NOT NULL,
        first_needed_episode_order INTEGER NOT NULL,
        first_needed_episode_title TEXT NOT NULL,
        rank_reasons_json TEXT NOT NULL,
        proposed_relation TEXT NOT NULL CHECK (proposed_relation IN ('missing', 'existing')),
        PRIMARY KEY (plan_id, finding_key),
        UNIQUE (plan_id, card_id)
      );

      CREATE TABLE preparation_plan_evidence (
        plan_id TEXT NOT NULL,
        finding_key TEXT NOT NULL,
        episode_key TEXT NOT NULL,
        cue_key TEXT NOT NULL,
        PRIMARY KEY (plan_id, finding_key, episode_key, cue_key),
        FOREIGN KEY (plan_id, finding_key)
          REFERENCES preparation_plan_member(plan_id, finding_key) ON DELETE CASCADE
      );
    `,
  },
];

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const migrateStudyDatabase = (
  database: Database,
  appliedAt: string,
): Result<number, StudyFailure> => {
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const row = database
      .query("SELECT coalesce(max(version), 0) AS version FROM schema_migration")
      .get() as { version: number };
    if (row.version > STUDY_SCHEMA_VERSION) {
      return err({
        kind: "unsupportedSchema",
        found: row.version,
        supported: STUDY_SCHEMA_VERSION,
      });
    }
    for (const migration of migrations) {
      if (migration.version <= row.version) continue;
      const apply = database.transaction(() => {
        database.exec(migration.sql);
        database
          .query("INSERT INTO schema_migration(version, applied_at) VALUES (?, ?)")
          .run(migration.version, appliedAt);
      });
      apply.immediate();
    }
    return ok(STUDY_SCHEMA_VERSION);
  } catch (cause) {
    return err({ kind: "migrationFailed", detail: detail(cause) });
  }
};
