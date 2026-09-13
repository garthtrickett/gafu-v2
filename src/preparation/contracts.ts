import type { JapaneseAnalyzer } from "../analysis/contracts.ts";
import type { GrammarDetector } from "../learning-material/contracts.ts";
import type { PlanDraft } from "../preparation-plan-contracts.ts";
import type { Result } from "../result.ts";
import type { KnownVocabulary, StudyPreparationSnapshot } from "../study/contracts.ts";
import type {
  AnalysisManifest,
  BatchFailure,
  BatchProvider,
  MergedCandidate,
  ProviderIdentity,
  ProviderUsage,
} from "./batching-contracts.ts";
import type { CoverageReport } from "./coverage.ts";
import type {
  CommitImport,
  ImportFailure,
  ImportInput,
  ImportReport,
  SubtitleImportInspector,
  SubtitleImportPolicy,
  SubtitleSetId,
  SubtitleSetSnapshot,
} from "./import-contracts.ts";

export type AnalysisPreflight = Readonly<{
  token: string;
  subtitleSetId: SubtitleSetId;
  sourceRevision: string;
  provider: ProviderIdentity;
  providerConfigured: boolean;
  episodeCount: number;
  cueCount: number;
  japaneseCueCount: number;
  inputBytes: number;
  estimatedRequests: number;
  completedRequests: number;
  expiresAt: string;
  disclosure: readonly string[];
}>;

export type FindingClassification = "required" | "helpful" | "incidental";
export type FindingRelation = "missing" | "existing" | "known";

export type FindingEvidence = Readonly<{
  episodeKey: string;
  episodeTitle: string;
  episodeOrder: number;
  cueKey: string;
  cueOrder: number;
  startMs: number;
  endMs: number;
  surface: string;
  context: string;
  span: Readonly<{ start: number; end: number }>;
}>;

export type PreparationFinding = Readonly<{
  key: string;
  type: "grammar" | "vocabulary";
  canonicalKey: string;
  lemma: string | null;
  reading: string | null;
  partOfSpeech: string | null;
  meaning: string;
  senseId: string | null;
  resolution: "resolved" | "ambiguous";
  ambiguity: readonly string[];
  relation: FindingRelation;
  originalRelation: FindingRelation;
  existingCardId: string | null;
  classification: FindingClassification;
  originalClassification: FindingClassification;
  disposition: "include" | "defer" | "dismiss";
  knownForSet: boolean;
  correctedAt: string | null;
  occurrenceCount: number;
  episodeCount: number;
  firstNeeded: Readonly<{
    episodeOrder: number;
    episodeTitle: string;
    cueOrder: number;
    startMs: number;
  }>;
  priority: number;
  rankVersion: "preparation-rank-v1";
  rankReasons: readonly string[];
  confidence: number;
}>;

export type PreparationSnapshot = Readonly<{
  subtitleSet: SubtitleSetSnapshot;
  runId: string;
  state: "pending" | "running" | "paused" | "complete" | "failed";
  completedBatches: number;
  totalBatches: number;
  possibleDuplicateCharge: boolean;
  failure: BatchFailure | null;
  usage: ProviderUsage;
  studyDigest: string | null;
  comparisonStale: boolean;
  counts: Readonly<{
    gap: number;
    existing: number;
    known: number;
    ambiguous: number;
  }>;
  findings: readonly PreparationFinding[];
}>;

export type AnalyzeCommand = Readonly<{
  preflightToken: string;
  retryUncertain?: boolean;
  signal?: AbortSignal;
  /**
   * Stop cleanly after this many batches complete in this call. Reached
   * batches stay checkpointed, so the next call resumes without repaying.
   * Absent (or non-positive) means no limit.
   */
  maxBatches?: number;
}>;

export type CorrectionCommand = Readonly<{
  subtitleSetId: SubtitleSetId;
  findingKey: string;
  classification?: FindingClassification;
  disposition?: "include" | "defer" | "dismiss";
  knownForSet?: boolean;
  meaning?: string;
  senseId?: string;
}>;

export type EvidenceQuery = Readonly<{
  subtitleSetId: SubtitleSetId;
  findingKey: string;
  offset: number;
  limit: number;
}>;

export type EvidencePage = Readonly<{
  total: number;
  offset: number;
  items: readonly FindingEvidence[];
}>;

export type PreparationFailure =
  | ImportFailure
  | { readonly kind: "invalidClock" }
  | { readonly kind: "analysisUnavailable"; readonly detail: string }
  | { readonly kind: "noJapaneseCues" }
  | { readonly kind: "stalePreflight" }
  | { readonly kind: "providerNotConfigured" }
  | { readonly kind: "incompleteEvidence"; readonly detail: string }
  | { readonly kind: "findingNotFound"; readonly findingKey: string }
  | { readonly kind: "invalidCorrection"; readonly detail: string }
  | { readonly kind: "analysisNotComplete" }
  | { readonly kind: "planDraftEmpty" }
  | { readonly kind: "batchFailure"; readonly failure: BatchFailure };

export type Preparation = Readonly<{
  /**
   * What fraction of the words in a pending import the learner already knows,
   * and which unknown words buy the most coverage. Reads the import that was
   * just inspected; commits nothing.
   */
  measureCoverage: (
    pendingImportToken: string,
    vocabulary: readonly KnownVocabulary[],
  ) => Promise<Result<CoverageReport, PreparationFailure>>;
  inspectImport: (
    input: ImportInput,
  ) => Promise<Result<ImportReport, PreparationFailure>>;
  commitImport: (
    command: CommitImport,
  ) => Result<SubtitleSetSnapshot, PreparationFailure>;
  listSubtitleSets: () => Result<readonly SubtitleSetSnapshot[], PreparationFailure>;
  getSubtitleSet: (
    id: SubtitleSetId,
  ) => Result<SubtitleSetSnapshot, PreparationFailure>;
  preflight: (
    id: SubtitleSetId,
    study: StudyPreparationSnapshot,
  ) => Promise<Result<AnalysisPreflight, PreparationFailure>>;
  analyze: (
    command: AnalyzeCommand,
  ) => Promise<Result<PreparationSnapshot, PreparationFailure>>;
  recompare: (
    id: SubtitleSetId,
    study: StudyPreparationSnapshot,
  ) => Result<PreparationSnapshot, PreparationFailure>;
  correct: (
    command: CorrectionCommand,
  ) => Result<PreparationSnapshot, PreparationFailure>;
  evidence: (query: EvidenceQuery) => Result<EvidencePage, PreparationFailure>;
  planDraft: (id: SubtitleSetId) => Result<PlanDraft, PreparationFailure>;
  deleteSubtitleSet: (
    id: SubtitleSetId,
    confirmation: "delete",
  ) => Result<void, PreparationFailure>;
  close: () => void;
}>;

export type PreparationDependencies = Readonly<{
  databasePath: string;
  clock: () => Date;
  nextId: () => string;
  nextToken: () => string;
  importPolicy: SubtitleImportPolicy;
  inspector: SubtitleImportInspector;
  analyzer: JapaneseAnalyzer;
  grammar: GrammarDetector;
  provider: BatchProvider;
  /**
   * Async because a key can arrive unverified -- one seeded from the
   * environment never passed through the settings route -- and the scope panel
   * must not offer to analyze with a key the provider will reject.
   */
  providerConfigured: (signal?: AbortSignal) => Promise<boolean>;
  batchSize: number;
}>;

export type StoredRun = Readonly<{
  manifest: AnalysisManifest;
  merged: readonly MergedCandidate[];
}>;
