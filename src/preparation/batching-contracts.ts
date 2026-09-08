import type { TextSpan } from "../analysis/contracts.ts";
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
    signal?: AbortSignal,
  ) => Promise<Result<ProviderBatchResponse, ProviderFailure>>;
  retrieve: (
    requestKey: string,
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
