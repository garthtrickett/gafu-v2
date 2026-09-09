import type { Database } from "bun:sqlite";
import type {
  PlanDraft,
  PlanId,
  PlanSnapshot,
  PlanStateCommand,
  PlanSummary,
  StartPlan,
} from "../preparation-plan-contracts.ts";
import { asPlanId, planDraftDigest } from "../preparation-plan-contracts.ts";
import { err, ok, type Result } from "../result.ts";
import type { CardContent, StudyFailure, StudyPreferences } from "./contracts.ts";
import { canonicalizeCard, normalizeVocabularyReading } from "./identity.ts";
import { localDayKey } from "./time.ts";

type Dependencies = Readonly<{
  clock: () => Date;
  nextId: () => string;
  preferences: () => Result<StudyPreferences, StudyFailure>;
}>;

type PlanRow = Readonly<{
  id: string;
  source_key: string;
  title: string;
  state: "active" | "paused";
  draft_digest: string;
  revision: number;
  episodes_json: string;
  created_cards: number;
  reused_cards: number;
  created_at: string;
  updated_at: string;
}>;

type MemberRow = Readonly<{
  finding_key: string;
  card_id: string;
  type: "grammar" | "vocabulary";
  content_json: string;
  classification: "required" | "helpful";
  preparation_priority: number;
  first_needed_episode_order: number;
  state: "staged" | "active" | "known" | "suspended";
  support_ready_at: string | null;
  rank_reasons_json: string;
  evidence_count: number;
  active_source_count: number;
}>;

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const label = (type: "grammar" | "vocabulary", content: CardContent): string =>
  type === "grammar" && "canonicalForm" in content
    ? content.canonicalForm
    : "lemma" in content
      ? content.lemma
      : type;

const addDays = (day: string, count: number): string => {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};

const validateDraft = (
  draft: PlanDraft,
): Result<
  readonly Readonly<{
    item: PlanDraft["items"][number];
    canonical: ReturnType<typeof canonicalizeCard> extends Result<infer Value, unknown>
      ? Value
      : never;
  }>[],
  StudyFailure
> => {
  const { digest, ...payload } = draft;
  if (
    draft.version !== "plan-draft-v1" ||
    digest !== planDraftDigest(payload) ||
    draft.sourceKey.trim() === "" ||
    draft.sourceRevision.trim() === "" ||
    draft.analysisRunId.trim() === "" ||
    draft.items.length === 0 ||
    draft.blockers.length > 0
  ) {
    return err({
      kind: "invalidPlanDraft",
      detail: "Plan Draft must be complete, non-empty, and free of blockers.",
    });
  }
  const findingKeys = new Set<string>();
  const values: {
    item: PlanDraft["items"][number];
    canonical: Exclude<ReturnType<typeof canonicalizeCard>, { ok: false }>["value"];
  }[] = [];
  for (const item of draft.items) {
    if (
      findingKeys.has(item.findingKey) ||
      item.evidence.length === 0 ||
      !Number.isSafeInteger(item.stagingPriority) ||
      !Number.isSafeInteger(item.preparationPriority) ||
      item.firstNeeded.episodeOrder < 1
    ) {
      return err({ kind: "invalidPlanDraft", detail: "Plan member is invalid." });
    }
    findingKeys.add(item.findingKey);
    const canonical = canonicalizeCard(item.proposedCard);
    if (!canonical.ok) return canonical;
    const sourceClaimValid = (() => {
      if (item.proposedCard.type === "grammar") {
        if (!("canonicalForm" in canonical.value.content)) return false;
        return (
          item.identityClaim.claimKey ===
          `grammar:${canonical.value.content.canonicalForm}`
        );
      }
      if (!("lemma" in canonical.value.content)) return false;
      if (!item.identityClaim.claimKey.startsWith("vocabulary:")) return false;
      try {
        const fields = JSON.parse(
          item.identityClaim.claimKey.slice("vocabulary:".length),
        ) as unknown;
        return (
          Array.isArray(fields) &&
          fields.length === 4 &&
          fields[0] === canonical.value.content.lemma &&
          typeof fields[1] === "string" &&
          normalizeVocabularyReading(fields[1].normalize("NFKC").trim()) ===
            canonical.value.content.reading &&
          fields[2] ===
            canonical.value.content.partOfSpeech
              .normalize("NFKC")
              .trim()
              .toLocaleLowerCase("en") &&
          typeof fields[3] === "string" &&
          fields[3].trim() !== ""
        );
      } catch {
        return false;
      }
    })();
    if (!sourceClaimValid) {
      return err({
        kind: "invalidPlanDraft",
        detail: "Plan member identity does not match its proposed Card.",
      });
    }
    values.push({ item, canonical: canonical.value });
  }
  return ok(values);
};

class PlanCommitFailure extends Error {
  constructor(readonly failure: StudyFailure) {
    super(failure.kind);
  }
}

export const createPlanOperations = (
  database: Database,
  dependencies: Dependencies,
): Readonly<{
  startPlan: (command: StartPlan) => Result<PlanSnapshot, StudyFailure>;
  listPlans: () => Result<readonly PlanSummary[], StudyFailure>;
  plan: (id: PlanId) => Result<PlanSnapshot, StudyFailure>;
  setPlanState: (command: PlanStateCommand) => Result<PlanSnapshot, StudyFailure>;
  deletePlan: (id: PlanId, confirmation: "delete") => Result<void, StudyFailure>;
}> => {
  const plan = (id: PlanId): Result<PlanSnapshot, StudyFailure> => {
    let now: Date;
    try {
      now = dependencies.clock();
      if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
    } catch (cause) {
      return err({ kind: "clockFailed", detail: detail(cause) });
    }
    const preference = dependencies.preferences();
    if (!preference.ok) return preference;
    try {
      const row = database
        .query(
          `SELECT id, source_key, title, state, draft_digest, revision,
                  episodes_json, created_cards, reused_cards, created_at, updated_at
           FROM preparation_plan WHERE id = ?`,
        )
        .get(id) as PlanRow | null;
      if (row === null) return err({ kind: "planNotFound", planId: id });
      const members = database
        .query(
          `SELECT m.finding_key, m.card_id, c.type, c.content_json,
                  m.classification, m.preparation_priority,
                  m.first_needed_episode_order, p.state, p.support_ready_at,
                  m.rank_reasons_json,
                  count(DISTINCT e.episode_key || char(0) || e.cue_key) AS evidence_count,
                  count(DISTINCT CASE WHEN s.active = 1 THEN s.source_kind || char(0) || s.source_key END) AS active_source_count
           FROM preparation_plan_member m
           JOIN card c ON c.id = m.card_id
           JOIN card_progress p ON p.card_id = m.card_id
           LEFT JOIN preparation_plan_evidence e
             ON e.plan_id = m.plan_id AND e.finding_key = m.finding_key
           LEFT JOIN staging_source s ON s.card_id = m.card_id
           WHERE m.plan_id = ?
           GROUP BY m.finding_key, m.card_id
           ORDER BY m.first_needed_episode_order,
                    CASE m.classification WHEN 'required' THEN 0 ELSE 1 END,
                    m.preparation_priority DESC, m.finding_key`,
        )
        .all(id) as MemberRow[];
      const evidenceRows = database
        .query(
          `SELECT finding_key, episode_key FROM preparation_plan_evidence
           WHERE plan_id = ? GROUP BY finding_key, episode_key`,
        )
        .all(id) as { finding_key: string; episode_key: string }[];
      const episodeByFinding = new Map<string, Set<string>>();
      for (const evidence of evidenceRows) {
        const values = episodeByFinding.get(evidence.finding_key) ?? new Set<string>();
        values.add(evidence.episode_key);
        episodeByFinding.set(evidence.finding_key, values);
      }

      const window = database
        .query("SELECT local_day, time_zone FROM admission_window WHERE singleton = 1")
        .get() as { local_day: string; time_zone: string } | null;
      const pinnedDay = window === null ? null : localDayKey(now, window.time_zone);
      if (pinnedDay !== null && !pinnedDay.ok) return pinnedDay;
      const useWindow =
        window !== null && pinnedDay !== null && pinnedDay.value === window.local_day;
      const day = useWindow
        ? (window as { local_day: string }).local_day
        : localDayKey(now, preference.value.timeZone);
      if (typeof day !== "string" && !day.ok) return day;
      const localDay = typeof day === "string" ? day : day.value;
      const zone = useWindow
        ? (window as { time_zone: string }).time_zone
        : preference.value.timeZone;
      const admitted = database
        .query(
          "SELECT count(*) AS count FROM admission_event WHERE local_day = ? AND time_zone = ?",
        )
        .get(localDay, zone) as { count: number };
      const eligible = database
        .query(
          `SELECT c.id, max(s.priority) AS priority, min(s.created_at) AS source_created
           FROM card c JOIN card_progress p ON p.card_id = c.id
           JOIN staging_source s ON s.card_id = c.id AND s.active = 1
           WHERE p.state = 'staged'
           GROUP BY c.id
           ORDER BY priority DESC, source_created, c.id`,
        )
        .all() as { id: string; priority: number; source_created: string }[];
      const introduction = new Map<string, string | null>();
      const limit = preference.value.newCardsPerDay;
      const todayRemaining = Math.max(0, limit - admitted.count);
      eligible.forEach((card, index) => {
        if (limit === 0) {
          introduction.set(card.id, null);
          return;
        }
        const offset =
          index < todayRemaining ? 0 : 1 + Math.floor((index - todayRemaining) / limit);
        introduction.set(card.id, addDays(localDay, offset));
      });

      const memberSnapshots = members.map((member) => {
        const content = JSON.parse(member.content_json) as CardContent;
        const ready = member.state === "known" || member.support_ready_at !== null;
        return {
          cardId: member.card_id,
          findingKey: member.finding_key,
          type: member.type,
          label: label(member.type, content),
          classification: member.classification,
          preparationPriority: member.preparation_priority,
          firstNeededEpisodeOrder: member.first_needed_episode_order,
          state: member.state,
          supportReady: member.support_ready_at !== null,
          ready,
          evidenceCount: member.evidence_count,
          rankReasons: JSON.parse(member.rank_reasons_json) as readonly string[],
          activeSourceCount: member.active_source_count,
        };
      });
      const episodes = JSON.parse(row.episodes_json) as readonly {
        episodeKey: string;
        order: number;
        title: string;
      }[];
      const episodeSnapshots = episodes.map((episode) => {
        const relevant = memberSnapshots.filter((member) =>
          episodeByFinding.get(member.findingKey)?.has(episode.episodeKey),
        );
        const required = relevant.filter(
          (member) => member.classification === "required",
        );
        const helpful = relevant.filter(
          (member) => member.classification === "helpful",
        );
        const stagedRequired = required.filter(
          (member) => !member.ready && member.state === "staged",
        );
        const days = stagedRequired.flatMap((member) => {
          const value = introduction.get(member.cardId);
          return value === undefined || value === null ? [] : [value];
        });
        return {
          episodeKey: episode.episodeKey,
          order: episode.order,
          title: episode.title,
          ready: required.every((member) => member.ready),
          requiredReady: required.filter((member) => member.ready).length,
          requiredTotal: required.length,
          helpfulReady: helpful.filter((member) => member.ready).length,
          helpfulTotal: helpful.length,
          estimatedIntroductionDay:
            stagedRequired.length > 0 && days.length === stagedRequired.length
              ? (days.sort().at(-1) ?? null)
              : null,
          inStudyUnknownReadiness: required.filter(
            (member) => !member.ready && member.state === "active",
          ).length,
          inactiveStagedBlockers: stagedRequired.filter(
            (member) => member.activeSourceCount === 0,
          ).length,
        };
      });
      return ok({
        id: asPlanId(row.id),
        sourceKey: row.source_key,
        title: row.title,
        state: row.state,
        revision: row.revision,
        draftDigest: row.draft_digest,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ready: episodeSnapshots.every((episode) => episode.ready),
        members: memberSnapshots.map(
          ({ activeSourceCount: _count, ...member }) => member,
        ),
        episodes: episodeSnapshots,
        createdCards: row.created_cards,
        reusedCards: row.reused_cards,
        newCardsPerDay: preference.value.newCardsPerDay,
      });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const startPlan = (command: StartPlan): Result<PlanSnapshot, StudyFailure> => {
    const operationKey = command.operationKey.normalize("NFKC").trim();
    if (operationKey === "" || operationKey.length > 200) {
      return err({ kind: "invalidPlanDraft", detail: "Operation key is invalid." });
    }
    const validated = validateDraft(command.draft);
    if (!validated.ok) return validated;
    let now: Date;
    try {
      now = dependencies.clock();
      if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
    } catch (cause) {
      return err({ kind: "clockFailed", detail: detail(cause) });
    }
    try {
      const prior = database
        .query(
          "SELECT draft_digest, plan_id FROM plan_start_operation WHERE operation_key = ?",
        )
        .get(operationKey) as { draft_digest: string; plan_id: string } | null;
      if (prior !== null) {
        return prior.draft_digest === command.draft.digest
          ? plan(asPlanId(prior.plan_id))
          : err({ kind: "planOperationConflict" });
      }
      let committedId = "";
      const commit = database.transaction(() => {
        const existingPlan = database
          .query(
            `SELECT id, state, draft_digest, revision, deleted_at
             FROM preparation_plan WHERE source_key = ?`,
          )
          .get(command.draft.sourceKey) as {
          id: string;
          state: "active" | "paused";
          draft_digest: string;
          revision: number;
          deleted_at: string | null;
        } | null;
        if (
          existingPlan?.draft_digest === command.draft.digest &&
          existingPlan.deleted_at === null
        ) {
          committedId = existingPlan.id;
          database
            .query(
              `INSERT INTO plan_start_operation(operation_key, draft_digest, plan_id, committed_at)
               VALUES (?, ?, ?, ?)`,
            )
            .run(operationKey, command.draft.digest, committedId, now.toISOString());
          return;
        }
        committedId = existingPlan?.id ?? dependencies.nextId();
        const state = existingPlan?.deleted_at === null ? existingPlan.state : "active";
        if (existingPlan !== null) {
          database
            .query(
              "UPDATE staging_source SET active = 0 WHERE source_kind = 'plan' AND source_key = ?",
            )
            .run(committedId);
          database
            .query("DELETE FROM preparation_plan_member WHERE plan_id = ?")
            .run(committedId);
        }
        let createdCards = 0;
        let reusedCards = 0;
        const resolved: { item: PlanDraft["items"][number]; cardId: string }[] = [];
        const cardIds = new Set<string>();
        for (const value of validated.value) {
          let cardId: string | null = null;
          if (value.item.existingCardId !== null) {
            const attached = database
              .query("SELECT type FROM card WHERE id = ?")
              .get(value.item.existingCardId) as { type: string } | null;
            const matchingClaim = database
              .query(
                "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
              )
              .get(value.canonical.claimAuthority, value.canonical.claimKey) as {
              card_id: string;
            } | null;
            if (
              attached === null ||
              attached.type !== value.item.proposedCard.type ||
              matchingClaim?.card_id !== value.item.existingCardId
            ) {
              throw new PlanCommitFailure({
                kind: "invalidPlanDraft",
                detail: "An attached Card no longer matches its identity.",
              });
            }
            cardId = value.item.existingCardId;
          }
          if (cardId === null) {
            const sourceClaim = database
              .query(
                "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
              )
              .get(
                value.item.identityClaim.authority,
                value.item.identityClaim.claimKey,
              ) as { card_id: string } | null;
            const manualClaim = database
              .query(
                "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
              )
              .get(value.canonical.claimAuthority, value.canonical.claimKey) as {
              card_id: string;
            } | null;
            if (
              sourceClaim !== null &&
              manualClaim !== null &&
              sourceClaim.card_id !== manualClaim.card_id
            ) {
              throw new PlanCommitFailure({
                kind: "identityConflict",
                existingCardId: sourceClaim.card_id,
              });
            }
            cardId = sourceClaim?.card_id ?? manualClaim?.card_id ?? null;
          }
          if (cardId === null) {
            cardId = dependencies.nextId();
            database
              .query(
                `INSERT INTO card(id, type, content_json, searchable_text, staged_at, staging_priority)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(
                cardId,
                value.item.proposedCard.type,
                JSON.stringify(value.canonical.content),
                value.canonical.searchableText,
                now.toISOString(),
                value.item.stagingPriority,
              );
            database
              .query(
                "INSERT INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
              )
              .run(value.canonical.claimAuthority, value.canonical.claimKey, cardId);
            database
              .query("INSERT INTO card_progress(card_id, state) VALUES (?, 'staged')")
              .run(cardId);
            createdCards += 1;
          } else {
            reusedCards += 1;
          }
          const sourceOwner = database
            .query(
              "SELECT card_id FROM identity_claim WHERE authority = ? AND claim_key = ?",
            )
            .get(
              value.item.identityClaim.authority,
              value.item.identityClaim.claimKey,
            ) as { card_id: string } | null;
          if (sourceOwner !== null && sourceOwner.card_id !== cardId) {
            throw new PlanCommitFailure({
              kind: "identityConflict",
              existingCardId: sourceOwner.card_id,
            });
          }
          database
            .query(
              "INSERT OR IGNORE INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
            )
            .run(
              value.item.identityClaim.authority,
              value.item.identityClaim.claimKey,
              cardId,
            );
          if (cardIds.has(cardId)) {
            throw new PlanCommitFailure({
              kind: "invalidPlanDraft",
              detail: "Two findings resolve to the same Card.",
            });
          }
          cardIds.add(cardId);
          resolved.push({ item: value.item, cardId });
        }
        if (existingPlan === null) {
          database
            .query(
              `INSERT INTO preparation_plan(
                 id, source_key, title, state, draft_digest, source_revision,
                 analysis_run_id, study_digest, revision, episodes_json,
                 created_cards, reused_cards, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
            )
            .run(
              committedId,
              command.draft.sourceKey,
              command.draft.title,
              state,
              command.draft.digest,
              command.draft.sourceRevision,
              command.draft.analysisRunId,
              command.draft.studyDigest,
              JSON.stringify(command.draft.episodes),
              createdCards,
              reusedCards,
              now.toISOString(),
              now.toISOString(),
            );
        } else {
          database
            .query(
              `UPDATE preparation_plan SET title = ?, state = ?, deleted_at = NULL,
                 draft_digest = ?, source_revision = ?,
                 analysis_run_id = ?, study_digest = ?, revision = ?, episodes_json = ?,
                 created_cards = ?, reused_cards = ?, updated_at = ? WHERE id = ?`,
            )
            .run(
              command.draft.title,
              state,
              command.draft.digest,
              command.draft.sourceRevision,
              command.draft.analysisRunId,
              command.draft.studyDigest,
              existingPlan.revision + 1,
              JSON.stringify(command.draft.episodes),
              createdCards,
              reusedCards,
              now.toISOString(),
              committedId,
            );
        }
        const addMember = database.query(
          `INSERT INTO preparation_plan_member(
             plan_id, finding_key, card_id, classification, preparation_priority,
             staging_priority, first_needed_episode_key, first_needed_episode_order,
             first_needed_episode_title, rank_reasons_json, proposed_relation
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const addEvidence = database.query(
          `INSERT INTO preparation_plan_evidence(plan_id, finding_key, episode_key, cue_key)
           VALUES (?, ?, ?, ?)`,
        );
        const addSource = database.query(
          `INSERT INTO staging_source(card_id, source_kind, source_key, priority, active, created_at)
           VALUES (?, 'plan', ?, ?, ?, ?)
           ON CONFLICT(card_id, source_kind, source_key) DO UPDATE SET
             priority = excluded.priority,
             active = excluded.active`,
        );
        for (const value of resolved) {
          addMember.run(
            committedId,
            value.item.findingKey,
            value.cardId,
            value.item.classification,
            value.item.preparationPriority,
            value.item.stagingPriority,
            value.item.firstNeeded.episodeKey,
            value.item.firstNeeded.episodeOrder,
            value.item.firstNeeded.episodeTitle,
            JSON.stringify(value.item.rankReasons),
            value.item.existingCardId === null ? "missing" : "existing",
          );
          for (const evidence of value.item.evidence) {
            addEvidence.run(
              committedId,
              value.item.findingKey,
              evidence.episodeKey,
              evidence.cueKey,
            );
          }
          addSource.run(
            value.cardId,
            committedId,
            value.item.stagingPriority,
            state === "active" ? 1 : 0,
            now.toISOString(),
          );
        }
        database
          .query(
            `INSERT INTO plan_start_operation(operation_key, draft_digest, plan_id, committed_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(operationKey, command.draft.digest, committedId, now.toISOString());
      });
      commit.immediate();
      return plan(asPlanId(committedId));
    } catch (cause) {
      return cause instanceof PlanCommitFailure
        ? err(cause.failure)
        : err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const listPlans = (): Result<readonly PlanSummary[], StudyFailure> => {
    try {
      const ids = database
        .query(
          `SELECT id FROM preparation_plan
           WHERE deleted_at IS NULL ORDER BY updated_at DESC, id`,
        )
        .all() as { id: string }[];
      const values: PlanSummary[] = [];
      for (const row of ids) {
        const snapshot = plan(asPlanId(row.id));
        if (!snapshot.ok) return snapshot;
        values.push({
          id: snapshot.value.id,
          sourceKey: snapshot.value.sourceKey,
          title: snapshot.value.title,
          state: snapshot.value.state,
          revision: snapshot.value.revision,
          ready: snapshot.value.ready,
          updatedAt: snapshot.value.updatedAt,
          memberCount: snapshot.value.members.length,
          readyEpisodes: snapshot.value.episodes.filter((episode) => episode.ready)
            .length,
          episodeCount: snapshot.value.episodes.length,
        });
      }
      return ok(values);
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const setPlanState = (
    command: PlanStateCommand,
  ): Result<PlanSnapshot, StudyFailure> => {
    const desired = command.action === "pause" ? "paused" : "active";
    let now: Date;
    try {
      now = dependencies.clock();
    } catch (cause) {
      return err({ kind: "clockFailed", detail: detail(cause) });
    }
    try {
      const update = database.transaction(() => {
        const changed = database
          .query(
            `UPDATE preparation_plan SET state = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(desired, now.toISOString(), command.planId);
        if (changed.changes === 0) {
          throw new PlanCommitFailure({
            kind: "planNotFound",
            planId: command.planId,
          });
        }
        database
          .query(
            "UPDATE staging_source SET active = ? WHERE source_kind = 'plan' AND source_key = ?",
          )
          .run(desired === "active" ? 1 : 0, command.planId);
      });
      update.immediate();
      return plan(command.planId);
    } catch (cause) {
      return cause instanceof PlanCommitFailure
        ? err(cause.failure)
        : err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const deletePlan = (
    id: PlanId,
    confirmation: "delete",
  ): Result<void, StudyFailure> => {
    if (confirmation !== "delete") {
      return err({
        kind: "invalidPlanTransition",
        detail: "Plan deletion requires explicit confirmation.",
      });
    }
    let now: Date;
    try {
      now = dependencies.clock();
      if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
    } catch (cause) {
      return err({ kind: "clockFailed", detail: detail(cause) });
    }
    try {
      const remove = database.transaction(() => {
        database
          .query(
            "UPDATE staging_source SET active = 0 WHERE source_kind = 'plan' AND source_key = ?",
          )
          .run(id);
        const changed = database
          .query(
            `UPDATE preparation_plan
             SET state = 'paused', deleted_at = coalesce(deleted_at, ?), updated_at = ?
             WHERE id = ?`,
          )
          .run(now.toISOString(), now.toISOString(), id);
        // Confirmed deletion is idempotent so a lost success response is safe to retry.
        void changed;
      });
      remove.immediate();
      return ok(undefined);
    } catch (cause) {
      return cause instanceof PlanCommitFailure
        ? err(cause.failure)
        : err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  return { startPlan, listPlans, plan, setPlanState, deletePlan };
};
