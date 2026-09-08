import type {
  AnalysisBatch,
  AnalysisManifest,
  AnalysisRunSnapshot,
  AnalyzeOptions,
  BatchCheckpoint,
  BatchFailure,
  BatchProvider,
  CheckpointStore,
  PreparationBatching,
  ProviderBatchResponse,
} from "./batching-contracts.ts";
import { createAnalysisManifest } from "./manifest.ts";
import { mergeCompletedBatches } from "./merge.ts";

const requestKey = (batch: AnalysisBatch): string =>
  `${batch.runId}:${batch.inputDigest}`;

const validateResponse = (
  batch: AnalysisBatch,
  response: ProviderBatchResponse,
): BatchFailure | null => {
  const cues = new Map(batch.cues.map((cue) => [cue.cueId, cue]));
  for (const candidate of response.candidates) {
    const cue = cues.get(candidate.cueId);
    if (cue === undefined) {
      return {
        kind: "invalidCueEvidence",
        detail: `unknown cue ${candidate.cueId}`,
      };
    }
    const { start, end, unit, normalization } = candidate.span;
    if (
      unit !== "utf16-code-unit" ||
      normalization !== "nfkc-v1" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > cue.normalizedJapanese.length ||
      cue.normalizedJapanese.slice(start, end) !== candidate.surface
    ) {
      return {
        kind: "invalidCueEvidence",
        detail: `invalid normalized span for ${candidate.cueId}`,
      };
    }
  }
  return null;
};

const snapshot = (
  manifest: AnalysisManifest,
  batches: readonly BatchCheckpoint[],
  state: AnalysisRunSnapshot["state"],
  failure: BatchFailure | null,
  possibleDuplicateCharge = false,
): AnalysisRunSnapshot => ({
  state,
  manifest,
  batches,
  merged:
    state === "complete" &&
    batches.length === manifest.batches.length &&
    batches.every((batch) => batch.state === "completed")
      ? mergeCompletedBatches(batches)
      : null,
  failure,
  possibleDuplicateCharge,
});

const recoverable = (failure: BatchFailure): boolean => {
  switch (failure.kind) {
    case "authentication":
    case "permission":
    case "rateLimit":
    case "offline":
    case "timeout":
    case "cancelled":
    case "persistence":
      return true;
    case "malformedStructure":
    case "incompleteResponse":
    case "refusal":
    case "invalidCueEvidence":
    case "incompatibleResumeMetadata":
      return false;
  }
};

export const createPreparationBatching = (dependencies: {
  provider: BatchProvider;
  store: CheckpointStore;
  normalizationVersion: string;
  analyzerVersion: string;
}): PreparationBatching => {
  const refresh = async (
    manifest: AnalysisManifest,
  ): Promise<readonly BatchCheckpoint[] | null> => {
    const opened = await dependencies.store.open(manifest);
    return opened.ok ? opened.value : null;
  };

  const pause = async (
    manifest: AnalysisManifest,
    current: readonly BatchCheckpoint[],
    failure: BatchFailure,
    possibleDuplicateCharge = false,
  ): Promise<AnalysisRunSnapshot> =>
    snapshot(
      manifest,
      (await refresh(manifest)) ?? current,
      recoverable(failure) ? "paused" : "failed",
      failure,
      possibleDuplicateCharge,
    );

  const commit = async (
    manifest: AnalysisManifest,
    batch: AnalysisBatch,
    key: string,
    response: ProviderBatchResponse,
    current: readonly BatchCheckpoint[],
  ): Promise<AnalysisRunSnapshot | null> => {
    const invalid = validateResponse(batch, response);
    if (invalid !== null) return pause(manifest, current, invalid);
    const completed = await dependencies.store.complete(
      manifest.runId,
      batch.inputDigest,
      key,
      response,
    );
    return completed.ok ? null : pause(manifest, current, completed.error);
  };

  return {
    createManifest: (cues, batchSize) =>
      createAnalysisManifest(
        cues,
        batchSize,
        dependencies.normalizationVersion,
        dependencies.analyzerVersion,
        dependencies.provider.identity,
      ),
    analyze: async (
      manifest: AnalysisManifest,
      options: AnalyzeOptions = {},
    ): Promise<AnalysisRunSnapshot> => {
      const opened = await dependencies.store.open(manifest);
      if (!opened.ok) {
        return snapshot(manifest, [], "failed", opened.error);
      }
      let checkpoints = opened.value;
      for (const batch of manifest.batches) {
        let checkpoint = checkpoints.find(
          (item) => item.inputDigest === batch.inputDigest,
        );
        if (checkpoint === undefined) {
          return snapshot(manifest, checkpoints, "failed", {
            kind: "incompatibleResumeMetadata",
            detail: `checkpoint missing for ${batch.batchId}`,
          });
        }
        if (checkpoint.state === "completed") continue;
        const key =
          checkpoint.state === "requested" || checkpoint.state === "uncertain"
            ? checkpoint.requestKey
            : requestKey(batch);

        if (checkpoint.state === "uncertain") {
          const retrieved = await dependencies.provider.retrieve(key, options.signal);
          if (!retrieved.ok) {
            return pause(manifest, checkpoints, retrieved.error);
          }
          if (retrieved.value !== null) {
            const interrupted = await commit(
              manifest,
              batch,
              key,
              retrieved.value,
              checkpoints,
            );
            if (interrupted !== null) return interrupted;
            checkpoints = (await refresh(manifest)) ?? checkpoints;
            continue;
          }
          if (options.retryUncertain !== true) {
            return snapshot(manifest, checkpoints, "paused", null, true);
          }
        }

        const requested = await dependencies.store.markRequested(
          manifest.runId,
          batch.inputDigest,
          key,
        );
        if (!requested.ok) return pause(manifest, checkpoints, requested.error);
        const uncertain = await dependencies.store.markUncertain(
          manifest.runId,
          batch.inputDigest,
          key,
        );
        if (!uncertain.ok) return pause(manifest, checkpoints, uncertain.error);
        checkpoints = (await refresh(manifest)) ?? checkpoints;
        const submitted = await dependencies.provider.submit(
          batch,
          key,
          options.signal,
        );
        if (!submitted.ok) {
          return pause(
            manifest,
            checkpoints,
            submitted.error,
            checkpoint.state === "uncertain" && options.retryUncertain === true,
          );
        }
        const interrupted = await commit(
          manifest,
          batch,
          key,
          submitted.value,
          checkpoints,
        );
        if (interrupted !== null) return interrupted;
        checkpoints = (await refresh(manifest)) ?? checkpoints;
        checkpoint = checkpoints.find((item) => item.inputDigest === batch.inputDigest);
        if (checkpoint?.state !== "completed") {
          return snapshot(manifest, checkpoints, "incomplete", null);
        }
      }
      const final = (await refresh(manifest)) ?? checkpoints;
      return final.every((batch) => batch.state === "completed")
        ? snapshot(manifest, final, "complete", null)
        : snapshot(manifest, final, "incomplete", null);
    },
  };
};
