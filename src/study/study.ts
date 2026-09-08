import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type {
  AnswerCard,
  AnswerOutcome,
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
  StudyQueue,
  StudyStatus,
} from "./contracts.ts";
import { asCardId } from "./contracts.ts";
import { canonicalizeCard, canonicalizeUpdatedContent } from "./identity.ts";
import { migrateStudyDatabase, STUDY_SCHEMA_VERSION } from "./migrations.ts";
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
        const insert = database.query(
          `INSERT INTO known_word(
             seed_id, seed_key, seed_version, lemma, reading, meaning, enabled
           ) VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(seed_id, seed_key) DO UPDATE SET
             seed_version = excluded.seed_version,
             lemma = excluded.lemma,
             reading = excluded.reading,
             meaning = excluded.meaning`,
        );
        for (const entry of seed.entries) {
          insert.run(
            seed.id,
            entry.key,
            seed.version,
            entry.lemma,
            entry.reading,
            entry.meaning,
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
      if (
        (command.action === "markKnown" && state === "known") ||
        (command.action === "suspend" && state === "suspended")
      ) {
        return current;
      }
      const now = safeNow(dependencies.clock);
      if (!now.ok) return now;
      const transition = database.transaction(() => {
        if (
          command.action === "markKnown" &&
          (state === "staged" || state === "active")
        ) {
          database
            .query(
              `UPDATE card_progress
               SET state = 'known', known_return_state = ?, support_ready_at = ?
               WHERE card_id = ?`,
            )
            .run(state, now.value.toISOString(), command.cardId);
          return;
        }
        if (command.action === "markNotKnown" && state === "known") {
          database
            .query(
              `UPDATE card_progress
               SET state = known_return_state, known_return_state = NULL,
                   support_ready_at = NULL, first_success_at = NULL,
                   first_success_day = NULL
               WHERE card_id = ?`,
            )
            .run(command.cardId);
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
            `SELECT c.id FROM card c
             JOIN card_progress p ON p.card_id = c.id
             WHERE p.state = 'staged'
             ORDER BY c.staging_priority DESC, c.staged_at, c.id
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
             sum(CASE WHEN state = 'known' THEN 1 ELSE 0 END) AS known_count,
             sum(CASE WHEN state = 'suspended' THEN 1 ELSE 0 END) AS suspended_count
           FROM card_progress`,
        )
        .get() as {
        staged_count: number | null;
        active_count: number | null;
        known_count: number | null;
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
        knownCount: counts.known_count ?? 0,
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
    if (now.value.getTime() - verified.value.issuedAt.getTime() > 10 * 60 * 1_000) {
      return err({ kind: "presentationExpired" });
    }
    const preference = preferences();
    if (!preference.ok) return preference;
    const day = localDayKey(now.value, preference.value.timeZone);
    if (!day.ok) return day;
    try {
      const used = database
        .query("SELECT 1 AS used FROM review_event WHERE permit_id = ?")
        .get(verified.value.id);
      if (used !== null) return err({ kind: "presentationAlreadyUsed" });
      const current = readCard(database, command.cardId);
      if (!current.ok) return current;
      if (current.value.state !== "active") {
        return err({ kind: "cardNotAnswerable", state: current.value.state });
      }
      const scheduleRow = database
        .query("SELECT schedule_json FROM schedule WHERE card_id = ?")
        .get(command.cardId) as { schedule_json: string } | null;
      if (scheduleRow === null) {
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
               presentation_contract_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          `SELECT seed_id, seed_key, lemma, reading, meaning, enabled
           FROM known_word ORDER BY seed_id, seed_key`,
        )
        .all() as {
        seed_id: string;
        seed_key: string;
        lemma: string;
        reading: string;
        meaning: string;
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
            source: "baseline" as const,
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
              source: "card" as const,
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

  const exportBackup = (): Result<StudyBackup, StudyFailure> => {
    const now = safeNow(dependencies.clock);
    if (!now.ok) return now;
    try {
      database.exec("PRAGMA wal_checkpoint(FULL)");
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
    preferences,
    setPreferences,
    setBaselineWordEnabled,
    exportBackup,
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
