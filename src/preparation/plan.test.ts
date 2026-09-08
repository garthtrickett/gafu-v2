import { describe, expect, test } from "bun:test";
import { asSubtitleSetId, type SubtitleSetSnapshot } from "./import-contracts.ts";
import { projectPlanDraft } from "./plan.ts";
import type { StoredFinding } from "./projection.ts";

const set: SubtitleSetSnapshot = {
  id: asSubtitleSetId("set-one"),
  title: "Fixture series",
  sourceRevision: "source-one",
  createdAt: "2026-09-08T00:00:00.000Z",
  episodes: [
    {
      episodeKey: "episode-one",
      title: "Episode 1",
      order: 1,
      displayName: "01.srt",
      cueCount: 1,
      durationMs: 2_000,
    },
  ],
  analysis: { state: "complete", completedBatches: 1, totalBatches: 1 },
};

const finding = (
  override: Partial<StoredFinding> & Pick<StoredFinding, "key">,
): StoredFinding => {
  const { key, ...rest } = override;
  return {
    key,
    type: "vocabulary",
    canonicalKey: "珈琲:コーヒー",
    lemma: "珈琲",
    reading: "コーヒー",
    partOfSpeech: "noun",
    meaning: "coffee",
    senseId: "fixture:coffee:1",
    resolution: "resolved",
    ambiguity: [],
    relation: "missing",
    originalRelation: "missing",
    existingCardId: null,
    classification: "required",
    originalClassification: "required",
    disposition: "include",
    knownForSet: false,
    correctedAt: null,
    occurrenceCount: 1,
    episodeCount: 1,
    firstNeeded: {
      episodeOrder: 1,
      episodeTitle: "Episode 1",
      cueOrder: 1,
      startMs: 1_000,
    },
    priority: 100,
    rankVersion: "preparation-rank-v1",
    rankReasons: ["fixture"],
    confidence: 0.99,
    evidence: [
      {
        episodeKey: "episode-one",
        episodeTitle: "Episode 1",
        episodeOrder: 1,
        cueKey: "cue-one",
        cueOrder: 1,
        startMs: 1_000,
        endMs: 2_000,
        surface: "珈琲",
        context: "珈琲を飲む。",
        span: { start: 0, end: 2 },
      },
    ],
    ...rest,
  };
};

describe("Plan Draft projection", () => {
  test("selects useful included work without a top-N cutoff", () => {
    const findings = Array.from({ length: 40 }, (_, index) =>
      finding({
        key: `finding-${index}`,
        lemma: `語${index}`,
        canonicalKey: `語${index}:ご`,
        senseId: `fixture:${index}`,
        priority: 100 - index,
      }),
    );
    const draft = projectPlanDraft({
      set,
      runId: "run-one",
      studyDigest: "study-one",
      findings: [
        ...findings,
        finding({ key: "incidental", classification: "incidental" }),
        finding({ key: "deferred", disposition: "defer" }),
        finding({ key: "known", relation: "known" }),
      ],
    });
    expect(draft.items).toHaveLength(40);
    expect(draft.selection).toMatchObject({ required: 40, vocabulary: 40 });
    expect(draft.blockers).toHaveLength(0);
    expect(draft.items[0]?.preparationPriority).toBe(100);
  });

  test("blocks ambiguous selected vocabulary and is deterministic", () => {
    const input = {
      set,
      runId: "run-one",
      studyDigest: "study-one",
      findings: [
        finding({
          key: "ambiguous",
          resolution: "ambiguous",
          senseId: null,
          ambiguity: ["coffee", "cafe"],
        }),
      ],
    } as const;
    const first = projectPlanDraft(input);
    const second = projectPlanDraft(input);
    expect(first).toEqual(second);
    expect(first.items).toHaveLength(0);
    expect(first.blockers).toEqual([
      {
        findingKey: "ambiguous",
        label: "珈琲【コーヒー】",
        reason: "ambiguousVocabulary",
      },
    ]);
  });
});
