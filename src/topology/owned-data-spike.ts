import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";

export type SpikePlanDraft = Readonly<{
  planId: string;
  cards: readonly Readonly<{
    canonicalKey: string;
    cardType: "vocabulary" | "grammar";
    cueId: string;
    spanStart: number;
    spanEnd: number;
  }>[];
}>;

export type DataSpikeFailure =
  | { readonly kind: "openFailed"; readonly detail: string }
  | { readonly kind: "commitFailed"; readonly detail: string }
  | { readonly kind: "backupFailed"; readonly detail: string }
  | { readonly kind: "restoreFailed"; readonly detail: string };

export type DataSpikeCounts = Readonly<{
  plans: number;
  cards: number;
  memberships: number;
  evidence: number;
  schedules: number;
}>;

export type OwnedDataSpike = Readonly<{
  commitPlan: (
    draft: SpikePlanDraft,
    injectFailureAfter?: "cards",
  ) => Result<void, DataSpikeFailure>;
  counts: () => DataSpikeCounts;
  backup: () => Result<Uint8Array, DataSpikeFailure>;
  close: () => void;
}>;

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const initialize = (database: Database): void => {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS spike_plan (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS spike_card (
      canonical_key TEXT PRIMARY KEY,
      card_type TEXT NOT NULL CHECK (card_type IN ('vocabulary', 'grammar'))
    );
    CREATE TABLE IF NOT EXISTS spike_plan_card (
      plan_id TEXT NOT NULL REFERENCES spike_plan(id),
      canonical_key TEXT NOT NULL REFERENCES spike_card(canonical_key),
      PRIMARY KEY (plan_id, canonical_key)
    );
    CREATE TABLE IF NOT EXISTS spike_evidence (
      plan_id TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      cue_id TEXT NOT NULL,
      span_start INTEGER NOT NULL,
      span_end INTEGER NOT NULL,
      PRIMARY KEY (plan_id, canonical_key, cue_id, span_start, span_end),
      FOREIGN KEY (plan_id, canonical_key)
        REFERENCES spike_plan_card(plan_id, canonical_key)
    );
    CREATE TABLE IF NOT EXISTS spike_schedule (
      canonical_key TEXT PRIMARY KEY REFERENCES spike_card(canonical_key),
      state TEXT NOT NULL
    );
  `);
};

const wrap = (database: Database): OwnedDataSpike => {
  initialize(database);
  const commit = database.transaction(
    (draft: SpikePlanDraft, injectFailureAfter?: "cards") => {
      database.query("INSERT INTO spike_plan (id) VALUES (?)").run(draft.planId);
      const insertCard = database.query(
        "INSERT OR IGNORE INTO spike_card (canonical_key, card_type) VALUES (?, ?)",
      );
      for (const card of draft.cards) {
        insertCard.run(card.canonicalKey, card.cardType);
      }
      if (injectFailureAfter === "cards") {
        throw new Error("injected failure after canonical cards");
      }
      const insertMembership = database.query(
        "INSERT INTO spike_plan_card (plan_id, canonical_key) VALUES (?, ?)",
      );
      const insertEvidence = database.query(
        "INSERT INTO spike_evidence (plan_id, canonical_key, cue_id, span_start, span_end) VALUES (?, ?, ?, ?, ?)",
      );
      const insertSchedule = database.query(
        "INSERT OR IGNORE INTO spike_schedule (canonical_key, state) VALUES (?, 'new')",
      );
      for (const card of draft.cards) {
        insertMembership.run(draft.planId, card.canonicalKey);
        insertEvidence.run(
          draft.planId,
          card.canonicalKey,
          card.cueId,
          card.spanStart,
          card.spanEnd,
        );
        insertSchedule.run(card.canonicalKey);
      }
    },
  );
  const count = (table: string): number => {
    const row = database.query(`SELECT count(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    return row.count;
  };
  return {
    commitPlan: (draft, injectFailureAfter) => {
      try {
        commit.immediate(draft, injectFailureAfter);
        return ok(undefined);
      } catch (cause) {
        return err({ kind: "commitFailed", detail: detail(cause) });
      }
    },
    counts: () => ({
      plans: count("spike_plan"),
      cards: count("spike_card"),
      memberships: count("spike_plan_card"),
      evidence: count("spike_evidence"),
      schedules: count("spike_schedule"),
    }),
    backup: () => {
      try {
        return ok(new Uint8Array(database.serialize()));
      } catch (cause) {
        return err({ kind: "backupFailed", detail: detail(cause) });
      }
    },
    close: () => database.close(),
  };
};

export const openOwnedDataSpike = (
  path: string,
): Result<OwnedDataSpike, DataSpikeFailure> => {
  try {
    return ok(wrap(new Database(path, { strict: true, create: true })));
  } catch (cause) {
    return err({ kind: "openFailed", detail: detail(cause) });
  }
};

export const restoreOwnedDataSpike = (
  backup: Uint8Array,
): Result<OwnedDataSpike, DataSpikeFailure> => {
  try {
    return ok(wrap(Database.deserialize(backup, { strict: true })));
  } catch (cause) {
    return err({ kind: "restoreFailed", detail: detail(cause) });
  }
};
