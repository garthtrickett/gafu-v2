import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { MAXIMUM_BACKUP_BYTES } from "../recovery/contracts.ts";
import { err, ok, type Result } from "../result.ts";
import type {
  AnswerCard,
  AnswerOutcome,
  CaptureCardOutcome,
  CardContent,
  CardId,
  CardQuery,
  CardState,
  CardStateCommand,
  CardSummary,
  CreateCard,
  CreateCardOutcome,
  KnowledgeSnapshot,
  KnownWordSeed,
  PreferenceChange,
  Study,
  StudyBackup,
  StudyDependencies,
  StudyFailure,
  StudyPreferences,
  StudyPreparationSnapshot,
  StudyQueue,
  StudyStatus,
  SubtitleVocabularyCapture,
} from "./contracts.ts";
import { asCardId, PRESENTATION_PERMIT_LIFETIME_MS } from "./contracts.ts";
import {
  canonicalizeCard,
  canonicalizeUpdatedContent,
  normalizeVocabularyReading,
} from "./identity.ts";
import { migrateStudyDatabase, STUDY_SCHEMA_VERSION } from "./migrations.ts";
import { createPlanOperations } from "./plans.ts";
import {
  newSchedule,
  SCHEDULER_VERSION,
  type StoredSchedule,
  scheduleAnswer,
} from "./scheduler.ts";
import { localDayKey, validateTimeZone } from "./time.ts";

type CardRow = {
  id: string;
  type: "grammar" | "vocabulary";
  content_json: string;
  state: CardState;
  support_ready_at: string | null;
  staged_at: string;
  admitted_at: string | null;
  due_at: string | null;
  phase: CardSummary["schedulePhase"];
  review_count: number;
};

type PreferenceRow = {
  new_cards_per_day: number;
  time_zone: string;
};

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const safeNow = (clock: () => Date): Result<Date, StudyFailure> => {
  try {
    const now = clock();
    if (!Number.isFinite(now.getTime())) {
      return err({ kind: "clockFailed", detail: "clock returned an invalid date" });
    }
    return ok(new Date(now.getTime()));
  } catch (cause) {
    return err({ kind: "clockFailed", detail: detail(cause) });
  }
};

const readCardRow = (database: Database, cardId: string): CardRow | null =>
  database
    .query(
      `SELECT c.id, c.type, c.content_json, p.state, p.support_ready_at,
              c.staged_at, a.admitted_at, s.due_at, s.phase,
              count(r.id) AS review_count
       FROM card c
       JOIN card_progress p ON p.card_id = c.id
       LEFT JOIN admission_event a ON a.card_id = c.id
       LEFT JOIN schedule s ON s.card_id = c.id
       LEFT JOIN review_event r ON r.card_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`,
    )
    .get(cardId) as CardRow | null;

const toSummary = (row: CardRow): CardSummary => ({
  id: asCardId(row.id),
  type: row.type,
  content: JSON.parse(row.content_json) as CardContent,
  state: row.state,
  supportReadyAt: row.support_ready_at,
  stagedAt: row.staged_at,
  admittedAt: row.admitted_at,
  dueAt: row.due_at,
  schedulePhase: row.phase,
  reviewCount: row.review_count,
});

const readCard = (
  database: Database,
  cardId: string,
): Result<CardSummary, StudyFailure> => {
  try {
    const row = readCardRow(database, cardId);
    return row === null ? err({ kind: "cardNotFound", cardId }) : ok(toSummary(row));
  } catch (cause) {
    return err({ kind: "readFailed", detail: detail(cause) });
  }
};

const readPreferences = (database: Database): StudyPreferences => {
  const row = database
    .query(
      "SELECT new_cards_per_day, time_zone FROM study_preferences WHERE singleton = 1",
    )
    .get() as PreferenceRow;
  return {
    newCardsPerDay: row.new_cards_per_day,
    timeZone: row.time_zone,
  };
};

const applySeed = (
  database: Database,
  seed: KnownWordSeed,
  now: Date,
): Result<void, StudyFailure> => {
  try {
    const apply = database.transaction(() => {
      const current = database
        .query("SELECT version FROM seed_ledger WHERE seed_id = ?")
        .get(seed.id) as { version: string } | null;
      const effectiveVersion = seed.version ?? "unavailable";
      if (current?.version === effectiveVersion) return;
      if (seed.availability === "available" && seed.version !== null) {
        const disabled = new Set(
          (
            database
              .query(
                "SELECT seed_key FROM known_word WHERE seed_id = ? AND enabled = 0",
              )
              .all(seed.id) as { seed_key: string }[]
          ).map(({ seed_key }) => seed_key),
        );
        database.query("DELETE FROM known_word WHERE seed_id = ?").run(seed.id);
        const insert = database.query(
          `INSERT INTO known_word(
             seed_id, seed_key, seed_version, lemma, reading, meaning,
             part_of_speech, enabled
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const entry of seed.entries) {
          insert.run(
            seed.id,
            entry.key,
            seed.version,
            entry.lemma,
            entry.reading,
            entry.meaning,
            entry.partOfSpeech,
            disabled.has(entry.key) ? 0 : 1,
          );
        }
      }
      database
        .query(
          `INSERT INTO seed_ledger(seed_id, version, availability, applied_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(seed_id) DO UPDATE SET
             version = excluded.version,
             availability = excluded.availability,
             applied_at = excluded.applied_at`,
        )
        .run(seed.id, effectiveVersion, seed.availability, now.toISOString());
    });
    apply.immediate();
    return ok(undefined);
  } catch (cause) {
    return err({ kind: "writeFailed", detail: detail(cause) });
  }
};

const createStudy = (database: Database, dependencies: StudyDependencies): Study => {
  const createCard = (input: CreateCard): Result<CreateCardOutcome, StudyFailure> => {
    const canonical = canonicalizeCard(input);
    if (!canonical.ok) return canonical;
    if (
      input.type === "grammar" &&
      !dependencies.grammarTargetSupported(input.content.canonicalForm)
    ) {
      return err({
        kind: "invalidCard",
        field: "canonicalForm",
        detail: `No material can be generated for ${input.content.canonicalForm}.`,
      });
    }
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    try {
      const existing = database
        .query(
          "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
        )
        .get(canonical.value.claimAuthority, canonical.value.claimKey) as {
        card_id: string;
      } | null;
      if (existing !== null) {
        const card = readCard(database, existing.card_id);
        if (card.ok && card.value.state === "staged") {
          try {
            database
              .query(
                `INSERT OR IGNORE INTO staging_source(
                   card_id, source_kind, source_key, priority, active, created_at
                 ) VALUES (?, 'manual', ?, ?, 1, ?)`,
              )
              .run(
                card.value.id,
                card.value.id,
                input.stagingPriority ?? 0,
                now.value.toISOString(),
              );
          } catch (cause) {
            return err({ kind: "writeFailed", detail: detail(cause) });
          }
        }
        return card.ok ? ok({ outcome: "existing", card: card.value }) : card;
      }
      const cardId = dependencies.nextId();
      const priority = input.stagingPriority ?? 0;
      if (!Number.isSafeInteger(priority)) {
        return err({
          kind: "invalidCard",
          field: "stagingPriority",
          detail: "must be a safe integer",
        });
      }
      const insert = database.transaction(() => {
        database
          .query(
            `INSERT INTO card(id, type, content_json, searchable_text, staged_at, staging_priority)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            cardId,
            input.type,
            JSON.stringify(canonical.value.content),
            canonical.value.searchableText,
            now.value.toISOString(),
            priority,
          );
        database
          .query(
            "INSERT INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
          )
          .run(canonical.value.claimAuthority, canonical.value.claimKey, cardId);
        database
          .query("INSERT INTO card_progress(card_id, state) VALUES (?, 'staged')")
          .run(cardId);
        database
          .query(
            `INSERT INTO staging_source(
               card_id, source_kind, source_key, priority, active, created_at
             ) VALUES (?, 'manual', ?, ?, 1, ?)`,
          )
          .run(cardId, cardId, priority, now.value.toISOString());
      });
      insert.immediate();
      const card = readCard(database, cardId);
      return card.ok ? ok({ outcome: "created", card: card.value }) : card;
    } catch (cause) {
      // A concurrent or retried equivalent insert resolves as the same Card.
      const existing = database
        .query(
          "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
        )
        .get(canonical.value.claimAuthority, canonical.value.claimKey) as {
        card_id: string;
      } | null;
      if (existing !== null) {
        const card = readCard(database, existing.card_id);
        if (card.ok && card.value.state === "staged") {
          try {
            database
              .query(
                `INSERT OR IGNORE INTO staging_source(
                   card_id, source_kind, source_key, priority, active, created_at
                 ) VALUES (?, 'manual', ?, ?, 1, ?)`,
              )
              .run(
                card.value.id,
                card.value.id,
                input.stagingPriority ?? 0,
                now.value.toISOString(),
              );
          } catch (writeCause) {
            return err({ kind: "writeFailed", detail: detail(writeCause) });
          }
        }
        return card.ok ? ok({ outcome: "existing", card: card.value }) : card;
      }
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const listCards = (
    query: CardQuery = {},
  ): Result<readonly CardSummary[], StudyFailure> => {
    try {
      const rows = database
        .query(
          `SELECT c.id, c.type, c.content_json, p.state, p.support_ready_at,
                  c.staged_at, a.admitted_at, s.due_at, s.phase,
                  count(r.id) AS review_count
           FROM card c
           JOIN card_progress p ON p.card_id = c.id
           LEFT JOIN admission_event a ON a.card_id = c.id
           LEFT JOIN schedule s ON s.card_id = c.id
           LEFT JOIN review_event r ON r.card_id = c.id
           WHERE (?1 IS NULL OR c.searchable_text LIKE '%' || ?1 || '%')
             AND (?2 IS NULL OR c.type = ?2)
             AND (?3 IS NULL OR p.state = ?3)
           GROUP BY c.id
           ORDER BY c.staged_at, c.id`,
        )
        .all(
          query.search?.normalize("NFKC").trim().toLocaleLowerCase() || null,
          query.type ?? null,
          query.state ?? null,
        ) as CardRow[];
      return ok(rows.map(toSummary));
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const updateCard = (
    cardId: CardId,
    content: CardContent,
  ): Result<CardSummary, StudyFailure> => {
    const current = readCard(database, cardId);
    if (!current.ok) return current;
    const canonical = canonicalizeUpdatedContent(current.value.type, content);
    if (!canonical.ok) return canonical;
    try {
      const update = database.transaction(() => {
        const claim = database
          .query(
            "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
          )
          .get(canonical.value.claimAuthority, canonical.value.claimKey) as {
          card_id: string;
        } | null;
        if (claim !== null && claim.card_id !== cardId) {
          throw new IdentityConflict(claim.card_id);
        }
        database
          .query(
            "INSERT OR IGNORE INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
          )
          .run(canonical.value.claimAuthority, canonical.value.claimKey, cardId);
        database
          .query("UPDATE card SET content_json = ?, searchable_text = ? WHERE id = ?")
          .run(
            JSON.stringify(canonical.value.content),
            canonical.value.searchableText,
            cardId,
          );
      });
      update.immediate();
      return readCard(database, cardId);
    } catch (cause) {
      if (cause instanceof IdentityConflict) {
        return err({
          kind: "identityConflict",
          existingCardId: cause.existingCardId,
        });
      }
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const setCardState = (
    command: CardStateCommand,
  ): Result<CardSummary, StudyFailure> => {
    const current = readCard(database, command.cardId);
    if (!current.ok) return current;
    const { state } = current.value;
    try {
      if (command.action === "suspend" && state === "suspended") {
        return current;
      }
      const now = safeNow(dependencies.clock);
      if (!now.ok) return now;
      const transition = database.transaction(() => {
        // Explicit confirmation that the Card's language counts as known,
        // without leaving study. Nothing enters `known` through the
        // interface; earned cards stay in rotation on their schedules.
        if (
          command.action === "markSupportReady" &&
          (state === "staged" || state === "active")
        ) {
          database
            .query(
              `UPDATE card_progress SET support_ready_at = ?
               WHERE card_id = ? AND support_ready_at IS NULL`,
            )
            .run(now.value.toISOString(), command.cardId);
          return;
        }
        if (command.action === "suspend" && state !== "suspended") {
          database
            .query(
              `UPDATE card_progress
               SET state = 'suspended', suspended_return_state = ?
               WHERE card_id = ?`,
            )
            .run(state, command.cardId);
          return;
        }
        if (command.action === "restore" && state === "suspended") {
          database
            .query(
              `UPDATE card_progress
               SET state = suspended_return_state, suspended_return_state = NULL
               WHERE card_id = ?`,
            )
            .run(command.cardId);
          return;
        }
        throw new InvalidTransition(state, command.action);
      });
      transition.immediate();
      return readCard(database, command.cardId);
    } catch (cause) {
      return cause instanceof InvalidTransition
        ? err({
            kind: "invalidStateTransition",
            state: cause.state,
            action: cause.action,
          })
        : err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const preferences = (): Result<StudyPreferences, StudyFailure> => {
    try {
      return ok(readPreferences(database));
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const setPreferences = (
    change: PreferenceChange,
  ): Result<StudyPreferences, StudyFailure> => {
    const current = preferences();
    if (!current.ok) return current;
    const nextLimit = change.newCardsPerDay ?? current.value.newCardsPerDay;
    if (!Number.isSafeInteger(nextLimit) || nextLimit < 0 || nextLimit > 100) {
      return err({
        kind: "invalidPreference",
        field: "newCardsPerDay",
        detail: "must be a whole number from 0 through 100",
      });
    }
    const zone = validateTimeZone(change.timeZone ?? current.value.timeZone);
    if (!zone.ok) return zone;
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    try {
      const update = database.transaction(() => {
        database
          .query(
            `UPDATE study_preferences
             SET new_cards_per_day = ?, time_zone = ? WHERE singleton = 1`,
          )
          .run(nextLimit, zone.value);
        if (zone.value !== current.value.timeZone) {
          database
            .query(
              `INSERT INTO time_zone_change(
                 changed_at, previous_time_zone, next_time_zone
               ) VALUES (?, ?, ?)`,
            )
            .run(now.value.toISOString(), current.value.timeZone, zone.value);
        }
      });
      update.immediate();
      return ok({ newCardsPerDay: nextLimit, timeZone: zone.value });
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const captureVocabulary = (
    command: SubtitleVocabularyCapture,
  ): Result<CaptureCardOutcome, StudyFailure> => {
    const canonical = canonicalizeCard(command.card);
    if (!canonical.ok) return canonical;
    const operationKey = command.operationKey.normalize("NFKC").trim();
    const sourceKey = command.evidence.sourceKey.normalize("NFKC").trim();
    const cueKey = command.evidence.cueKey.normalize("NFKC").trim();
    const selectedSurface = command.evidence.selectedSurface.normalize("NFKC");
    const claimKey = command.identityClaim.claimKey.normalize("NFKC").trim();
    let claimedIdentity: unknown = null;
    try {
      claimedIdentity = claimKey.startsWith("vocabulary:")
        ? JSON.parse(claimKey.slice("vocabulary:".length))
        : null;
    } catch {
      claimedIdentity = null;
    }
    if (!("lemma" in canonical.value.content)) {
      return err({ kind: "invalidCapture", detail: "Capture Card is not vocabulary." });
    }
    const expectedIdentity = [
      canonical.value.content.lemma,
      canonical.value.content.reading,
      canonical.value.content.partOfSpeech
        .normalize("NFKC")
        .trim()
        .toLocaleLowerCase("en"),
    ];
    const { start, end } = command.evidence.span;
    if (
      operationKey === "" ||
      operationKey.length > 200 ||
      sourceKey === "" ||
      sourceKey.length > 300 ||
      cueKey === "" ||
      cueKey.length > 300 ||
      selectedSurface.trim() === "" ||
      selectedSurface.length > 100 ||
      claimKey === "" ||
      claimKey.length > 500 ||
      !Array.isArray(claimedIdentity) ||
      claimedIdentity.length !== 4 ||
      expectedIdentity.some((field, index) => {
        const claimed = claimedIdentity[index];
        return index === 1 && typeof claimed === "string"
          ? normalizeVocabularyReading(claimed.normalize("NFKC").trim()) !== field
          : index === 2 && typeof claimed === "string"
            ? claimed.normalize("NFKC").trim().toLocaleLowerCase("en") !== field
            : claimed !== field;
      }) ||
      typeof claimedIdentity[3] !== "string" ||
      claimedIdentity[3].trim() === "" ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start
    ) {
      return err({ kind: "invalidCapture", detail: "Capture evidence is invalid." });
    }
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    const payloadDigest = createHash("sha256")
      .update(
        JSON.stringify({
          card: canonical.value,
          identityClaim: { ...command.identityClaim, claimKey },
          evidence: { sourceKey, cueKey, selectedSurface, start, end },
        }),
      )
      .digest("hex");
    try {
      const prior = database
        .query(
          `SELECT payload_digest, card_id, outcome, evidence_added
           FROM capture_operation WHERE operation_key = ?`,
        )
        .get(operationKey) as {
        payload_digest: string;
        card_id: string;
        outcome: "created" | "existing";
        evidence_added: number;
      } | null;
      if (prior !== null) {
        if (prior.payload_digest !== payloadDigest) {
          return err({ kind: "captureOperationConflict" });
        }
        const card = readCard(database, prior.card_id);
        return card.ok
          ? ok({
              outcome: prior.outcome,
              card: card.value,
              evidenceAdded: prior.evidence_added === 1,
            })
          : card;
      }
      let cardId = "";
      let outcome: "created" | "existing" = "existing";
      let evidenceAdded = false;
      const commit = database.transaction(() => {
        const captureClaim = database
          .query(
            "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
          )
          .get(command.identityClaim.authority, claimKey) as {
          card_id: string;
        } | null;
        const manualClaim = database
          .query(
            "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
          )
          .get(canonical.value.claimAuthority, canonical.value.claimKey) as {
          card_id: string;
        } | null;
        if (
          captureClaim !== null &&
          manualClaim !== null &&
          captureClaim.card_id !== manualClaim.card_id
        ) {
          throw new CaptureFailure({
            kind: "identityConflict",
            existingCardId: captureClaim.card_id,
          });
        }
        cardId = captureClaim?.card_id ?? manualClaim?.card_id ?? "";
        if (cardId === "") {
          cardId = dependencies.nextId();
          outcome = "created";
          database
            .query(
              `INSERT INTO card(id, type, content_json, searchable_text, staged_at, staging_priority)
               VALUES (?, 'vocabulary', ?, ?, ?, ?)`,
            )
            .run(
              cardId,
              JSON.stringify(canonical.value.content),
              canonical.value.searchableText,
              now.value.toISOString(),
              command.card.stagingPriority ?? 0,
            );
          database
            .query(
              "INSERT INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
            )
            .run(canonical.value.claimAuthority, canonical.value.claimKey, cardId);
          database
            .query("INSERT INTO card_progress(card_id, state) VALUES (?, 'staged')")
            .run(cardId);
        }
        database
          .query(
            "INSERT OR IGNORE INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
          )
          .run(command.identityClaim.authority, claimKey, cardId);
        const evidence = database
          .query(
            `INSERT OR IGNORE INTO subtitle_capture_evidence(
               card_id, source_key, cue_key, selected_surface,
               span_start, span_end, captured_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            cardId,
            sourceKey,
            cueKey,
            selectedSurface,
            start,
            end,
            now.value.toISOString(),
          );
        evidenceAdded = evidence.changes === 1;
        const state = database
          .query("SELECT state FROM card_progress WHERE card_id = ?")
          .get(cardId) as { state: CardState };
        if (state.state === "staged") {
          database
            .query(
              `INSERT INTO staging_source(
                 card_id, source_kind, source_key, priority, active, created_at
               ) VALUES (?, 'capture', ?, ?, 1, ?)
               ON CONFLICT(card_id, source_kind, source_key) DO UPDATE SET active = 1`,
            )
            .run(
              cardId,
              `${sourceKey}:${cueKey}:${start}:${end}`,
              command.card.stagingPriority ?? 0,
              now.value.toISOString(),
            );
        }
        database
          .query(
            `INSERT INTO capture_operation(
               operation_key, payload_digest, card_id, outcome,
               evidence_added, captured_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            operationKey,
            payloadDigest,
            cardId,
            outcome,
            evidenceAdded ? 1 : 0,
            now.value.toISOString(),
          );
      });
      commit.immediate();
      const card = readCard(database, cardId);
      return card.ok ? ok({ outcome, card: card.value, evidenceAdded }) : card;
    } catch (cause) {
      return cause instanceof CaptureFailure
        ? err(cause.failure)
        : err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const planOperations = createPlanOperations(database, {
    clock: dependencies.clock,
    nextId: dependencies.nextId,
    preferences,
  });

  const studyQueue = (): Result<StudyQueue, StudyFailure> => {
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    const preference = preferences();
    if (!preference.ok) return preference;
    try {
      let newlyAdmitted = 0;
      let admissionDay = "";
      let admissionTimeZone = "";
      const admit = database.transaction(() => {
        const existingWindow = database
          .query(
            "SELECT local_day, time_zone FROM admission_window WHERE singleton = 1",
          )
          .get() as { local_day: string; time_zone: string } | null;
        if (existingWindow === null) {
          const initialDay = localDayKey(now.value, preference.value.timeZone);
          if (!initialDay.ok) throw new ClockFailure(initialDay.error);
          admissionDay = initialDay.value;
          admissionTimeZone = preference.value.timeZone;
          database
            .query(
              "INSERT INTO admission_window(singleton, local_day, time_zone) VALUES (1, ?, ?)",
            )
            .run(admissionDay, admissionTimeZone);
        } else {
          const dayInPinnedZone = localDayKey(now.value, existingWindow.time_zone);
          if (!dayInPinnedZone.ok) throw new ClockFailure(dayInPinnedZone.error);
          if (dayInPinnedZone.value === existingWindow.local_day) {
            admissionDay = existingWindow.local_day;
            admissionTimeZone = existingWindow.time_zone;
          } else {
            const nextDay = localDayKey(now.value, preference.value.timeZone);
            if (!nextDay.ok) throw new ClockFailure(nextDay.error);
            admissionDay = nextDay.value;
            admissionTimeZone = preference.value.timeZone;
            database
              .query(
                "UPDATE admission_window SET local_day = ?, time_zone = ? WHERE singleton = 1",
              )
              .run(admissionDay, admissionTimeZone);
          }
        }
        const admitted = database
          .query(
            "SELECT count(*) AS count FROM admission_event WHERE local_day = ? AND time_zone = ?",
          )
          .get(admissionDay, admissionTimeZone) as { count: number };
        const remaining = Math.max(0, preference.value.newCardsPerDay - admitted.count);
        if (remaining === 0) return;
        const staged = database
          .query(
            `SELECT c.id, max(ss.priority) AS effective_priority,
                    min(ss.created_at) AS source_created
             FROM card c
             JOIN card_progress p ON p.card_id = c.id
             JOIN staging_source ss ON ss.card_id = c.id AND ss.active = 1
             WHERE p.state = 'staged'
             GROUP BY c.id
             ORDER BY effective_priority DESC, source_created, c.id
             LIMIT ?`,
          )
          .all(remaining) as { id: string }[];
        const activate = database.query(
          "UPDATE card_progress SET state = 'active' WHERE card_id = ? AND state = 'staged'",
        );
        const addAdmission = database.query(
          `INSERT INTO admission_event(card_id, admitted_at, local_day, time_zone)
           VALUES (?, ?, ?, ?)`,
        );
        const addSchedule = database.query(
          `INSERT INTO schedule(
             card_id, due_at, phase, schedule_json, scheduler_version
           ) VALUES (?, ?, ?, ?, ?)`,
        );
        for (const row of staged) {
          const result = activate.run(row.id);
          if (result.changes !== 1) continue;
          const schedule = newSchedule(now.value);
          addAdmission.run(
            row.id,
            now.value.toISOString(),
            admissionDay,
            admissionTimeZone,
          );
          addSchedule.run(
            row.id,
            schedule.dueAt,
            schedule.phase,
            JSON.stringify(schedule),
            SCHEDULER_VERSION,
          );
          newlyAdmitted += 1;
        }
      });
      admit.immediate();
      const dueRows = database
        .query(
          `SELECT c.id, c.type, c.content_json, p.state, p.support_ready_at,
                  c.staged_at, a.admitted_at, s.due_at, s.phase,
                  count(r.id) AS review_count
           FROM card c
           JOIN card_progress p ON p.card_id = c.id
           JOIN admission_event a ON a.card_id = c.id
           JOIN schedule s ON s.card_id = c.id
           LEFT JOIN review_event r ON r.card_id = c.id
           WHERE p.state = 'active' AND s.due_at <= ?
           GROUP BY c.id
           ORDER BY CASE s.phase WHEN 'new' THEN 1 ELSE 0 END, s.due_at, c.id`,
        )
        .all(now.value.toISOString()) as CardRow[];
      const admitted = database
        .query(
          "SELECT count(*) AS count FROM admission_event WHERE local_day = ? AND time_zone = ?",
        )
        .get(admissionDay, admissionTimeZone) as { count: number };
      const staged = database
        .query("SELECT count(*) AS count FROM card_progress WHERE state = 'staged'")
        .get() as { count: number };
      return ok({
        generatedAt: now.value.toISOString(),
        localDay: admissionDay,
        admittedToday: admitted.count,
        newlyAdmitted,
        due: dueRows.map((row) => {
          const card = toSummary(row);
          if (card.dueAt === null || card.schedulePhase === null) {
            throw new Error("active due Card is missing its schedule");
          }
          return { card, dueAt: card.dueAt, phase: card.schedulePhase };
        }),
        stagedCount: staged.count,
      });
    } catch (cause) {
      if (cause instanceof ClockFailure) return err(cause.failure);
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const status = (): Result<StudyStatus, StudyFailure> => {
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    try {
      const counts = database
        .query(
          `SELECT
             sum(CASE WHEN state = 'staged' THEN 1 ELSE 0 END) AS staged_count,
             sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_count,
             sum(CASE WHEN state = 'suspended' THEN 1 ELSE 0 END) AS suspended_count
           FROM card_progress`,
        )
        .get() as {
        staged_count: number | null;
        active_count: number | null;
        suspended_count: number | null;
      };
      const due = database
        .query(
          `SELECT count(*) AS count FROM schedule s
           JOIN card_progress p ON p.card_id = s.card_id
           WHERE p.state = 'active' AND s.due_at <= ?`,
        )
        .get(now.value.toISOString()) as { count: number };
      return ok({
        observedAt: now.value.toISOString(),
        dueCount: due.count,
        stagedCount: counts.staged_count ?? 0,
        activeCount: counts.active_count ?? 0,
        suspendedCount: counts.suspended_count ?? 0,
      });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const answer = (command: AnswerCard): Result<AnswerOutcome, StudyFailure> => {
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    const verified = dependencies.permitVerifier.verify(command.permit, now.value);
    if (!verified.ok) return verified;
    if (verified.value.cardId !== command.cardId) {
      return err({ kind: "presentationForWrongCard" });
    }
    if (
      now.value.getTime() - verified.value.issuedAt.getTime() >
      PRESENTATION_PERMIT_LIFETIME_MS
    ) {
      return err({ kind: "presentationExpired" });
    }
    const preference = preferences();
    if (!preference.ok) return preference;
    const day = localDayKey(now.value, preference.value.timeZone);
    if (!day.ok) return day;
    try {
      const used = database
        .query(
          `SELECT card_id, grade, reviewed_at, after_schedule_json
           FROM review_event WHERE permit_id = ?`,
        )
        .get(verified.value.id) as {
        card_id: string;
        grade: string;
        reviewed_at: string;
        after_schedule_json: string;
      } | null;
      if (used !== null) {
        // The browser sends grades from an outbox, at least once. The same
        // grade for the same Card arriving again is that write replayed
        // after an ambiguous failure: answer as the first time did, record
        // nothing. A different grade on a spent permit is still refused.
        if (used.card_id === command.cardId && used.grade === command.grade) {
          const replayed = readCard(database, command.cardId);
          if (!replayed.ok) return replayed;
          const after = JSON.parse(used.after_schedule_json) as StoredSchedule;
          return ok({
            card: replayed.value,
            reviewedAt: used.reviewed_at,
            nextDueAt: after.dueAt,
          });
        }
        return err({ kind: "presentationAlreadyUsed" });
      }
      const current = readCard(database, command.cardId);
      if (!current.ok) return current;
      if (current.value.state !== "active") {
        return err({ kind: "cardNotAnswerable", state: current.value.state });
      }
      const scheduleRow = database
        .query("SELECT schedule_json, due_at FROM schedule WHERE card_id = ?")
        .get(command.cardId) as { schedule_json: string; due_at: string } | null;
      if (scheduleRow === null) {
        return err({ kind: "cardNotAnswerable", state: current.value.state });
      }
      if (new Date(scheduleRow.due_at).getTime() > now.value.getTime()) {
        return err({ kind: "cardNotAnswerable", state: current.value.state });
      }
      const before = JSON.parse(scheduleRow.schedule_json) as StoredSchedule;
      const after = scheduleAnswer(before, command.grade, now.value);
      if (!after.ok) return after;
      const eventId = dependencies.nextId();
      const apply = database.transaction(() => {
        database
          .query(
            `INSERT INTO review_event(
               id, card_id, permit_id, grade, reviewed_at, local_day, time_zone,
               before_schedule_json, after_schedule_json, scheduler_version,
               presentation_contract_version, presentation_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            eventId,
            command.cardId,
            verified.value.id,
            command.grade,
            now.value.toISOString(),
            day.value,
            preference.value.timeZone,
            JSON.stringify(before),
            JSON.stringify(after.value),
            SCHEDULER_VERSION,
            verified.value.contractVersion,
            verified.value.presentationId,
          );
        database
          .query(
            `UPDATE schedule SET due_at = ?, phase = ?, schedule_json = ?,
                                 scheduler_version = ?
             WHERE card_id = ?`,
          )
          .run(
            after.value.dueAt,
            after.value.phase,
            JSON.stringify(after.value),
            SCHEDULER_VERSION,
            command.cardId,
          );
        if (command.grade !== "again") {
          const progress = database
            .query(
              `SELECT first_success_at, first_success_day, support_ready_at
               FROM card_progress WHERE card_id = ?`,
            )
            .get(command.cardId) as {
            first_success_at: string | null;
            first_success_day: string | null;
            support_ready_at: string | null;
          };
          if (progress.first_success_at === null) {
            database
              .query(
                `UPDATE card_progress
                 SET first_success_at = ?, first_success_day = ?
                 WHERE card_id = ?`,
              )
              .run(now.value.toISOString(), day.value, command.cardId);
          } else if (
            progress.support_ready_at === null &&
            progress.first_success_day !== day.value &&
            now.value.getTime() - new Date(progress.first_success_at).getTime() >=
              20 * 60 * 60 * 1_000
          ) {
            database
              .query("UPDATE card_progress SET support_ready_at = ? WHERE card_id = ?")
              .run(now.value.toISOString(), command.cardId);
          }
        }
      });
      apply.immediate();
      const card = readCard(database, command.cardId);
      return card.ok
        ? ok({
            card: card.value,
            reviewedAt: now.value.toISOString(),
            nextDueAt: after.value.dueAt,
          })
        : card;
    } catch (cause) {
      if (String(cause).includes("review_event.permit_id")) {
        return err({ kind: "presentationAlreadyUsed" });
      }
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const knowledgeSnapshot = (): Result<KnowledgeSnapshot, StudyFailure> => {
    try {
      const allBaselineRows = database
        .query(
          `SELECT seed_id, seed_key, lemma, reading, meaning, part_of_speech, enabled
           FROM known_word ORDER BY seed_id, seed_key`,
        )
        .all() as {
        seed_id: string;
        seed_key: string;
        lemma: string;
        reading: string;
        meaning: string;
        part_of_speech: string | null;
        enabled: number;
      }[];
      const baselineRows = allBaselineRows.filter((row) => row.enabled === 1);
      const vocabularyCards = database
        .query(
          `SELECT c.id, c.content_json FROM card c
           JOIN card_progress p ON p.card_id = c.id
           WHERE c.type = 'vocabulary' AND p.support_ready_at IS NOT NULL
           ORDER BY c.id`,
        )
        .all() as { id: string; content_json: string }[];
      const vocabularySenseClaims = database
        .query(
          `SELECT i.card_id, i.claim_key FROM identity_claim i
           JOIN card c ON c.id = i.card_id
           JOIN card_progress p ON p.card_id = c.id
           WHERE c.type = 'vocabulary' AND p.support_ready_at IS NOT NULL
             AND i.authority IN ('gafu-preparation-v1', 'gafu-capture-v1')
           ORDER BY i.card_id, i.authority, i.claim_key`,
        )
        .all() as { card_id: string; claim_key: string }[];
      const vocabularyIdentityByCard = new Map(
        vocabularyCards.map((row) => {
          const content = JSON.parse(row.content_json) as {
            lemma: string;
            reading: string;
            partOfSpeech: string;
          };
          return [
            row.id,
            [
              content.lemma,
              content.reading,
              content.partOfSpeech.normalize("NFKC").trim().toLocaleLowerCase("en"),
            ],
          ] as const;
        }),
      );
      const senseIdsByCard = new Map<string, string[]>();
      for (const claim of vocabularySenseClaims) {
        if (!claim.claim_key.startsWith("vocabulary:")) continue;
        try {
          const fields = JSON.parse(claim.claim_key.slice("vocabulary:".length)) as
            | unknown[]
            | null;
          const expected = vocabularyIdentityByCard.get(claim.card_id);
          const senseId = Array.isArray(fields) ? fields[3] : null;
          if (
            expected === undefined ||
            !Array.isArray(fields) ||
            fields.length !== 4 ||
            expected.some((field, index) => {
              const claimed = fields[index];
              return index === 1 && typeof claimed === "string"
                ? normalizeVocabularyReading(claimed.normalize("NFKC").trim()) !== field
                : index === 2 && typeof claimed === "string"
                  ? claimed.normalize("NFKC").trim().toLocaleLowerCase("en") !== field
                  : claimed !== field;
            }) ||
            typeof senseId !== "string" ||
            senseId.trim() === ""
          ) {
            continue;
          }
          const values = senseIdsByCard.get(claim.card_id) ?? [];
          if (!values.includes(senseId)) values.push(senseId);
          senseIdsByCard.set(claim.card_id, values);
        } catch {
          // An invalid optional source claim cannot widen vocabulary knowledge.
        }
      }
      const grammarCards = database
        .query(
          `SELECT c.id, c.content_json FROM card c
           JOIN card_progress p ON p.card_id = c.id
           WHERE c.type = 'grammar' AND p.support_ready_at IS NOT NULL
           ORDER BY c.id`,
        )
        .all() as { id: string; content_json: string }[];
      const ledger = database
        .query("SELECT version, availability FROM seed_ledger WHERE seed_id = ?")
        .get(dependencies.knownWordSeed.id) as {
        version: string;
        availability: "available" | "unavailable";
      } | null;
      return ok({
        vocabulary: [
          ...baselineRows.map((row) => ({
            key: `${row.seed_id}:${row.seed_key}`,
            baselineKey: row.seed_key,
            lemma: row.lemma,
            reading: row.reading,
            meaning: row.meaning,
            partOfSpeech: row.part_of_speech,
            source: "baseline" as const,
            senseIds: [],
          })),
          ...vocabularyCards.map((row) => {
            const content = JSON.parse(row.content_json) as {
              lemma: string;
              reading: string;
              meaning: string;
            };
            return {
              key: `card:${row.id}`,
              baselineKey: null,
              lemma: content.lemma,
              reading: content.reading,
              meaning: content.meaning,
              partOfSpeech: (JSON.parse(row.content_json) as { partOfSpeech: string })
                .partOfSpeech,
              source: "card" as const,
              senseIds: senseIdsByCard.get(row.id) ?? [],
            };
          }),
        ],
        grammar: grammarCards.map((row) => ({
          cardId: asCardId(row.id),
          canonicalForm: (JSON.parse(row.content_json) as { canonicalForm: string })
            .canonicalForm,
        })),
        baseline: {
          id: dependencies.knownWordSeed.id,
          version:
            ledger === null || ledger.version === "unavailable" ? null : ledger.version,
          availability: ledger?.availability ?? "unavailable",
          enabledCount: baselineRows.length,
          entries: allBaselineRows.map((row) => ({
            key: row.seed_key,
            lemma: row.lemma,
            reading: row.reading,
            meaning: row.meaning,
            enabled: row.enabled === 1,
          })),
        },
      });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const setBaselineWordEnabled = (
    key: string,
    enabled: boolean,
  ): Result<KnowledgeSnapshot, StudyFailure> => {
    try {
      const result = database
        .query("UPDATE known_word SET enabled = ? WHERE seed_id = ? AND seed_key = ?")
        .run(enabled ? 1 : 0, dependencies.knownWordSeed.id, key);
      if (result.changes !== 1) {
        return err({ kind: "cardNotFound", cardId: `baseline:${key}` });
      }
      return knowledgeSnapshot();
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const preparationSnapshot = (): Result<StudyPreparationSnapshot, StudyFailure> => {
    const knowledge = knowledgeSnapshot();
    if (!knowledge.ok) return knowledge;
    try {
      const cards = listCards();
      if (!cards.ok) return cards;
      const claims = database
        .query(
          "SELECT authority, claim_key, card_id FROM identity_claim ORDER BY card_id, authority, claim_key",
        )
        .all() as { authority: string; claim_key: string; card_id: string }[];
      const claimsByCard = new Map<string, { authority: string; claimKey: string }[]>();
      for (const claim of claims) {
        const values = claimsByCard.get(claim.card_id) ?? [];
        values.push({ authority: claim.authority, claimKey: claim.claim_key });
        claimsByCard.set(claim.card_id, values);
      }
      const value = {
        vocabulary: knowledge.value.vocabulary,
        grammar: knowledge.value.grammar,
        cards: cards.value.map((card) => ({
          cardId: card.id,
          type: card.type,
          state: card.state,
          supportReady: card.supportReadyAt !== null,
          content: card.content,
          identityClaims: claimsByCard.get(card.id) ?? [],
        })),
      };
      const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
      return ok({ digest: `study-preparation-v1:sha256:${digest}`, ...value });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const exportBackup = (): Result<StudyBackup, StudyFailure> => {
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    try {
      database.exec("PRAGMA wal_checkpoint(FULL)");
      const pageCount = (
        database.query("PRAGMA page_count").get() as { page_count: number }
      ).page_count;
      const pageSize = (
        database.query("PRAGMA page_size").get() as { page_size: number }
      ).page_size;
      if (pageCount * pageSize > MAXIMUM_BACKUP_BYTES) {
        return err({
          kind: "backupFailed",
          detail: `Database exceeds the ${MAXIMUM_BACKUP_BYTES}-byte restore limit.`,
        });
      }
      const createdAt = now.value.toISOString();
      return ok({
        bytes: new Uint8Array(database.serialize()),
        filename: `gafu-v2-${createdAt.replace(/[:.]/gu, "-")}.sqlite`,
        createdAt,
        schemaVersion: STUDY_SCHEMA_VERSION,
      });
    } catch (cause) {
      return err({ kind: "backupFailed", detail: detail(cause) });
    }
  };

  return {
    createCard,
    listCards,
    updateCard,
    setCardState,
    studyQueue,
    status,
    answer,
    knowledgeSnapshot,
    preparationSnapshot,
    preferences,
    setPreferences,
    setBaselineWordEnabled,
    exportBackup,
    startPlan: planOperations.startPlan,
    listPlans: planOperations.listPlans,
    plan: planOperations.plan,
    setPlanState: planOperations.setPlanState,
    deletePlan: planOperations.deletePlan,
    captureVocabulary,
    close: () => database.close(),
  };
};

class InvalidTransition extends Error {
  constructor(
    readonly state: CardState,
    readonly action: CardStateCommand["action"],
  ) {
    super(`cannot ${action} from ${state}`);
  }
}

class ClockFailure extends Error {
  constructor(readonly failure: StudyFailure) {
    super(failure.kind);
  }
}

class IdentityConflict extends Error {
  constructor(readonly existingCardId: string) {
    super(`identity already belongs to ${existingCardId}`);
  }
}

class CaptureFailure extends Error {
  constructor(readonly failure: StudyFailure) {
    super(failure.kind);
  }
}

export const openStudy = (
  dependencies: StudyDependencies,
): Result<Study, StudyFailure> => {
  let database: Database;
  try {
    database = new Database(dependencies.databasePath, {
      strict: true,
      create: true,
    });
  } catch (cause) {
    return err({ kind: "openFailed", detail: detail(cause) });
  }
  const now = safeNow(dependencies.clock);
  if (!now.ok) {
    database.close();
    return now;
  }
  const migration = migrateStudyDatabase(database, now.value.toISOString());
  if (!migration.ok) {
    database.close();
    return migration;
  }
  const seeded = applySeed(database, dependencies.knownWordSeed, now.value);
  if (!seeded.ok) {
    database.close();
    return seeded;
  }
  return ok(createStudy(database, dependencies));
};

export const unavailableKaishiSeed: KnownWordSeed = {
  id: "kaishi-1.5k",
  version: null,
  availability: "unavailable",
  entries: [],
};
