import type { CardState, CreateCard } from "../study/contracts.ts";
import type { StoredSchedule } from "../study/scheduler.ts";

export const V1_SNAPSHOT_VERSION = "gafu-v1-sync-snapshot-v1" as const;
export const MAX_V1_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_V1_RECORDS = 100_000;

export type V1KnowledgePoint = Readonly<{
  id: string | null;
  kind: string | null;
  canonicalKey: string | null;
  catalogueStatus: string | null;
  formalName: string | null;
  baseMeaning: string | null;
  lemma: string | null;
  reading: string | null;
  partOfSpeech: string | null;
  senseKey: string | null;
  meaning: string | null;
  register: string | null;
}>;

export type V1Progress = Readonly<{
  knowledgePointId: string | null;
  repetitions: number | null;
  intervalDays: number | null;
  nextReview: string | null;
  difficulty: number | null;
  stability: number | null;
  lastReviewedAt: string | null;
  participationStatus: string | null;
  learningState: string | null;
  introducedAt: string | null;
}>;

export type V1Snapshot = Readonly<{
  contractVersion: typeof V1_SNAPSHOT_VERSION;
  capturedAt: string;
  sourceOrigin: string;
  knowledgePoints: readonly V1KnowledgePoint[];
  progress: readonly V1Progress[];
  preferences: Readonly<{
    newCardsPerDay: number | null;
    timeZone: string | null;
  }>;
}>;

export type MigrationDisposition = "mapped" | "merged" | "skipped" | "quarantined";

export type MigrationItem = Readonly<{
  sourceId: string;
  kind: "grammar" | "vocabulary" | "unknown";
  disposition: MigrationDisposition;
  reason: string;
  cardId: string | null;
  desiredState: CardState | null;
  schedule: "none" | "v1-derived" | "existing-v2";
  recordDigest: string;
}>;

export type MigrationCounts = Readonly<{
  input: number;
  mapped: number;
  merged: number;
  skipped: number;
  quarantined: number;
}>;

export type MigrationReconciliation = Readonly<{
  contractVersion: typeof V1_SNAPSHOT_VERSION;
  sourceDigest: string;
  destinationSchemaVersion: number | null;
  capturedAt: string;
  inspectedAt: string;
  applied: boolean;
  replayed: boolean;
  preferences: Readonly<{
    newCardsPerDay: number | null;
    timeZone: string | null;
    applied: boolean;
    reason: string;
  }>;
  counts: MigrationCounts;
  items: readonly MigrationItem[];
}>;

export type MigrationFailure =
  | { readonly kind: "snapshotTooLarge"; readonly maximumBytes: number }
  | { readonly kind: "snapshotInvalid"; readonly detail: string }
  | { readonly kind: "destinationUnreadable"; readonly detail: string }
  | {
      readonly kind: "unsupportedDestination";
      readonly found: number;
      readonly supported: number;
    }
  | { readonly kind: "importConflict" }
  | { readonly kind: "applyFailed"; readonly detail: string };

export type PlannedMigrationItem = Readonly<{
  report: MigrationItem;
  card: CreateCard | null;
  canonicalClaim: Readonly<{ authority: string; claimKey: string }> | null;
  sourceClaim: Readonly<{ authority: string; claimKey: string }> | null;
  desiredState: CardState | null;
  suspendedReturnState: Exclude<CardState, "suspended"> | null;
  supportReadyAt: string | null;
  schedule: StoredSchedule | null;
  admittedAt: string | null;
}>;

export type MigrationPlan = Readonly<{
  snapshot: V1Snapshot;
  reconciliation: MigrationReconciliation;
  items: readonly PlannedMigrationItem[];
}>;

export type ApplyV1Migration = Readonly<{
  importKey: string;
  snapshotBytes: Uint8Array;
  destinationPath: string;
}>;

export type V1Migration = Readonly<{
  inspect: (
    snapshotBytes: Uint8Array,
    destinationPath: string,
  ) => import("../result.ts").Result<MigrationReconciliation, MigrationFailure>;
  apply: (
    command: ApplyV1Migration,
  ) => import("../result.ts").Result<MigrationReconciliation, MigrationFailure>;
}>;
