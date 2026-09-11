import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import type { Result } from "../result.ts";
import type {
  CardSummary,
  PresentationPermit,
  PresentationPermitVerifier,
  KnowledgeSnapshot as StudyKnowledgeSnapshot,
} from "../study/contracts.ts";
import type { DecodedPresentation, ReadingSegment } from "./contracts.ts";

export type MaterialMode = "teach" | "review";

type SharedMaterial = Readonly<{
  mode: MaterialMode;
  context: string;
  prompt: string;
  japanese: string;
  targetSurface: string;
  targetSpan: DecodedPresentation["targetSpan"];
  readingSegments: readonly ReadingSegment[];
  answer: string;
  explanation: string;
  usageNote: string;
}>;

export type VocabularyMaterial = SharedMaterial &
  Readonly<{
    targetKind: "vocabulary";
    target: Readonly<{
      lemma: string;
      reading: string;
      partOfSpeech: BroadPartOfSpeech;
      meaning: string;
    }>;
  }>;

export type GrammarMaterial = SharedMaterial &
  Readonly<{
    targetKind: "grammar";
    target: Readonly<{
      canonicalForm: string;
      meaning: string;
      formationHint: string;
    }>;
  }>;

export type GeneratedMaterial = VocabularyMaterial | GrammarMaterial;

export type MaterialProviderFailure =
  | { readonly kind: "providerNotConfigured" }
  | { readonly kind: "authentication"; readonly detail: string }
  | { readonly kind: "permission"; readonly detail: string }
  | { readonly kind: "rateLimit"; readonly detail: string }
  | { readonly kind: "offline"; readonly detail: string }
  | { readonly kind: "timeout"; readonly detail: string }
  | { readonly kind: "cancelled"; readonly detail: string }
  | { readonly kind: "refusal"; readonly detail: string }
  | { readonly kind: "incompleteResponse"; readonly detail: string }
  | { readonly kind: "malformedResponse"; readonly detail: string };

export type MaterialProviderRequest = Readonly<{
  mode: MaterialMode;
  card: CardSummary;
  knowledge: StudyKnowledgeSnapshot;
  recentJapanese: readonly string[];
  candidateCount: 3;
}>;

export type MaterialProviderResult = Readonly<{
  requestId: string;
  candidates: readonly unknown[];
  provider: string;
  model: string;
  promptVersion: string;
}>;

export type RedactedProviderRequest = Readonly<{
  endpoint: string;
  body: unknown;
}>;

export type MaterialProvider = Readonly<{
  identity: Readonly<{ provider: string; model: string; promptVersion: string }>;
  generate: (
    request: MaterialProviderRequest,
    signal?: AbortSignal,
  ) => Promise<Result<MaterialProviderResult, MaterialProviderFailure>>;
  inspectLastRequest: () => RedactedProviderRequest | null;
}>;

export type ProviderStatus = Readonly<{
  provider: string;
  model: string;
  configured: boolean;
  keyPersistence: "server-memory";
}>;

export type MaterialFailure =
  | MaterialProviderFailure
  | { readonly kind: "unsupportedGrammarTarget"; readonly canonicalForm: string }
  | { readonly kind: "unsupportedVocabularyPartOfSpeech"; readonly value: string }
  | { readonly kind: "validationRejected"; readonly reasons: readonly string[] }
  | { readonly kind: "tooSimilar" }
  | { readonly kind: "noValidCandidate" }
  | {
      readonly kind: "temporarilyUnavailable";
      readonly cause: MaterialProviderFailure["kind"];
    }
  | { readonly kind: "teachingNotAcknowledged" }
  /**
   * A new Card with nothing stored to teach from. First exposure shows only
   * material stored when the Card was made; Study never generates teaching,
   * so this fails fast instead of holding the session open on the provider.
   */
  | { readonly kind: "teachingNotPrepared" }
  | { readonly kind: "presentationNotFound" }
  | { readonly kind: "presentationAlreadyShown" }
  | { readonly kind: "inspectionDisabled" }
  | { readonly kind: "migrationFailed"; readonly detail: string }
  | { readonly kind: "readFailed"; readonly detail: string }
  | { readonly kind: "writeFailed"; readonly detail: string }
  | { readonly kind: "clockFailed"; readonly detail: string };

export type PreparedMaterial = Readonly<{
  id: string;
  cardId: CardSummary["id"];
  mode: MaterialMode;
  material: GeneratedMaterial;
  permit: PresentationPermit | null;
  source: "generated" | "reserve";
}>;

export type PrepareMaterial = Readonly<{
  card: CardSummary;
  knowledge: StudyKnowledgeSnapshot;
  signal?: AbortSignal;
}>;

export type LearningMaterial = Readonly<{
  prepare: (
    input: PrepareMaterial,
  ) => Promise<Result<PreparedMaterial, MaterialFailure>>;
  /**
   * Whether teaching has been acknowledged for the Card: the read-only half
   * of the new-vs-taught distinction `prepare` acts on. The server uses it to
   * offer learn and review as separate queues without preparing anything.
   */
  hasTeaching: (cardId: CardSummary["id"]) => Result<boolean, MaterialFailure>;
  acknowledgeTeaching: (
    cardId: CardSummary["id"],
    presentationId: string,
  ) => Result<void, MaterialFailure>;
  providerStatus: () => ProviderStatus;
  /**
   * Stores a teaching presentation written when the Card was made, so first
   * exposure shows the word in a sentence chosen for it rather than waiting on
   * the provider. It passes the same validator as generated material: authored
   * is not unvalidated. Review keeps generating, because varying the sentence
   * is the point of a review.
   */
  storeAuthoredTeaching: (
    input: Readonly<{
      card: CardSummary;
      knowledge: StudyKnowledgeSnapshot;
      value: unknown;
    }>,
  ) => Promise<Result<void, MaterialFailure>>;
  inspectLastRequest: () => Result<RedactedProviderRequest, MaterialFailure>;
  permitVerifier: PresentationPermitVerifier;
  close: () => void;
}>;

export type MaterialValidationInput = Readonly<{
  value: unknown;
  mode: MaterialMode;
  card: CardSummary;
  knowledge: StudyKnowledgeSnapshot;
}>;
