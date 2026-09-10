import { err, ok } from "../result.ts";
import type {
  AnalysisManifest,
  BatchCheckpoint,
  BatchFailure,
  CheckpointStore,
  ProviderBatchResponse,
} from "./batching-contracts.ts";

type StoredRun = {
  manifest: AnalysisManifest;
  checkpoints: Map<string, BatchCheckpoint>;
};

export type StoreFault =
  | "open"
  | "requested"
  | "uncertain"
  | "dispatched"
  | "release"
  | "complete";

export const createInMemoryCheckpointStore = (): CheckpointStore & {
  failNext: (operation: StoreFault) => void;
  history: readonly string[];
} => {
  const runs = new Map<string, StoredRun>();
  const failures = new Set<StoreFault>();
  const history: string[] = [];
  const fail = (operation: StoreFault): BatchFailure | null => {
    if (!failures.delete(operation)) return null;
    return { kind: "persistence", detail: `injected ${operation} failure` };
  };
  const find = (runId: string, inputDigest: string): StoredRun | null => {
    const run = runs.get(runId);
    return run?.checkpoints.has(inputDigest) === true ? run : null;
  };
  return {
    history,
    failNext: (operation) => failures.add(operation),
    open: async (manifest) => {
      const failure = fail("open");
      if (failure !== null) return err(failure);
      const existing = runs.get(manifest.runId);
      if (existing !== undefined) {
        if (JSON.stringify(existing.manifest) !== JSON.stringify(manifest)) {
          return err({
            kind: "incompatibleResumeMetadata",
            detail: `manifest does not match ${manifest.runId}`,
          });
        }
        return ok([...existing.checkpoints.values()]);
      }
      const checkpoints = new Map(
        manifest.batches.map((batch) => [
          batch.inputDigest,
          { state: "pending", inputDigest: batch.inputDigest } as const,
        ]),
      );
      runs.set(manifest.runId, { manifest, checkpoints });
      history.push(`open:${manifest.runId}`);
      return ok([...checkpoints.values()]);
    },
    markRequested: async (runId, inputDigest, requestKey) => {
      const failure = fail("requested");
      if (failure !== null) return err(failure);
      const run = find(runId, inputDigest);
      if (run === null) return err({ kind: "persistence", detail: "batch missing" });
      run.checkpoints.set(inputDigest, {
        state: "requested",
        inputDigest,
        requestKey,
      });
      history.push(`requested:${inputDigest}`);
      return ok(undefined);
    },
    markUncertain: async (runId, inputDigest, requestKey) => {
      const failure = fail("uncertain");
      if (failure !== null) return err(failure);
      const run = find(runId, inputDigest);
      if (run === null) return err({ kind: "persistence", detail: "batch missing" });
      run.checkpoints.set(inputDigest, {
        state: "uncertain",
        inputDigest,
        requestKey,
        providerResponseId: null,
      });
      history.push(`uncertain:${inputDigest}`);
      return ok(undefined);
    },
    markDispatched: async (runId, inputDigest, requestKey, providerResponseId) => {
      const failure = fail("dispatched");
      if (failure !== null) return err(failure);
      const run = find(runId, inputDigest);
      if (run === null) return err({ kind: "persistence", detail: "batch missing" });
      const current = run.checkpoints.get(inputDigest);
      if (current?.state !== "uncertain" || current.requestKey !== requestKey) {
        return err({
          kind: "persistence",
          detail: "batch checkpoint is not awaiting a dispatch",
        });
      }
      run.checkpoints.set(inputDigest, {
        state: "uncertain",
        inputDigest,
        requestKey,
        providerResponseId,
      });
      history.push(`dispatched:${inputDigest}`);
      return ok(undefined);
    },
    release: async (runId, inputDigest, requestKey) => {
      const failure = fail("release");
      if (failure !== null) return err(failure);
      const run = find(runId, inputDigest);
      if (run === null) return err({ kind: "persistence", detail: "batch missing" });
      const current = run.checkpoints.get(inputDigest);
      if (
        current === undefined ||
        current.state === "pending" ||
        current.state === "completed" ||
        current.requestKey !== requestKey
      ) {
        return err({
          kind: "persistence",
          detail: "batch checkpoint is not releasable",
        });
      }
      run.checkpoints.set(inputDigest, { state: "pending", inputDigest });
      history.push(`released:${inputDigest}`);
      return ok(undefined);
    },
    complete: async (
      runId: string,
      inputDigest: string,
      requestKey: string,
      response: ProviderBatchResponse,
    ) => {
      const failure = fail("complete");
      if (failure !== null) return err(failure);
      const run = find(runId, inputDigest);
      if (run === null) return err({ kind: "persistence", detail: "batch missing" });
      run.checkpoints.set(inputDigest, {
        state: "completed",
        inputDigest,
        requestKey,
        response,
      });
      history.push(`completed:${inputDigest}`);
      return ok(undefined);
    },
  };
};
