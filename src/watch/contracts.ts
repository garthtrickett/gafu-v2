import type { JapaneseAnalyzer } from "../analysis/contracts.ts";
import type { Result } from "../result.ts";
import type { Study, StudyFailure } from "../study/contracts.ts";

export type ResolveCapture = Readonly<{
  sourceVersion: "watch-source-v1";
  episodeKey: string;
  cueKey: string;
  cueStartMs: number;
  cueEndMs: number;
  cueText: string;
  selectedSurface: string;
  selectedSpan: Readonly<{ start: number; end: number }>;
}>;

export type CaptureCandidate = Readonly<{
  key: string;
  surface: string;
  lemma: string;
  reading: string;
  partOfSpeech: string;
  span: Readonly<{ start: number; end: number }>;
  suggestedSenseId: string;
}>;

export type CaptureResolution = Readonly<{
  token: string;
  expiresAt: string;
  selectedSurface: string;
  candidates: readonly CaptureCandidate[];
}>;

export type CommitCapture = Readonly<{
  token: string;
  candidateKey: string;
  meaning: string;
  senseId: string;
  operationKey: string;
}>;

export type CaptureOutcome = Readonly<{
  outcome: "created" | "existing";
  cardId: string;
  lemma: string;
  evidenceAdded: boolean;
}>;

export type WatchFailure =
  | { readonly kind: "invalidCaptureSelection"; readonly detail: string }
  | { readonly kind: "noContentCandidate" }
  | { readonly kind: "analyzerUnavailable" }
  | { readonly kind: "pendingCaptureMissing" }
  | { readonly kind: "pendingCaptureExpired" }
  | { readonly kind: "captureCandidateMissing" }
  | { readonly kind: "invalidCaptureIdentity"; readonly detail: string }
  | { readonly kind: "clockFailed" }
  | { readonly kind: "tokenFailed" }
  | { readonly kind: "studyFailure"; readonly failure: StudyFailure };

export type Watch = Readonly<{
  resolve: (
    command: ResolveCapture,
  ) => Promise<Result<CaptureResolution, WatchFailure>>;
  commit: (command: CommitCapture) => Result<CaptureOutcome, WatchFailure>;
}>;

export type WatchDependencies = Readonly<{
  analyzer: JapaneseAnalyzer;
  clock: () => Date;
  nextToken: () => string;
  captureVocabulary: Study["captureVocabulary"];
  pendingTtlMs: number;
  maximumPending: number;
}>;
