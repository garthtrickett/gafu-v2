import type {
  AnalyzedText,
  AnalyzedToken,
  BroadPartOfSpeech,
  JapaneseAnalyzer,
} from "./analysis/contracts.ts";
import { classifyKnownVocabulary } from "./analysis/known-vocabulary.ts";
import type {
  CardCandidate,
  DecodedPresentation,
  KnowledgeSnapshot,
  ValidationError,
} from "./learning-material/contracts.ts";
import {
  declaredGrammarDetector,
  declaredGrammarForms,
} from "./learning-material/declared-grammar.ts";
import { createLearningMaterialValidator } from "./learning-material/validator.ts";
import { createPreparationBatching } from "./preparation/batching.ts";
import type {
  AnalysisBatch,
  AnalyzedCue,
  BatchProvider,
  CandidateEvidence,
  ProviderBatchResponse,
} from "./preparation/batching-contracts.ts";
import { createInMemoryCheckpointStore } from "./preparation/in-memory-checkpoint-store.ts";
import { err, ok, type Result } from "./result.ts";

export type Phase0ProofFailure =
  | { readonly kind: "analysisFailed"; readonly cueId: string; readonly detail: string }
  | {
      readonly kind: "fixtureTargetMissing";
      readonly cueId: string;
      readonly surface: string;
    }
  | { readonly kind: "batchingFailed"; readonly detail: string }
  | { readonly kind: "validMaterialRejected"; readonly detail: string }
  | { readonly kind: "invalidMaterialAccepted"; readonly fixture: string };

export type Phase0Proof = Readonly<{
  analyzedCues: number;
  analyzedTokens: number;
  knownContentTokens: number;
  unknownContentTokens: number;
  batches: number;
  canonicalCandidates: number;
  evidenceLinks: number;
  finalBatchTargetFound: boolean;
  validMaterialAccepted: boolean;
  invalidMaterial: readonly Readonly<{
    fixture: string;
    reasons: readonly ValidationError["kind"][];
  }>[];
  durationMs: number;
}>;

type CueSpec = Readonly<{
  cueId: string;
  japanese: string;
  targetSurface: string;
  candidateKind: CandidateEvidence["kind"];
  grammarForm: string | null;
}>;

const cues: readonly CueSpec[] = [
  {
    cueId: "diagnostic:episode-1:001",
    japanese: "猫が魚を食べている。",
    targetSurface: "食べ",
    candidateKind: "vocabulary",
    grammarForm: null,
  },
  {
    cueId: "diagnostic:episode-1:002",
    japanese: "本を読んだ。",
    targetSurface: "読ん",
    candidateKind: "vocabulary",
    grammarForm: null,
  },
  {
    cueId: "diagnostic:episode-2:001",
    japanese: "雨かもしれない。",
    targetSurface: "かもしれない",
    candidateKind: "grammar",
    grammarForm: "〜かもしれない",
  },
  {
    cueId: "diagnostic:episode-2:002",
    japanese: "最後に目標を見つけた。",
    targetSurface: "見つけ",
    candidateKind: "vocabulary",
    grammarForm: null,
  },
];

const transparent = new Set<BroadPartOfSpeech>([
  "particle",
  "auxiliary",
  "copula",
  "symbol",
]);

const presentation = (japanese: string, targetSurface: string): DecodedPresentation => {
  const start = japanese.indexOf(targetSurface);
  return {
    japanese,
    targetSurface,
    targetSpan: {
      start,
      end: start + targetSurface.length,
      unit: "utf16-code-unit",
      normalization: "nfkc-v1",
    },
    readingSegments: [{ written: japanese, reading: "" }],
  };
};

const vocabularyCandidate = (
  cueId: string,
  token: AnalyzedToken,
): CandidateEvidence => ({
  kind: "vocabulary",
  canonicalKey: `${token.lemma}:${token.reading ?? ""}`,
  cueId,
  surface: token.surface,
  span: token.span,
  meaning: token.lemma,
  senseId: `fixture:${token.lemma}:${token.reading ?? ""}`,
  impact: "helpful",
  confidence: 1,
  ambiguity: token.senseCandidates,
});

const grammarCandidate = (spec: CueSpec): CandidateEvidence => {
  const start = spec.japanese.indexOf(spec.targetSurface);
  return {
    kind: "grammar",
    canonicalKey: spec.grammarForm ?? "",
    cueId: spec.cueId,
    surface: spec.targetSurface,
    span: {
      start,
      end: start + spec.targetSurface.length,
      unit: "utf16-code-unit",
      normalization: "nfkc-v1",
    },
    meaning: spec.grammarForm ?? "",
    senseId: null,
    impact: "helpful",
    confidence: 1,
    ambiguity: [],
  };
};

const diagnosticProvider = (
  candidates: ReadonlyMap<string, CandidateEvidence>,
): BatchProvider => {
  const responses = new Map<string, ProviderBatchResponse>();
  return {
    identity: {
      provider: "phase-0-deterministic-fake",
      model: "fixture-v1",
      promptVersion: "diagnostic-v1",
    },
    submit: async (
      batch: AnalysisBatch,
      requestKey: string,
      dispatched: (providerResponseId: string) => Promise<void>,
    ) => {
      const response: ProviderBatchResponse = {
        providerRequestId: `diagnostic:${requestKey}`,
        candidates: batch.cues.flatMap((cue) => {
          const candidate = candidates.get(cue.cueId);
          return candidate === undefined ? [] : [candidate];
        }),
        usage: { inputTokens: null, outputTokens: null },
      };
      responses.set(response.providerRequestId, response);
      await dispatched(response.providerRequestId);
      return ok(response);
    },
    retrieve: async (_batch, providerResponseId) =>
      ok(responses.get(providerResponseId) ?? null),
  };
};

const analyzeAll = async (
  analyzer: JapaneseAnalyzer,
): Promise<Result<readonly AnalyzedText[], Phase0ProofFailure>> => {
  const analyses: AnalyzedText[] = [];
  for (const cue of cues) {
    const analyzed = await analyzer.analyze(cue.cueId, cue.japanese);
    if (!analyzed.ok) {
      return err({
        kind: "analysisFailed",
        cueId: cue.cueId,
        detail: "cause" in analyzed.error ? analyzed.error.cause : analyzed.error.kind,
      });
    }
    analyses.push(analyzed.value);
  }
  return ok(analyses);
};

export const runPhase0Proof = async (
  analyzer: JapaneseAnalyzer,
): Promise<Result<Phase0Proof, Phase0ProofFailure>> => {
  const started = performance.now();
  const analyzed = await analyzeAll(analyzer);
  if (!analyzed.ok) return analyzed;

  const byCue = new Map(analyzed.value.map((item) => [item.cueId, item]));
  const candidates = new Map<string, CandidateEvidence>();
  const batchCues: AnalyzedCue[] = [];
  for (const spec of cues) {
    const analysis = byCue.get(spec.cueId);
    if (analysis === undefined) {
      return err({
        kind: "analysisFailed",
        cueId: spec.cueId,
        detail: "analysis result was not retained",
      });
    }
    const token = analysis.tokens.find((item) => item.surface === spec.targetSurface);
    if (spec.candidateKind === "vocabulary" && token === undefined) {
      return err({
        kind: "fixtureTargetMissing",
        cueId: spec.cueId,
        surface: spec.targetSurface,
      });
    }
    candidates.set(
      spec.cueId,
      spec.candidateKind === "vocabulary"
        ? vocabularyCandidate(spec.cueId, token as AnalyzedToken)
        : grammarCandidate(spec),
    );
    batchCues.push({
      cueId: spec.cueId,
      normalizedJapanese: analysis.normalizedText,
      tokens: analysis.tokens.map((item) => ({
        surface: item.surface,
        lemma: item.lemma,
        reading: item.reading,
        partOfSpeech: item.partOfSpeech,
        broadPartOfSpeech: item.broadPartOfSpeech,
        span: item.span,
      })),
      grammarEvidence: declaredGrammarDetector.detect(analysis.normalizedText),
    });
  }

  const knownSurfaces = new Set(["猫", "魚", "本", "雨"]);
  const knownVocabulary = analyzed.value.flatMap((analysis) =>
    analysis.tokens
      .filter((token) => knownSurfaces.has(token.surface))
      .map((token) => ({
        lemma: token.lemma,
        reading: token.reading,
        partOfSpeech: token.broadPartOfSpeech,
        scope: { kind: "allSenses" as const },
      })),
  );
  const classifications = analyzed.value.flatMap((analysis) =>
    classifyKnownVocabulary(analysis, knownVocabulary).filter(
      ({ token }) => !transparent.has(token.broadPartOfSpeech),
    ),
  );

  const provider = diagnosticProvider(candidates);
  const batching = createPreparationBatching({
    provider,
    store: createInMemoryCheckpointStore(),
    normalizationVersion: "nfkc-v1",
    analyzerVersion: analyzer.name,
  });
  const manifest = await batching.createManifest(batchCues, 1);
  const batchResult = await batching.analyze(manifest);
  if (batchResult.state !== "complete" || batchResult.merged === null) {
    return err({
      kind: "batchingFailed",
      detail: batchResult.failure?.kind ?? batchResult.state,
    });
  }

  const materialSpec = cues[0];
  const materialAnalysis = analyzed.value[0];
  if (materialSpec === undefined || materialAnalysis === undefined) {
    return err({ kind: "analysisFailed", cueId: "first", detail: "fixture empty" });
  }
  const targetToken = materialAnalysis.tokens.find(
    (token) => token.surface === materialSpec.targetSurface,
  );
  if (targetToken === undefined) {
    return err({
      kind: "fixtureTargetMissing",
      cueId: materialSpec.cueId,
      surface: materialSpec.targetSurface,
    });
  }
  const target: CardCandidate = {
    kind: "vocabulary",
    lemma: targetToken.lemma,
    reading: targetToken.reading ?? "",
    partOfSpeech: targetToken.broadPartOfSpeech,
    senseId: `sense:${targetToken.lemma}`,
  };
  const support: KnowledgeSnapshot = {
    vocabulary: materialAnalysis.tokens
      .filter(
        (token) =>
          token.span.start !== targetToken.span.start &&
          !transparent.has(token.broadPartOfSpeech),
      )
      .map((token) => ({
        lemma: token.lemma,
        reading: token.reading,
        partOfSpeech: token.broadPartOfSpeech,
        scope: { kind: "allSenses" as const },
      })),
    grammar: new Set(declaredGrammarForms),
  };
  const validator = createLearningMaterialValidator({
    analyzer,
    grammar: declaredGrammarDetector,
    senses: { resolve: (token) => [`sense:${token.lemma}`] },
    policy: { transparentPartOfSpeech: transparent },
  });
  const validPresentation = presentation(
    materialSpec.japanese,
    materialSpec.targetSurface,
  );
  const valid = await validator.validate(validPresentation, target, support);
  if (!valid.ok) {
    return err({
      kind: "validMaterialRejected",
      detail: valid.error.reasons.map((reason) => reason.kind).join(","),
    });
  }

  const unknownJapanese = materialSpec.japanese.replace("。", "宇宙船。");
  const unknownGrammarJapanese = materialSpec.japanese.replace("。", "かもしれない。");
  const invalidFixtures = [
    {
      fixture: "reading-reconstruction",
      value: {
        ...validPresentation,
        readingSegments: [{ written: "一致しない", reading: "" }],
      },
      knowledge: support,
    },
    {
      fixture: "extra-unknown-vocabulary",
      value: presentation(unknownJapanese, materialSpec.targetSurface),
      knowledge: support,
    },
    {
      fixture: "extra-unknown-grammar",
      value: presentation(unknownGrammarJapanese, materialSpec.targetSurface),
      knowledge: {
        ...support,
        grammar: new Set(
          [...support.grammar].filter((form) => form !== "〜かもしれない"),
        ),
      },
    },
  ] as const;
  const invalidMaterial: {
    fixture: string;
    reasons: readonly ValidationError["kind"][];
  }[] = [];
  for (const fixture of invalidFixtures) {
    const decision = await validator.validate(fixture.value, target, fixture.knowledge);
    if (decision.ok) {
      return err({ kind: "invalidMaterialAccepted", fixture: fixture.fixture });
    }
    invalidMaterial.push({
      fixture: fixture.fixture,
      reasons: decision.error.reasons.map((reason) => reason.kind),
    });
  }

  const finalCandidate = candidates.get(cues.at(-1)?.cueId ?? "");
  return ok({
    analyzedCues: analyzed.value.length,
    analyzedTokens: analyzed.value.reduce(
      (count, analysis) => count + analysis.tokens.length,
      0,
    ),
    knownContentTokens: classifications.filter((item) => item.status === "known")
      .length,
    unknownContentTokens: classifications.filter((item) => item.status !== "known")
      .length,
    batches: manifest.batches.length,
    canonicalCandidates: batchResult.merged.length,
    evidenceLinks: batchResult.merged.reduce(
      (count, candidate) => count + candidate.evidence.length,
      0,
    ),
    finalBatchTargetFound:
      finalCandidate !== undefined &&
      batchResult.merged.some(
        (candidate) => candidate.canonicalKey === finalCandidate.canonicalKey,
      ),
    validMaterialAccepted: true,
    invalidMaterial,
    durationMs: Math.round((performance.now() - started) * 10) / 10,
  });
};
