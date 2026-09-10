import { ok } from "../result.ts";
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

/**
 * Whether a failure means a response arrived and was rejected locally. Such a
 * response is billed but worthless, and caching it would replay the same
 * rejection on every resume instead of asking the provider again.
 */
const outputIsUnusable = (failure: BatchFailure): boolean => {
  switch (failure.kind) {
    case "invalidCueEvidence":
    case "malformedStructure":
    case "incompleteResponse":
    case "refusal":
      return true;
    default:
      return false;
  }
};

/**
 * Whether a failed dispatch might have reached the provider and been billed.
 * A rejection carries the provider's own refusal to run the request, so it is
 * evidence that nothing was generated; a lost or abandoned connection is not.
 */
const mayHaveBeenBilled = (failure: BatchFailure): boolean => {
  switch (failure.kind) {
    case "authentication":
    case "permission":
    case "rateLimit":
      return false;
    default:
      return true;
  }
};

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
    if (invalid !== null) {
      // Paid for but unusable. Releasing keeps the batch from completing, as
      // an invalid span must, without caching the rejection for every later
      // resume to trip over.
      await dependencies.store.release(manifest.runId, batch.inputDigest, key);
      return pause(manifest, (await refresh(manifest)) ?? current, invalid);
    }
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
      let completedThisCall = 0;
      const limit =
        options.maxBatches !== undefined && options.maxBatches > 0
          ? options.maxBatches
          : Number.POSITIVE_INFINITY;
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
          // A recorded dispatch id makes the uncertainty answerable: the work
          // is already paid for, so retrieve it rather than making the reader
          // choose between abandoning the batch and paying for it twice.
          const retrieved =
            checkpoint.providerResponseId === null
              ? ok(null)
              : await dependencies.provider.retrieve(
                  checkpoint.providerResponseId,
                  options.signal,
                );
          if (!retrieved.ok) {
            if (outputIsUnusable(retrieved.error)) {
              await dependencies.store.release(manifest.runId, batch.inputDigest, key);
              return pause(
                manifest,
                (await refresh(manifest)) ?? checkpoints,
                retrieved.error,
              );
            }
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
          // No id, or the dispatch aged out of provider-side retention: this is
          // the only case where reissuing can genuinely pay twice.
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
          // Committed before the provider starts generating, so an interrupted
          // wait leaves a retrievable request rather than an unanswerable one.
          async (providerResponseId) => {
            await dependencies.store.markDispatched(
              manifest.runId,
              batch.inputDigest,
              key,
              providerResponseId,
            );
            checkpoints = (await refresh(manifest)) ?? checkpoints;
          },
          options.signal,
        );
        if (!submitted.ok) {
          let latest = (await refresh(manifest)) ?? checkpoints;
          const dispatched = latest.find(
            (item) => item.inputDigest === batch.inputDigest,
          );
          const unanswerable =
            dispatched?.state === "uncertain" && dispatched.providerResponseId === null;
          if (
            unanswerable &&
            (!mayHaveBeenBilled(submitted.error) || outputIsUnusable(submitted.error))
          ) {
            // Either the provider refused to run it -- nothing generated, so
            // nothing to retrieve and nothing to repay -- or a response
            // arrived and was rejected locally, which is billed but worthless.
            // Both must return to pending: leaving them dispatched would make
            // the next attempt replay the rejection or demand a
            // duplicate-charge decision it does not need.
            await dependencies.store.release(manifest.runId, batch.inputDigest, key);
            latest = (await refresh(manifest)) ?? latest;
            return pause(manifest, latest, submitted.error, false);
          }
          return pause(
            manifest,
            latest,
            submitted.error,
            // Reissuing only risks a second charge while nothing retrievable
            // was recorded for the request that has already been paid for.
            unanswerable,
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
        completedThisCall += 1;
        if (completedThisCall >= limit) {
          // Clean chunk stop: every reached batch is checkpointed, so
          // resuming repays nothing and risks no duplicate charge.
          const current = (await refresh(manifest)) ?? checkpoints;
          if (current.every((item) => item.state === "completed")) {
            return snapshot(manifest, current, "complete", null);
          }
          return snapshot(manifest, current, "paused", null);
        }
      }
      const final = (await refresh(manifest)) ?? checkpoints;
      return final.every((batch) => batch.state === "completed")
        ? snapshot(manifest, final, "complete", null)
        : snapshot(manifest, final, "incomplete", null);
    },
  };
};
