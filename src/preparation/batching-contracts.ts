import type { BroadPartOfSpeech, TextSpan } from "../analysis/contracts.ts";
import type { Result } from "../result.ts";

export type ProviderIdentity = Readonly<{
  provider: string;
  model: string;
  promptVersion: string;
}>;

export type AnalyzedCue = Readonly<{
  cueId: string;
  normalizedJapanese: string;
  tokens: readonly Readonly<{
    surface: string;
    lemma: string;
    reading: string | null;
    partOfSpeech: readonly string[];
    broadPartOfSpeech: BroadPartOfSpeech;
    span: TextSpan;
  }>[];
  grammarEvidence: readonly Readonly<{
    canonicalForm: string;
    spans: readonly TextSpan[];
  }>[];
}>;

export type CandidateEvidence = Readonly<{
  kind: "vocabulary" | "grammar";
  canonicalKey: string;
  cueId: string;
  surface: string;
  span: TextSpan;
  meaning: string;
  senseId: string | null;
  impact: "required" | "helpful" | "incidental";
  confidence: number;
  ambiguity: readonly string[];
}>;

export type AnalysisBatch = Readonly<{
  runId: string;
  batchId: string;
  inputDigest: string;
  cues: readonly AnalyzedCue[];
}>;

export type AnalysisManifest = Readonly<{
  runId: string;
  normalizationVersion: string;
  analyzerVersion: string;
  provider: ProviderIdentity;
  estimatedRequests: number;
  estimatedInputBytes: number;
  batches: readonly AnalysisBatch[];
}>;

export type ProviderUsage = Readonly<{
  inputTokens: number | null;
  outputTokens: number | null;
}>;

export type ProviderBatchResponse = Readonly<{
  providerRequestId: string;
  candidates: readonly CandidateEvidence[];
  usage: ProviderUsage;
}>;

export type ProviderFailure =
  | { readonly kind: "authentication"; readonly detail: string }
  | { readonly kind: "permission"; readonly detail: string }
  | { readonly kind: "rateLimit"; readonly detail: string }
  | { readonly kind: "offline"; readonly detail: string }
  | { readonly kind: "timeout"; readonly detail: string }
  | { readonly kind: "malformedStructure"; readonly detail: string }
  | { readonly kind: "incompleteResponse"; readonly detail: string }
  | { readonly kind: "refusal"; readonly detail: string }
  | { readonly kind: "cancelled"; readonly detail: string };

export type BatchProvider = Readonly<{
  identity: ProviderIdentity;
  submit: (
    batch: AnalysisBatch,
    requestKey: string,
    dispatched: (providerResponseId: string) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<Result<ProviderBatchResponse, ProviderFailure>>;
  /**
   * Takes the batch because a provider may address cues by a local label of
   * its own choosing, and only the batch can translate an answer back into
   * cue ids.
   */
  retrieve: (
    batch: AnalysisBatch,
    providerResponseId: string,
    signal?: AbortSignal,
  ) => Promise<Result<ProviderBatchResponse | null, ProviderFailure>>;
}>;

export type BatchFailure =
  | ProviderFailure
  | { readonly kind: "invalidCueEvidence"; readonly detail: string }
  | { readonly kind: "incompatibleResumeMetadata"; readonly detail: string }
  | { readonly kind: "persistence"; readonly detail: string };

export type BatchCheckpoint =
  | { readonly state: "pending"; readonly inputDigest: string }
  | {
      readonly state: "requested";
      readonly inputDigest: string;
      readonly requestKey: string;
    }
  | {
      readonly state: "uncertain";
      readonly inputDigest: string;
      readonly requestKey: string;
      /**
       * The provider's own id for the dispatched request, committed as soon as
       * dispatch returns it. Null only while the crash window is still open:
       * between sending the dispatch and durably recording its answer. A
       * recorded id makes the uncertainty resolvable by retrieval instead of
       * by an explicit duplicate-charge decision.
       */
      readonly providerResponseId: string | null;
    }
  | {
      readonly state: "completed";
      readonly inputDigest: string;
      readonly requestKey: string;
      readonly response: ProviderBatchResponse;
    };

export type MergedCandidate = Readonly<{
  kind: "vocabulary" | "grammar";
  canonicalKey: string;
  evidence: readonly Omit<CandidateEvidence, "kind" | "canonicalKey">[];
  ambiguity: readonly string[];
  meanings: readonly string[];
  senseIds: readonly string[];
  impact: "required" | "helpful" | "incidental";
  confidence: number;
}>;

export type AnalysisRunSnapshot = Readonly<{
  state: "running" | "paused" | "incomplete" | "complete" | "failed";
  manifest: AnalysisManifest;
  batches: readonly BatchCheckpoint[];
  merged: readonly MergedCandidate[] | null;
  failure: BatchFailure | null;
  possibleDuplicateCharge: boolean;
}>;

export type CheckpointStore = Readonly<{
  open: (
    manifest: AnalysisManifest,
  ) => Promise<Result<readonly BatchCheckpoint[], BatchFailure>>;
  markRequested: (
    runId: string,
    inputDigest: string,
    requestKey: string,
  ) => Promise<Result<void, BatchFailure>>;
  markUncertain: (
    runId: string,
    inputDigest: string,
    requestKey: string,
  ) => Promise<Result<void, BatchFailure>>;
  markDispatched: (
    runId: string,
    inputDigest: string,
    requestKey: string,
    providerResponseId: string,
  ) => Promise<Result<void, BatchFailure>>;
  /**
   * Return a dispatched checkpoint to `pending`. Only for failures that prove
   * the provider never accepted the request, so nothing was billed and the
   * next attempt is an ordinary first attempt rather than a repeat.
   */
  release: (
    runId: string,
    inputDigest: string,
    requestKey: string,
  ) => Promise<Result<void, BatchFailure>>;
  complete: (
    runId: string,
    inputDigest: string,
    requestKey: string,
    response: ProviderBatchResponse,
  ) => Promise<Result<void, BatchFailure>>;
}>;

export type AnalyzeOptions = Readonly<{
  signal?: AbortSignal;
  retryUncertain?: boolean;
  /**
   * Stop cleanly after this many batches newly complete in this call.
   * Already-completed batches do not count toward the limit. Absent (or
   * non-positive) means no limit.
   */
  maxBatches?: number;
}>;

export type PreparationBatching = Readonly<{
  createManifest: (
    cues: readonly AnalyzedCue[],
    batchSize: number,
  ) => Promise<AnalysisManifest>;
  analyze: (
    manifest: AnalysisManifest,
    options?: AnalyzeOptions,
  ) => Promise<AnalysisRunSnapshot>;
}>;
