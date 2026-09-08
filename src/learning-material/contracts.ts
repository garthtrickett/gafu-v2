import type {
  AnalyzedToken,
  BroadPartOfSpeech,
  JapaneseAnalyzer,
  TextSpan,
} from "../analysis/contracts.ts";
import type { KnownVocabularyEntry } from "../analysis/known-vocabulary.ts";
import type { Result } from "../result.ts";

export type VocabularyTarget = Readonly<{
  kind: "vocabulary";
  lemma: string;
  reading: string;
  partOfSpeech: BroadPartOfSpeech;
  senseId: string;
}>;

export type GrammarTarget = Readonly<{
  kind: "grammar";
  canonicalForm: string;
}>;

export type CardCandidate = VocabularyTarget | GrammarTarget;

export type ReadingSegment = Readonly<{
  written: string;
  reading: string;
}>;

export type DecodedPresentation = Readonly<{
  japanese: string;
  targetSurface: string;
  targetSpan: TextSpan;
  readingSegments: readonly ReadingSegment[];
}>;

export type KnowledgeSnapshot = Readonly<{
  vocabulary: readonly KnownVocabularyEntry[];
  grammar: ReadonlySet<string>;
}>;

export type DetectedGrammar = Readonly<{
  canonicalForm: string;
  spans: readonly TextSpan[];
}>;

export type GrammarDetector = Readonly<{
  detect: (normalizedJapanese: string) => readonly DetectedGrammar[];
}>;

export type VocabularySenseResolver = Readonly<{
  resolve: (token: AnalyzedToken, normalizedJapanese: string) => readonly string[];
}>;

export type ValidationPolicy = Readonly<{
  transparentPartOfSpeech: ReadonlySet<BroadPartOfSpeech>;
}>;

export type ValidationError =
  | { readonly kind: "malformedStructure"; readonly field: string }
  | { readonly kind: "readingReconstructionMismatch" }
  | { readonly kind: "invalidTargetSpan" }
  | { readonly kind: "targetSurfaceMismatch" }
  | { readonly kind: "targetAbsent" }
  | { readonly kind: "wrongTargetIdentity" }
  | { readonly kind: "ambiguousTargetIdentity" }
  | { readonly kind: "unknownVocabulary"; readonly surfaces: readonly string[] }
  | { readonly kind: "unknownGrammar"; readonly canonicalForms: readonly string[] }
  | { readonly kind: "analysisUnavailable"; readonly cause: string }
  | { readonly kind: "analysisDegraded"; readonly cause: string };

export type ValidationRejection = Readonly<{
  kind: "rejected";
  reasons: readonly ValidationError[];
}>;

export type ValidatedPresentation = Readonly<{
  presentation: DecodedPresentation;
  normalizedJapanese: string;
  analyzer: string;
}>;

export type LearningMaterialValidator = Readonly<{
  validate: (
    providerValue: unknown,
    target: CardCandidate,
    knowledge: KnowledgeSnapshot,
  ) => Promise<Result<ValidatedPresentation, ValidationRejection>>;
}>;

export type ValidationDependencies = Readonly<{
  analyzer: JapaneseAnalyzer;
  grammar: GrammarDetector;
  senses: VocabularySenseResolver;
  policy: ValidationPolicy;
}>;
