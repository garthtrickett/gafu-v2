import type { Result } from "../result.ts";

declare const subtitleSetIdBrand: unique symbol;
export type SubtitleSetId = string & { readonly [subtitleSetIdBrand]: true };

export type SubtitleImportPolicy = Readonly<{
  version: string;
  maximumEntries: number;
  maximumSrtBytes: number;
  maximumArchiveBytes: number;
  maximumDecodedBytes: number;
  maximumInflatedBytes: number;
  maximumCompressionRatio: number;
  maximumCuesPerFile: number;
  maximumCueTextLength: number;
  pendingImportTtlMs: number;
}>;

export const phase3ImportPolicy: SubtitleImportPolicy = {
  version: "subtitle-import-v1",
  maximumEntries: 64,
  maximumSrtBytes: 4 * 1024 * 1024,
  maximumArchiveBytes: 32 * 1024 * 1024,
  maximumDecodedBytes: 32 * 1024 * 1024,
  maximumInflatedBytes: 64 * 1024 * 1024,
  maximumCompressionRatio: 100,
  maximumCuesPerFile: 20_000,
  maximumCueTextLength: 4_096,
  pendingImportTtlMs: 15 * 60 * 1_000,
};

export type ImportFile = Readonly<{
  name: string;
  bytes: Uint8Array;
}>;

export type ImportInput =
  | Readonly<{ mode: "direct"; files: readonly ImportFile[] }>
  | Readonly<{ mode: "zip"; archive: ImportFile }>;

export type SubtitleCue = Readonly<{
  cueKey: string;
  sourceLabel: string | null;
  startMs: number;
  endMs: number;
  rawText: string;
  normalizedText: string;
}>;

export type ParsedEpisode = Readonly<{
  entryId: string;
  displayName: string;
  inferredTitle: string;
  episodeKey: string;
  sourceDigest: string;
  cues: readonly SubtitleCue[];
  decodedBytes: number;
}>;

export type ImportEntryRejection =
  | "unsupportedExtension"
  | "unsafeName"
  | "nestedArchive"
  | "directory"
  | "encrypted"
  | "zip64"
  | "unsupportedCompression"
  | "corruptArchiveEntry"
  | "compressionRatioExceeded"
  | "fileTooLarge"
  | "unsupportedEncoding"
  | "malformedSrt"
  | "notJapanese"
  | "duplicate";

export type ImportEntryReport =
  | Readonly<{
      outcome: "accepted";
      entryId: string;
      displayName: string;
      inferredTitle: string;
      episodeKey: string;
      cueCount: number;
      decodedBytes: number;
    }>
  | Readonly<{
      outcome: "rejected" | "duplicate";
      displayName: string;
      reason: ImportEntryRejection;
      detail: string;
      duplicateOf?: string;
    }>;

export type ImportReport = Readonly<{
  pendingImportToken: string;
  policyVersion: string;
  expiresAt: string;
  entries: readonly ImportEntryReport[];
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
}>;

export type CommitEpisode = Readonly<{
  entryId: string;
  title: string;
}>;

export type CommitImport = Readonly<{
  pendingImportToken: string;
  operationKey: string;
  title: string;
  episodes: readonly CommitEpisode[];
}>;

export type EpisodeSnapshot = Readonly<{
  episodeKey: string;
  title: string;
  order: number;
  displayName: string;
  cueCount: number;
  durationMs: number;
}>;

export type SubtitleSetSnapshot = Readonly<{
  id: SubtitleSetId;
  title: string;
  sourceRevision: string;
  episodes: readonly EpisodeSnapshot[];
  createdAt: string;
  analysis: null | Readonly<{
    state: "pending" | "running" | "paused" | "complete" | "failed";
    completedBatches: number;
    totalBatches: number;
  }>;
}>;

export type ImportFailure =
  | { readonly kind: "mixedImportMode"; readonly detail: string }
  | { readonly kind: "emptyImport" }
  | { readonly kind: "entryLimitExceeded"; readonly maximum: number }
  | { readonly kind: "archiveTooLarge"; readonly maximumBytes: number }
  | { readonly kind: "inflationLimitExceeded"; readonly maximumBytes: number }
  | { readonly kind: "decodedLimitExceeded"; readonly maximumBytes: number }
  | { readonly kind: "corruptArchive"; readonly detail: string }
  | { readonly kind: "noAcceptedFiles" }
  | { readonly kind: "staleImport" }
  | { readonly kind: "invalidCommit"; readonly detail: string }
  | { readonly kind: "subtitleSetNotFound"; readonly subtitleSetId: string }
  | { readonly kind: "migrationFailed"; readonly detail: string }
  | { readonly kind: "unsupportedSchema"; readonly found: number }
  | { readonly kind: "readFailed"; readonly detail: string }
  | { readonly kind: "writeFailed"; readonly detail: string }
  | { readonly kind: "deleteFailed"; readonly detail: string };

export type SubtitleImportInspector = Readonly<{
  inspect: (
    input: ImportInput,
    pendingImportToken: string,
    now: Date,
  ) => Promise<
    Result<
      Readonly<{ report: ImportReport; episodes: readonly ParsedEpisode[] }>,
      ImportFailure
    >
  >;
}>;

export const asSubtitleSetId = (value: string): SubtitleSetId => value as SubtitleSetId;
