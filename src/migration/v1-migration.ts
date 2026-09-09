import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { Logger } from "../log.ts";
import { err, ok, type Result } from "../result.ts";
import type { CardState, CreateCard } from "../study/contracts.ts";
import { type CanonicalCard, canonicalizeCard } from "../study/identity.ts";
import { STUDY_SCHEMA_VERSION } from "../study/migrations.ts";
import type { StoredSchedule } from "../study/scheduler.ts";
import { openStudy, unavailableKaishiSeed } from "../study/study.ts";
import { localDayKey, validateTimeZone } from "../study/time.ts";
import {
  type ApplyV1Migration,
  type MigrationCounts,
  type MigrationFailure,
  type MigrationItem,
  type MigrationPlan,
  type MigrationReconciliation,
  type PlannedMigrationItem,
  V1_SNAPSHOT_VERSION,
  type V1Migration,
  type V1Progress,
  type V1Snapshot,
} from "./contracts.ts";
import { parseV1Snapshot, snapshotDigest } from "./snapshot.ts";

export type V1MigrationDependencies = Readonly<{
  clock: () => Date;
  nextId: () => string;
  initializeDestination: (path: string) => Result<void, MigrationFailure>;
  logger?: Logger;
}>;

export const initializeMigrationDestination = (
  path: string,
  clock: () => Date,
  nextId: () => string,
): Result<void, MigrationFailure> => {
  const opened = openStudy({
    databasePath: path,
    clock,
    nextId,
    permitVerifier: {
      verify: () =>
        err({
          kind: "presentationInvalid",
          detail: "Migration cannot verify a Study presentation.",
        }),
    },
    knownWordSeed: unavailableKaishiSeed,
  });
  if (!opened.ok) {
    return err({ kind: "applyFailed", detail: opened.error.kind });
  }
  opened.value.close();
  return ok(undefined);
};

type Destination = Readonly<{
  schemaVersion: number | null;
  claims: ReadonlyMap<string, string>;
  states: ReadonlyMap<string, CardState>;
}>;

const clean = (value: string | null): string | null => {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  return normalized === "" ? null : normalized;
};
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const claimKey = (authority: string, key: string): string => `${authority}\0${key}`;
const validDate = (value: string | null): string | null => {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const whole = (value: number | null, minimum: number): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= minimum;

const safeNow = (
  clock: () => Date,
): Result<Date, Extract<MigrationFailure, { kind: "snapshotInvalid" }>> => {
  try {
    const value = clock();
    return Number.isFinite(value.getTime())
      ? ok(new Date(value.getTime()))
      : err({ kind: "snapshotInvalid", detail: "Migration clock is invalid." });
  } catch {
    return err({ kind: "snapshotInvalid", detail: "Migration clock is invalid." });
  }
};

const counts = (items: readonly MigrationItem[]): MigrationCounts => ({
  input: items.length,
  mapped: items.filter((item) => item.disposition === "mapped").length,
  merged: items.filter((item) => item.disposition === "merged").length,
  skipped: items.filter((item) => item.disposition === "skipped").length,
  quarantined: items.filter((item) => item.disposition === "quarantined").length,
});

const readDestination = (path: string): Result<Destination, MigrationFailure> => {
  if (!existsSync(path)) {
    return ok({ schemaVersion: null, claims: new Map(), states: new Map() });
  }
  try {
    const database = new Database(path, { readonly: true, strict: true });
    const integrity = database.query("PRAGMA quick_check").get() as {
      quick_check: string;
    };
    if (integrity.quick_check !== "ok") throw new Error("SQLite quick check failed.");
    const schema = database
      .query("SELECT coalesce(max(version), 0) AS version FROM schema_migration")
      .get() as { version: number };
    if (schema.version > STUDY_SCHEMA_VERSION) {
      database.close();
      return err({
        kind: "unsupportedDestination",
        found: schema.version,
        supported: STUDY_SCHEMA_VERSION,
      });
    }
    const claimRows = database
      .query("SELECT authority, claim_key, card_id FROM identity_claim")
      .all() as { authority: string; claim_key: string; card_id: string }[];
    const stateRows = database
      .query("SELECT card_id, state FROM card_progress")
      .all() as { card_id: string; state: CardState }[];
    database.close();
    return ok({
      schemaVersion: schema.version,
      claims: new Map(
        claimRows.map((row) => [claimKey(row.authority, row.claim_key), row.card_id]),
      ),
      states: new Map(stateRows.map((row) => [row.card_id, row.state])),
    });
  } catch (cause) {
    return err({
      kind: "destinationUnreadable",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

const sourceClaim = (
  kind: "grammar" | "vocabulary",
  sourceId: string,
  senseKey: string | null,
): Readonly<{ authority: string; claimKey: string }> => ({
  authority: kind === "grammar" ? "gafu-v1-grammar-v1" : "gafu-v1-vocabulary-v1",
  claimKey:
    kind === "grammar"
      ? `id:${sourceId}`
      : `id:${sourceId}:sense:${clean(senseKey) ?? "missing"}`,
});

const schedule = (progress: V1Progress): StoredSchedule | null => {
  const dueAt = validDate(progress.nextReview);
  const lastReviewAt =
    progress.lastReviewedAt === null ? null : validDate(progress.lastReviewedAt);
  const repetitions = progress.repetitions ?? 0;
  const intervalDays = progress.intervalDays ?? 0;
  const difficulty = progress.difficulty ?? 5;
  const stability = progress.stability ?? intervalDays;
  if (
    dueAt === null ||
    !whole(repetitions, 0) ||
    !whole(intervalDays, 0) ||
    !Number.isFinite(difficulty) ||
    difficulty < 1 ||
    difficulty > 10 ||
    !Number.isFinite(stability) ||
    stability < 0 ||
    (progress.lastReviewedAt !== null && lastReviewAt === null)
  ) {
    return null;
  }
  return {
    dueAt,
    stability,
    difficulty,
    elapsedDays: 0,
    scheduledDays: intervalDays,
    learningSteps: 0,
    reps: repetitions,
    lapses: 0,
    phase: repetitions > 0 ? "review" : "learning",
    lastReviewAt,
  };
};

const desiredProgress = (
  progress: V1Progress,
  kind: "grammar" | "vocabulary",
): Readonly<{
  state: CardState;
  returnState: Exclude<CardState, "suspended"> | null;
  supportReadyAt: string | null;
  schedule: StoredSchedule | null;
  admittedAt: string | null;
  quarantine: string | null;
}> => {
  const learning = clean(progress.learningState)?.toLocaleLowerCase() ?? "";
  const archived =
    clean(progress.participationStatus)?.toLocaleLowerCase() === "archived";
  const known = learning === "stable" || learning === "known";
  const importedSchedule = schedule(progress);
  const admittedAt = validDate(progress.introducedAt);
  let base: Exclude<CardState, "suspended"> = "staged";
  let quarantine: string | null = null;
  if (known) {
    base = "known";
  } else if (["introduced", "primed", "encountered", "learning"].includes(learning)) {
    if (kind === "grammar") {
      quarantine = "grammarFormationUnavailable";
    } else if (importedSchedule !== null && admittedAt !== null) {
      base = "active";
    } else if ((progress.repetitions ?? 0) === 0 && progress.introducedAt === null) {
      base = "staged";
    } else {
      quarantine = "progressScheduleInvalid";
    }
  } else {
    quarantine = "learningStateUnsupported";
  }
  if (quarantine !== null) base = "staged";
  return {
    state: archived || quarantine !== null ? "suspended" : base,
    returnState: archived || quarantine !== null ? base : null,
    supportReadyAt: known ? (validDate(progress.lastReviewedAt) ?? admittedAt) : null,
    schedule: importedSchedule,
    admittedAt,
    quarantine,
  };
};

const buildCard = (
  snapshot: V1Snapshot,
  index: number,
  pointById: ReadonlyMap<string, V1Snapshot["knowledgePoints"][number]>,
): Readonly<{
  sourceId: string;
  kind: "grammar" | "vocabulary" | "unknown";
  card: CreateCard | null;
  sourceClaim: Readonly<{ authority: string; claimKey: string }> | null;
  progress: V1Progress;
  failure: string | null;
  recordDigest: string;
}> => {
  const progress = snapshot.progress[index] as V1Progress;
  const sourceId = clean(progress.knowledgePointId) ?? `invalid:${index}`;
  const point =
    progress.knowledgePointId === null
      ? undefined
      : pointById.get(progress.knowledgePointId);
  const recordDigest = digest({ progress, point });
  if (progress.knowledgePointId === null) {
    return {
      sourceId,
      kind: "unknown",
      card: null,
      sourceClaim: null,
      progress,
      failure: "progressIdMissing",
      recordDigest,
    };
  }
  if (point === undefined) {
    return {
      sourceId,
      kind: "unknown",
      card: null,
      sourceClaim: null,
      progress,
      failure: "cataloguePointMissing",
      recordDigest,
    };
  }
  if ((clean(point.catalogueStatus) ?? "active") !== "active") {
    return {
      sourceId,
      kind:
        point.kind === "vocabulary"
          ? "vocabulary"
          : point.kind === "grammar"
            ? "grammar"
            : "unknown",
      card: null,
      sourceClaim: null,
      progress,
      failure: "cataloguePointInactive",
      recordDigest,
    };
  }
  if (point.kind === "grammar") {
    const canonicalForm =
      clean(point.formalName) ??
      clean(point.canonicalKey)?.replace(/^grammar:/u, "") ??
      "";
    const meaning = clean(point.baseMeaning) ?? clean(point.meaning) ?? "";
    return {
      sourceId,
      kind: "grammar",
      card: {
        type: "grammar",
        content: {
          canonicalForm,
          meaning,
          formation: "Formation unavailable in V1 snapshot.",
          usageNotes:
            "Imported from Gafu V1; review formation before returning this Card to Study.",
        },
      },
      sourceClaim: sourceClaim("grammar", sourceId, null),
      progress,
      failure:
        canonicalForm === "" || meaning === "" ? "grammarContentIncomplete" : null,
      recordDigest,
    };
  }
  if (point.kind === "vocabulary") {
    const lemma = clean(point.lemma) ?? "";
    const reading = clean(point.reading) ?? "";
    const partOfSpeech = clean(point.partOfSpeech) ?? "";
    const meaning = clean(point.meaning) ?? "";
    const senseKey = clean(point.senseKey);
    return {
      sourceId,
      kind: "vocabulary",
      card: {
        type: "vocabulary",
        content: {
          lemma,
          reading,
          partOfSpeech,
          meaning,
          usageNotes:
            clean(point.register) === null
              ? "Imported from Gafu V1."
              : `Imported from Gafu V1. Register: ${clean(point.register)}`,
        },
      },
      sourceClaim: sourceClaim("vocabulary", sourceId, senseKey),
      progress,
      failure:
        lemma === "" ||
        reading === "" ||
        partOfSpeech === "" ||
        meaning === "" ||
        senseKey === null
          ? "vocabularyIdentityIncomplete"
          : null,
      recordDigest,
    };
  }
  return {
    sourceId,
    kind: "unknown",
    card: null,
    sourceClaim: null,
    progress,
    failure: "pointKindUnsupported",
    recordDigest,
  };
};

const validPreferences = (
  snapshot: V1Snapshot,
): MigrationReconciliation["preferences"] => {
  const limit = snapshot.preferences.newCardsPerDay;
  const zone = snapshot.preferences.timeZone;
  if (!whole(limit, 0) || limit > 100) {
    return {
      newCardsPerDay: null,
      timeZone: null,
      applied: false,
      reason: "newCardsPerDayInvalid",
    };
  }
  if (zone === null || !validateTimeZone(zone).ok) {
    return {
      newCardsPerDay: limit,
      timeZone: null,
      applied: false,
      reason: "timeZoneInvalid",
    };
  }
  return {
    newCardsPerDay: limit,
    timeZone: zone.trim(),
    applied: false,
    reason: "ready",
  };
};

const buildPlan = (
  bytes: Uint8Array,
  destination: Destination,
  inspectedAt: string,
): Result<MigrationPlan, MigrationFailure> => {
  const parsed = parseV1Snapshot(bytes);
  if (!parsed.ok) return parsed;
  const items: PlannedMigrationItem[] = [];
  const pointById = new Map(
    parsed.value.knowledgePoints.flatMap((point) =>
      point.id === null ? [] : [[point.id, point] as const],
    ),
  );
  for (const [index] of parsed.value.progress.entries()) {
    const source = buildCard(parsed.value, index, pointById);
    let canonical: CanonicalCard | null = null;
    let failure = source.failure;
    if (source.card !== null && failure === null) {
      const value = canonicalizeCard(source.card);
      if (value.ok) canonical = value.value;
      else failure = "cardContentInvalid";
    }
    const progress =
      source.kind === "grammar" || source.kind === "vocabulary"
        ? desiredProgress(source.progress, source.kind)
        : null;
    failure ??= progress?.quarantine ?? null;
    const sourceCardId =
      source.sourceClaim === null
        ? undefined
        : destination.claims.get(
            claimKey(source.sourceClaim.authority, source.sourceClaim.claimKey),
          );
    const canonicalCardId =
      canonical === null
        ? undefined
        : destination.claims.get(
            claimKey(canonical.claimAuthority, canonical.claimKey),
          );
    if (
      sourceCardId !== undefined &&
      canonicalCardId !== undefined &&
      sourceCardId !== canonicalCardId
    ) {
      failure = "identityClaimsConflict";
    }
    const intentionallySkipped = failure === "cataloguePointInactive";
    const existingCardId = sourceCardId ?? canonicalCardId ?? null;
    const disposition = intentionallySkipped
      ? "skipped"
      : failure !== null
        ? "quarantined"
        : existingCardId === null
          ? "mapped"
          : "merged";
    const report: MigrationItem = {
      sourceId: source.sourceId,
      kind: source.kind,
      disposition,
      reason:
        failure ??
        (existingCardId === null ? "newCard" : "canonicalOrSourceIdentityExists"),
      cardId: existingCardId,
      desiredState: intentionallySkipped ? null : (progress?.state ?? null),
      schedule: intentionallySkipped
        ? "none"
        : existingCardId !== null && destination.states.get(existingCardId) === "active"
          ? "existing-v2"
          : progress?.schedule === null || progress?.schedule === undefined
            ? "none"
            : "v1-derived",
      recordDigest: source.recordDigest,
    };
    items.push({
      report,
      card: canonical === null ? null : source.card,
      canonicalClaim:
        canonical === null
          ? null
          : { authority: canonical.claimAuthority, claimKey: canonical.claimKey },
      sourceClaim: source.sourceClaim,
      desiredState: intentionallySkipped ? null : (progress?.state ?? null),
      suspendedReturnState: intentionallySkipped
        ? null
        : (progress?.returnState ?? null),
      supportReadyAt: intentionallySkipped ? null : (progress?.supportReadyAt ?? null),
      schedule: intentionallySkipped ? null : (progress?.schedule ?? null),
      admittedAt: intentionallySkipped ? null : (progress?.admittedAt ?? null),
    });
  }
  const reportItems = items.map((item) => item.report);
  return ok({
    snapshot: parsed.value,
    items,
    reconciliation: {
      contractVersion: V1_SNAPSHOT_VERSION,
      sourceDigest: snapshotDigest(bytes),
      destinationSchemaVersion: destination.schemaVersion,
      capturedAt: parsed.value.capturedAt,
      inspectedAt,
      applied: false,
      replayed: false,
      preferences: validPreferences(parsed.value),
      counts: counts(reportItems),
      items: reportItems,
    },
  });
};

const readStored = (
  database: Database,
  importKey: string,
  sourceDigest: string,
): Result<MigrationReconciliation | null, MigrationFailure> => {
  const row = database
    .query("SELECT source_digest, report_json FROM legacy_import WHERE import_key = ?")
    .get(importKey) as { source_digest: string; report_json: string } | null;
  if (row === null) return ok(null);
  if (row.source_digest !== sourceDigest) return err({ kind: "importConflict" });
  return ok({
    ...(JSON.parse(row.report_json) as MigrationReconciliation),
    replayed: true,
  });
};

const readStoredSource = (
  database: Database,
  sourceDigest: string,
): Result<MigrationReconciliation | null, MigrationFailure> => {
  const row = database
    .query(
      `SELECT report_json FROM legacy_import
       WHERE source_digest = ? ORDER BY applied_at, import_key LIMIT 1`,
    )
    .get(sourceDigest) as { report_json: string } | null;
  return row === null
    ? ok(null)
    : ok({
        ...(JSON.parse(row.report_json) as MigrationReconciliation),
        replayed: true,
      });
};

const insertProgress = (
  database: Database,
  cardId: string,
  item: PlannedMigrationItem,
  capturedAt: string,
  timeZone: string,
): void => {
  const state = item.desiredState ?? "suspended";
  const underlying = item.suspendedReturnState;
  const knownReturnState =
    state === "known" || underlying === "known"
      ? item.schedule === null
        ? "staged"
        : "active"
      : null;
  database
    .query(
      `INSERT INTO card_progress(
         card_id, state, known_return_state, suspended_return_state, support_ready_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      cardId,
      state,
      knownReturnState,
      state === "suspended" ? (underlying ?? "staged") : null,
      state === "known" || underlying === "known"
        ? (item.supportReadyAt ?? capturedAt)
        : item.supportReadyAt,
    );
  if (state === "staged" || underlying === "staged") {
    database
      .query(
        `INSERT INTO staging_source(
           card_id, source_kind, source_key, priority, active, created_at
         ) VALUES (?, 'migration', ?, 0, 1, ?)`,
      )
      .run(cardId, item.report.sourceId, capturedAt);
  }
  if (
    item.schedule !== null &&
    (state === "active" ||
      state === "known" ||
      underlying === "active" ||
      underlying === "known")
  ) {
    database
      .query(
        `INSERT INTO schedule(card_id, due_at, phase, schedule_json, scheduler_version)
         VALUES (?, ?, ?, ?, 'v1-fsrs-lite-import-v1')`,
      )
      .run(
        cardId,
        item.schedule.dueAt,
        item.schedule.phase,
        JSON.stringify(item.schedule),
      );
    const admittedAt = item.admittedAt ?? capturedAt;
    const day = localDayKey(new Date(admittedAt), timeZone);
    if (!day.ok) throw new Error("Imported admission day is invalid.");
    database
      .query(
        `INSERT INTO admission_event(card_id, admitted_at, local_day, time_zone)
         VALUES (?, ?, ?, ?)`,
      )
      .run(cardId, admittedAt, day.value, timeZone);
  }
};

export const createV1Migration = (
  dependencies: V1MigrationDependencies,
): V1Migration => {
  const inspect = (
    bytes: Uint8Array,
    destinationPath: string,
  ): Result<MigrationReconciliation, MigrationFailure> => {
    const started = performance.now();
    const destination = readDestination(destinationPath);
    if (!destination.ok) return destination;
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    const plan = buildPlan(bytes, destination.value, now.value.toISOString());
    dependencies.logger?.write(plan.ok ? "info" : "warn", {
      event: plan.ok ? "migration.inspect.completed" : "migration.inspect.failed",
      fields: {
        durationMs: Math.round(performance.now() - started),
        ...(plan.ok
          ? {
              sourceDigestPrefix: plan.value.reconciliation.sourceDigest.slice(0, 12),
              counts: plan.value.reconciliation.counts,
            }
          : { failureKind: plan.error.kind }),
      },
    });
    return plan.ok ? ok(plan.value.reconciliation) : plan;
  };

  const apply = (
    command: ApplyV1Migration,
  ): Result<MigrationReconciliation, MigrationFailure> => {
    const importKey = command.importKey.normalize("NFKC").trim();
    if (
      importKey === "" ||
      importKey.length > 200 ||
      command.destinationPath === ":memory:"
    ) {
      return err({
        kind: "snapshotInvalid",
        detail: "Import key or destination is invalid.",
      });
    }
    // Validate and reconcile before any schema initialization can mutate a
    // missing or older destination.
    const before = readDestination(command.destinationPath);
    if (!before.ok) return before;
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    const preflight = buildPlan(
      command.snapshotBytes,
      before.value,
      now.value.toISOString(),
    );
    if (!preflight.ok) return preflight;
    const initialized = dependencies.initializeDestination(command.destinationPath);
    if (!initialized.ok) return initialized;
    let database: Database | null = null;
    try {
      database = new Database(command.destinationPath, { strict: true });
      database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      const sourceDigest = snapshotDigest(command.snapshotBytes);
      const stored = readStored(database, importKey, sourceDigest);
      if (!stored.ok) return stored;
      if (stored.value !== null) return ok(stored.value);
      const storedSource = readStoredSource(database, sourceDigest);
      if (!storedSource.ok) return storedSource;
      if (storedSource.value !== null) return ok(storedSource.value);
      const destination = readDestination(command.destinationPath);
      if (!destination.ok) return destination;
      const planned = buildPlan(
        command.snapshotBytes,
        destination.value,
        now.value.toISOString(),
      );
      if (!planned.ok) return planned;
      const preferences = planned.value.reconciliation.preferences;
      const timeZone = preferences.timeZone ?? "UTC";
      let finalReport: MigrationReconciliation | null = null;
      const commit = database.transaction(() => {
        const actualItems: MigrationItem[] = [];
        for (const item of planned.value.items) {
          let cardId = item.report.cardId;
          if (
            item.card !== null &&
            item.canonicalClaim !== null &&
            item.sourceClaim !== null
          ) {
            const sourceExisting = database
              ?.query(
                "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
              )
              .get(item.sourceClaim.authority, item.sourceClaim.claimKey) as {
              card_id: string;
            } | null;
            const canonicalExisting = database
              ?.query(
                "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
              )
              .get(item.canonicalClaim.authority, item.canonicalClaim.claimKey) as {
              card_id: string;
            } | null;
            if (
              sourceExisting !== null &&
              canonicalExisting !== null &&
              sourceExisting.card_id !== canonicalExisting.card_id
            ) {
              throw new Error("Identity claims changed incompatibly during import.");
            }
            cardId = sourceExisting?.card_id ?? canonicalExisting?.card_id ?? null;
            if (cardId === null) {
              cardId = dependencies.nextId();
              const canonical = canonicalizeCard(item.card);
              if (!canonical.ok)
                throw new Error("Planned Card no longer canonicalizes.");
              database
                ?.query(
                  `INSERT INTO card(
                     id, type, content_json, searchable_text, staged_at, staging_priority
                   ) VALUES (?, ?, ?, ?, ?, 0)`,
                )
                .run(
                  cardId,
                  item.card.type,
                  JSON.stringify(canonical.value.content),
                  canonical.value.searchableText,
                  planned.value.snapshot.capturedAt,
                );
              database
                ?.query(
                  "INSERT INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
                )
                .run(
                  item.canonicalClaim.authority,
                  item.canonicalClaim.claimKey,
                  cardId,
                );
              insertProgress(
                database as Database,
                cardId,
                item,
                planned.value.snapshot.capturedAt,
                timeZone,
              );
            } else {
              const existing = database
                ?.query("SELECT state FROM card_progress WHERE card_id = ?")
                .get(cardId) as { state: CardState };
              if (
                item.desiredState === "known" &&
                (existing.state === "staged" || existing.state === "active")
              ) {
                database
                  ?.query(
                    `UPDATE card_progress
                     SET state = 'known', known_return_state = state,
                         support_ready_at = coalesce(support_ready_at, ?)
                     WHERE card_id = ?`,
                  )
                  .run(item.supportReadyAt ?? now.value.toISOString(), cardId);
              }
            }
            database
              ?.query(
                "INSERT OR IGNORE INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
              )
              .run(item.sourceClaim.authority, item.sourceClaim.claimKey, cardId);
          }
          actualItems.push({
            ...item.report,
            cardId,
            disposition:
              item.report.disposition === "mapped" && cardId === item.report.cardId
                ? "mapped"
                : item.report.disposition === "quarantined"
                  ? "quarantined"
                  : cardId === null
                    ? item.report.disposition
                    : item.report.cardId === null
                      ? "mapped"
                      : "merged",
          });
        }
        const preferenceApplied =
          preferences.reason === "ready" &&
          preferences.newCardsPerDay !== null &&
          preferences.timeZone !== null;
        if (preferenceApplied) {
          database
            ?.query(
              `UPDATE study_preferences
               SET new_cards_per_day = ?, time_zone = ? WHERE singleton = 1`,
            )
            .run(preferences.newCardsPerDay, preferences.timeZone);
        }
        finalReport = {
          ...planned.value.reconciliation,
          destinationSchemaVersion: STUDY_SCHEMA_VERSION,
          applied: true,
          preferences: { ...preferences, applied: preferenceApplied },
          counts: counts(actualItems),
          items: actualItems,
        };
        database
          ?.query(
            `INSERT INTO legacy_import(
               import_key, source_digest, source_contract, report_json, applied_at
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            importKey,
            sourceDigest,
            V1_SNAPSHOT_VERSION,
            JSON.stringify(finalReport),
            now.value.toISOString(),
          );
        const addItem = database?.query(
          `INSERT INTO legacy_import_item(
             import_key, source_id, record_digest, kind, disposition, reason, card_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const quarantine = database?.query(
          `INSERT INTO legacy_quarantine(
             import_key, source_id, record_digest, reason, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        );
        for (const item of actualItems) {
          addItem?.run(
            importKey,
            item.sourceId,
            item.recordDigest,
            item.kind,
            item.disposition,
            item.reason,
            item.cardId,
          );
          if (item.disposition === "quarantined") {
            quarantine?.run(
              importKey,
              item.sourceId,
              item.recordDigest,
              item.reason,
              now.value.toISOString(),
            );
          }
        }
      });
      commit.immediate();
      if (finalReport === null) throw new Error("Import produced no receipt.");
      dependencies.logger?.write("info", {
        event: "migration.apply.completed",
        fields: {
          sourceDigestPrefix: sourceDigest.slice(0, 12),
          counts: (finalReport as MigrationReconciliation).counts,
        },
      });
      return ok(finalReport as MigrationReconciliation);
    } catch (cause) {
      dependencies.logger?.write("error", {
        event: "migration.apply.failed",
        fields: { failureKind: "applyFailed" },
      });
      return err({
        kind: "applyFailed",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      database?.close();
    }
  };

  return { inspect, apply };
};
