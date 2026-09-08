import type {
  AnalysisBatch,
  AnalysisManifest,
  AnalyzedCue,
  ProviderIdentity,
} from "./batching-contracts.ts";

const digest = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const createAnalysisManifest = async (
  cues: readonly AnalyzedCue[],
  batchSize: number,
  normalizationVersion: string,
  analyzerVersion: string,
  provider: ProviderIdentity,
): Promise<AnalysisManifest> => {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError("batchSize must be a positive integer");
  }
  const identity = {
    normalizationVersion,
    analyzerVersion,
    provider,
    batchSize,
    cues,
  };
  const runId = `run-v1:sha256:${await digest(identity)}`;
  const batches: AnalysisBatch[] = [];
  for (let start = 0; start < cues.length; start += batchSize) {
    const batchCues = cues.slice(start, start + batchSize);
    const inputDigest = await digest({
      normalizationVersion,
      analyzerVersion,
      provider,
      cues: batchCues,
    });
    batches.push({
      runId,
      batchId: `batch-${String(batches.length + 1).padStart(4, "0")}`,
      inputDigest: `sha256:${inputDigest}`,
      cues: batchCues,
    });
  }
  return {
    runId,
    normalizationVersion,
    analyzerVersion,
    provider,
    estimatedRequests: batches.length,
    estimatedInputBytes: new TextEncoder().encode(
      cues.map((cue) => cue.normalizedJapanese).join("\n"),
    ).byteLength,
    batches,
  };
};
