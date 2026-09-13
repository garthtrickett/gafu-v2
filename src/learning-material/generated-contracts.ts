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

/** One Card in a batch generation; knowledge is shared across the batch. */
export type MaterialBatchTarget = Readonly<{
  mode: MaterialMode;
  card: CardSummary;
  recentJapanese: readonly string[];
  /** Why an earlier round's candidates for this Card were rejected, if any. */
  previousRejections: readonly string[];
}>;

export type MaterialBatchItem = Readonly<{
  cardId: CardSummary["id"];
  candidates: readonly unknown[];
}>;

export type MaterialBatchPoll =
  | { readonly status: "pending" }
  | { readonly status: "complete"; readonly items: readonly MaterialBatchItem[] };

/**
 * Whole-batch generation: one provider request for every Card, dispatched
 * in the background and polled to completion across separate calls, so no
 * single HTTP call from the browser has to outlive the generation. A Card
 * the provider returns nothing usable for is dropped, not the batch.
 */
export type MaterialBatch = Readonly<{
  dispatch: (
    targets: readonly MaterialBatchTarget[],
    knowledge: StudyKnowledgeSnapshot,
    signal?: AbortSignal,
  ) => Promise<Result<{ jobId: string }, MaterialProviderFailure>>;
  poll: (
    jobId: string,
    signal?: AbortSignal,
  ) => Promise<Result<MaterialBatchPoll, MaterialProviderFailure>>;
}>;

export type MaterialProvider = Readonly<{
  identity: Readonly<{ provider: string; model: string; promptVersion: string }>;
  generate: (
    request: MaterialProviderRequest,
    signal?: AbortSignal,
  ) => Promise<Result<MaterialProviderResult, MaterialProviderFailure>>;
  inspectLastRequest: () => RedactedProviderRequest | null;
  /** Absent means the review batch falls back to one Card per advance. */
  batch?: MaterialBatch | undefined;
}>;

export type ProviderStatus = Readonly<{
  provider: string;
  model: string;
  configured: boolean;
  keyPersistence: "server-memory";
  /** The voice speaking sentences, or null when clips are off. */
  speech: Readonly<{ provider: string; voice: string }> | null;
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
  | { readonly kind: "reviewBatchNotFound"; readonly batchId: string }
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
  /**
   * Where the browser fetches the spoken sentence, or null when no clip
   * exists: speech unconfigured, the daily ceiling reached, or synthesis
   * failed. Material never waits on audio and never fails for lack of it.
   */
  audioUrl: string | null;
}>;

export type PresentationAudio = Readonly<{
  contentType: "audio/mpeg" | "audio/wav";
  bytes: Uint8Array;
}>;

export type PrepareMaterial = Readonly<{
  card: CardSummary;
  knowledge: StudyKnowledgeSnapshot;
  signal?: AbortSignal;
}>;

export type ReviewBatchFailure = Readonly<{
  cardId: CardSummary["id"];
  kind: MaterialFailure["kind"];
  /** Why the last round's candidates were refused, when validation was the cause. */
  reasons: readonly string[];
}>;

export type ReviewBatchProgress = Readonly<{
  batchId: string;
  done: boolean;
  pending: number;
  completed: readonly CardSummary["id"][];
  failed: readonly ReviewBatchFailure[];
  /** Which whole-batch request the pending Cards are on, from 1. */
  round: number;
}>;

/** Whole-batch requests a Card may take before it is dropped. */
export const MAX_REVIEW_BATCH_ROUNDS = 3;

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
  hasReserve: (
    cardId: CardSummary["id"],
    mode: MaterialMode,
  ) => Result<boolean, MaterialFailure>;
  /**
   * Whether any teach presentation exists for the Card, shown or not.
   * Teaching stays servable until acknowledged, so this, not the unshown
   * reserve, is what decides whether Learn can show the Card.
   */
  canTeach: (cardId: CardSummary["id"]) => Result<boolean, MaterialFailure>;
  /**
   * `taught` and `canTeach` for every Card at once, two queries instead of
   * two per Card: the bank snapshot asks about hundreds of Cards per refresh.
   */
  teachingFlags: () => Result<
    Readonly<{
      taught: ReadonlySet<CardSummary["id"]>;
      teachable: ReadonlySet<CardSummary["id"]>;
    }>,
    MaterialFailure
  >;
  /**
   * Records a review batch without generating anything. Each status poll
   * advances one card (banking reserves, never taking), so progress is
   * client-pumped and resumable with no daemon.
   */
  beginReviewBatch: (
    cards: readonly PrepareMaterial[],
  ) => Result<string, MaterialFailure>;
  advanceReviewBatch: (
    batchId: string,
  ) => Promise<Result<ReviewBatchProgress, MaterialFailure>>;
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
  /** The stored clip for a presentation, or null when it has none. */
  presentationAudio: (
    presentationId: string,
  ) => Result<PresentationAudio | null, MaterialFailure>;
  permitVerifier: PresentationPermitVerifier;
  close: () => void;
}>;

export type MaterialValidationInput = Readonly<{
  value: unknown;
  mode: MaterialMode;
  card: CardSummary;
  knowledge: StudyKnowledgeSnapshot;
}>;
