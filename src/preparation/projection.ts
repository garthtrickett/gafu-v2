import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../result.ts";
import type {
  CardContent,
  StudyPreparationCard,
  StudyPreparationSnapshot,
} from "../study/contracts.ts";
import type {
  AnalysisManifest,
  AnalysisRunSnapshot,
  BatchCheckpoint,
  MergedCandidate,
  ProviderUsage,
} from "./batching-contracts.ts";
import type {
  CorrectionCommand,
  FindingClassification,
  FindingEvidence,
  PreparationFinding,
} from "./contracts.ts";
import { compareAnnotations } from "./evidence-expectations.ts";
import type { SubtitleSetId, SubtitleSetSnapshot } from "./import-contracts.ts";

const RANK_VERSION = "preparation-rank-v1" as const;

type CueRow = Readonly<{
  episode_key: string;
  episode_title: string;
  episode_order: number;
  cue_key: string;
  cue_order: number;
  start_ms: number;
  end_ms: number;
  raw_text: string;
  normalized_text: string;
}>;

export type StoredFinding = PreparationFinding &
  Readonly<{ evidence: readonly FindingEvidence[] }>;

type CorrectionOverlay = Partial<CorrectionCommand> & Readonly<{ correctedAt: string }>;

const clean = (value: string): string => value.normalize("NFKC").trim();
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const allCues = (database: Database, id: SubtitleSetId): readonly CueRow[] =>
  database
    .query(
      `SELECT c.episode_key, e.title AS episode_title, e.episode_order,
              c.cue_key, c.cue_order, c.start_ms, c.end_ms,
              c.raw_text, c.normalized_text
       FROM subtitle_cue c
       JOIN subtitle_episode e
         ON e.subtitle_set_id = c.subtitle_set_id AND e.episode_key = c.episode_key
       WHERE c.subtitle_set_id = ?
       ORDER BY e.episode_order, c.cue_order`,
    )
    .all(id) as CueRow[];

const normalizeEnglish = (value: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/gu, " ");

const vocabularyContent = (
  content: CardContent,
): content is Extract<CardContent, { lemma: string }> => "lemma" in content;

const matchingCard = (
  candidate: MergedCandidate,
  lemma: string | null,
  reading: string | null,
  partOfSpeech: string | null,
  meaning: string,
  senseId: string | null,
  cards: readonly StudyPreparationCard[],
): StudyPreparationCard | null => {
  const stableClaimKey =
    candidate.kind === "grammar"
      ? `grammar:${clean(candidate.canonicalKey)}`
      : senseId === null
        ? null
        : `vocabulary:${JSON.stringify([
            clean(lemma ?? ""),
            clean(reading ?? ""),
            clean(partOfSpeech ?? "").toLocaleLowerCase("en"),
            clean(senseId),
          ])}`;
  const stable =
    stableClaimKey === null
      ? null
      : (cards.find((card) =>
          card.identityClaims.some(
            (claim) =>
              (claim.authority === "gafu-preparation-v1" ||
                claim.authority === "gafu-capture-v1") &&
              claim.claimKey === stableClaimKey,
          ),
        ) ?? null);
  if (stable !== null) return stable;
  if (candidate.kind === "grammar") {
    return (
      cards.find(
        (card) =>
          card.type === "grammar" &&
          "canonicalForm" in card.content &&
          clean(card.content.canonicalForm) === clean(candidate.canonicalKey),
      ) ?? null
    );
  }
  return (
    cards.find(
      (card) =>
        card.type === "vocabulary" &&
        vocabularyContent(card.content) &&
        clean(card.content.lemma) === lemma &&
        clean(card.content.reading) === reading &&
        normalizeEnglish(card.content.partOfSpeech) ===
          normalizeEnglish(partOfSpeech ?? "") &&
        normalizeEnglish(card.content.meaning) === normalizeEnglish(meaning),
    ) ?? null
  );
};

const relationFor = (
  candidate: MergedCandidate,
  lemma: string | null,
  reading: string | null,
  partOfSpeech: string | null,
  meaning: string,
  senseId: string | null,
  study: StudyPreparationSnapshot,
): Readonly<{ relation: "missing" | "existing" | "known"; cardId: string | null }> => {
  if (
    candidate.kind === "grammar" &&
    study.grammar.some(
      (grammar) => clean(grammar.canonicalForm) === clean(candidate.canonicalKey),
    )
  ) {
    return { relation: "known", cardId: null };
  }
  if (
    candidate.kind === "vocabulary" &&
    study.vocabulary.some(
      (word) =>
        clean(word.lemma) === lemma &&
        clean(word.reading) === reading &&
        (word.partOfSpeech === null ||
          normalizeEnglish(word.partOfSpeech) ===
            normalizeEnglish(partOfSpeech ?? "")) &&
        (word.source === "baseline" ||
          normalizeEnglish(word.meaning) === normalizeEnglish(meaning)),
    )
  ) {
    return { relation: "known", cardId: null };
  }
  const card = matchingCard(
    candidate,
    lemma,
    reading,
    partOfSpeech,
    meaning,
    senseId,
    study.cards,
  );
  if (card === null) return { relation: "missing", cardId: null };
  return card.state === "known" || card.supportReady
    ? { relation: "known", cardId: card.cardId }
    : { relation: "existing", cardId: card.cardId };
};

const classification = (
  candidate: MergedCandidate,
  occurrences: number,
  episodes: number,
): FindingClassification => {
  if (candidate.impact === "required" || episodes >= 2 || occurrences >= 4) {
    return "required";
  }
  if (candidate.impact === "helpful" || occurrences >= 2) return "helpful";
  return "incidental";
};

export const projectFindings = (
  database: Database,
  set: SubtitleSetSnapshot,
  manifest: AnalysisManifest,
  merged: readonly MergedCandidate[],
  study: StudyPreparationSnapshot,
): readonly StoredFinding[] => {
  const cues = new Map(allCues(database, set.id).map((cue) => [cue.cue_key, cue]));
  const analyzedCues = new Map(
    manifest.batches.flatMap((batch) => batch.cues).map((cue) => [cue.cueId, cue]),
  );
  const corrections = new Map(
    (
      database
        .query(
          `SELECT finding_key, payload_json, corrected_at
           FROM preparation_correction WHERE subtitle_set_id = ?`,
        )
        .all(set.id) as {
        finding_key: string;
        payload_json: string;
        corrected_at: string;
      }[]
    ).map((row) => [
      row.finding_key,
      {
        ...(JSON.parse(row.payload_json) as Partial<CorrectionCommand>),
        correctedAt: row.corrected_at,
      } satisfies CorrectionOverlay,
    ]),
  );
  return merged
    .map((candidate): StoredFinding | null => {
      const evidence: FindingEvidence[] = candidate.evidence.flatMap((item) => {
        const cue = cues.get(item.cueId);
        return cue === undefined
          ? []
          : [
              {
                episodeKey: cue.episode_key,
                episodeTitle: cue.episode_title,
                episodeOrder: cue.episode_order,
                cueKey: cue.cue_key,
                cueOrder: cue.cue_order,
                startMs: cue.start_ms,
                endMs: cue.end_ms,
                surface: item.surface,
                context: cue.normalized_text,
                span: { start: item.span.start, end: item.span.end },
              },
            ];
      });
      const first = [...evidence].sort(
        (left, right) =>
          left.episodeOrder - right.episodeOrder ||
          left.cueOrder - right.cueOrder ||
          left.startMs - right.startMs,
      )[0];
      if (first === undefined) return null;
      const episodeCount = new Set(evidence.map((item) => item.episodeKey)).size;
      const firstAnalysis = analyzedCues.get(candidate.evidence[0]?.cueId ?? "");
      const firstEvidence = candidate.evidence[0];
      const token =
        candidate.kind === "vocabulary" &&
        firstAnalysis !== undefined &&
        firstEvidence !== undefined
          ? firstAnalysis.tokens.find(
              (item) =>
                item.span.start === firstEvidence.span.start &&
                item.span.end === firstEvidence.span.end,
            )
          : undefined;
      const lemma =
        token?.lemma ??
        (candidate.kind === "vocabulary"
          ? (candidate.canonicalKey.split(":")[0] ?? null)
          : null);
      const reading =
        token?.reading ??
        (candidate.kind === "vocabulary"
          ? candidate.canonicalKey.split(":").slice(1).join(":")
          : null);
      const partOfSpeech = token?.broadPartOfSpeech ?? null;
      const meaning = candidate.meanings[0] ?? "Meaning unresolved";
      const baseClassification = classification(
        candidate,
        evidence.length,
        episodeCount,
      );
      const early = Math.max(0, 30 - (first.episodeOrder - 1) * 4);
      const priority =
        Math.min(evidence.length, 20) * 4 +
        episodeCount * 15 +
        early +
        (candidate.impact === "required"
          ? 30
          : candidate.impact === "helpful"
            ? 15
            : 0);
      const key = `finding-v1:sha256:${sha256(
        JSON.stringify([candidate.kind, candidate.canonicalKey, candidate.senseIds]),
      )}`;
      const correction = corrections.get(key);
      const correctedMeaning = clean(correction?.meaning ?? meaning);
      const correctedSense =
        clean(correction?.senseId ?? candidate.senseIds[0] ?? "") || null;
      const relation = relationFor(
        candidate,
        lemma,
        reading,
        partOfSpeech,
        correctedMeaning,
        correctedSense,
        study,
      );
      const knownForSet = correction?.knownForSet === true;
      return {
        key,
        type: candidate.kind,
        canonicalKey: candidate.canonicalKey,
        lemma,
        reading,
        partOfSpeech,
        meaning: correctedMeaning,
        senseId: correctedSense,
        resolution:
          candidate.kind === "grammar" ||
          (correctedSense !== null &&
            (correction?.senseId !== undefined ||
              (candidate.ambiguity.length === 0 && candidate.meanings.length === 1)))
            ? "resolved"
            : "ambiguous",
        ambiguity: candidate.ambiguity,
        relation: knownForSet ? "known" : relation.relation,
        originalRelation: relation.relation,
        existingCardId: relation.cardId,
        classification: correction?.classification ?? baseClassification,
        originalClassification: baseClassification,
        disposition: correction?.disposition ?? "include",
        knownForSet,
        correctedAt: correction?.correctedAt ?? null,
        occurrenceCount: evidence.length,
        episodeCount,
        firstNeeded: {
          episodeOrder: first.episodeOrder,
          episodeTitle: first.episodeTitle,
          cueOrder: first.cueOrder,
          startMs: first.startMs,
        },
        priority,
        rankVersion: RANK_VERSION,
        rankReasons: [
          `${evidence.length} occurrence${evidence.length === 1 ? "" : "s"}`,
          `${episodeCount} episode${episodeCount === 1 ? "" : "s"}`,
          `first needed in episode ${first.episodeOrder}`,
          `${candidate.impact} comprehension impact`,
        ],
        confidence: candidate.confidence,
        evidence,
      };
    })
    .filter((item): item is StoredFinding => item !== null)
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.type.localeCompare(right.type) ||
        left.canonicalKey.localeCompare(right.canonicalKey) ||
        left.key.localeCompare(right.key),
    );
};

export const providerUsage = (batches: readonly BatchCheckpoint[]): ProviderUsage => {
  let input = 0;
  let output = 0;
  let completeInput = true;
  let completeOutput = true;
  for (const batch of batches) {
    if (batch.state !== "completed") continue;
    if (batch.response.usage.inputTokens === null) completeInput = false;
    else input += batch.response.usage.inputTokens;
    if (batch.response.usage.outputTokens === null) completeOutput = false;
    else output += batch.response.usage.outputTokens;
  }
  return {
    inputTokens: completeInput ? input : null,
    outputTokens: completeOutput ? output : null,
  };
};

/**
 * A final assertion that the whole manifest is represented. Batches are
 * checked as they commit, and cues partition into batches, so this should
 * never be the first thing to fail; it stays as defence against a batching
 * error rather than as the place provider mistakes are caught.
 */
export const validateCompleteEvidence = (
  manifest: AnalysisManifest,
  snapshot: AnalysisRunSnapshot,
): Result<void, Readonly<{ kind: "incompleteEvidence"; detail: string }>> => {
  const disagreement = compareAnnotations(
    manifest.batches.flatMap((batch) => [...batch.cues]),
    snapshot.batches.flatMap((batch) =>
      batch.state === "completed" ? [...batch.response.candidates] : [],
    ),
  );
  return disagreement === null
    ? ok(undefined)
    : err({ kind: "incompleteEvidence", detail: disagreement });
};

export const findingCounts = (findings: readonly PreparationFinding[]) => ({
  gap: findings.filter((item) => item.relation === "missing").length,
  existing: findings.filter((item) => item.relation === "existing").length,
  known: findings.filter((item) => item.relation === "known").length,
  ambiguous: findings.filter((item) => item.resolution === "ambiguous").length,
});
