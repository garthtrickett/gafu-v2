import type { Database } from "bun:sqlite";
import { err, ok } from "../result.ts";
import type {
  AnalysisManifest,
  BatchCheckpoint,
  BatchFailure,
  CheckpointStore,
  ProviderBatchResponse,
} from "./batching-contracts.ts";

type CheckpointRow = Readonly<{
  input_digest: string;
  state: BatchCheckpoint["state"];
  request_key: string | null;
  provider_response_id: string | null;
  response_json: string | null;
}>;

const failure = (cause: unknown): BatchFailure => ({
  kind: "persistence",
  detail: cause instanceof Error ? cause.message : String(cause),
});

const decode = (row: CheckpointRow): BatchCheckpoint => {
  if (row.state === "pending") {
    return { state: "pending", inputDigest: row.input_digest };
  }
  if (row.request_key === null) throw new Error("checkpoint request key is missing");
  if (row.state === "requested") {
    return {
      state: "requested",
      inputDigest: row.input_digest,
      requestKey: row.request_key,
    };
  }
  if (row.state === "uncertain") {
    return {
      state: "uncertain",
      inputDigest: row.input_digest,
      requestKey: row.request_key,
      providerResponseId: row.provider_response_id,
    };
  }
  if (row.response_json === null) throw new Error("completed response is missing");
  return {
    state: "completed",
    inputDigest: row.input_digest,
    requestKey: row.request_key,
    response: JSON.parse(row.response_json) as ProviderBatchResponse,
  };
};

export const createSqliteCheckpointStore = (
  database: Database,
  clock: () => Date,
): CheckpointStore => {
  const rows = (runId: string): readonly BatchCheckpoint[] =>
    (
      database
        .query(
          `SELECT input_digest, state, request_key, provider_response_id, response_json
           FROM preparation_batch WHERE run_id = ? ORDER BY batch_order`,
        )
        .all(runId) as CheckpointRow[]
    ).map(decode);

  return {
    open: async (manifest: AnalysisManifest) => {
      try {
        const existing = database
          .query("SELECT manifest_json FROM preparation_run WHERE run_id = ?")
          .get(manifest.runId) as { manifest_json: string } | null;
        if (existing !== null) {
          if (existing.manifest_json !== JSON.stringify(manifest)) {
            return err({
              kind: "incompatibleResumeMetadata",
              detail: `manifest does not match ${manifest.runId}`,
            });
          }
          return ok(rows(manifest.runId));
        }
        return err({ kind: "persistence", detail: "analysis run is not registered" });
      } catch (cause) {
        return err(failure(cause));
      }
    },
    markRequested: async (runId, inputDigest, requestKey) => {
      try {
        const result = database
          .query(
            `UPDATE preparation_batch
             SET state = 'requested', request_key = ?, provider_response_id = NULL
             WHERE run_id = ? AND input_digest = ? AND state IN ('pending', 'uncertain')`,
          )
          .run(requestKey, runId, inputDigest);
        return result.changes === 1
          ? ok(undefined)
          : err({ kind: "persistence", detail: "batch checkpoint is not requestable" });
      } catch (cause) {
        return err(failure(cause));
      }
    },
    markDispatched: async (runId, inputDigest, requestKey, providerResponseId) => {
      try {
        const result = database
          .query(
            `UPDATE preparation_batch SET provider_response_id = ?
             WHERE run_id = ? AND input_digest = ? AND request_key = ?
               AND state = 'uncertain'`,
          )
          .run(providerResponseId, runId, inputDigest, requestKey);
        return result.changes === 1
          ? ok(undefined)
          : err({
              kind: "persistence",
              detail: "batch checkpoint is not awaiting a dispatch",
            });
      } catch (cause) {
        return err(failure(cause));
      }
    },
    markUncertain: async (runId, inputDigest, requestKey) => {
      try {
        const result = database
          .query(
            `UPDATE preparation_batch SET state = 'uncertain', request_key = ?
             WHERE run_id = ? AND input_digest = ? AND state = 'requested'`,
          )
          .run(requestKey, runId, inputDigest);
        return result.changes === 1
          ? ok(undefined)
          : err({
              kind: "persistence",
              detail: "batch checkpoint is not dispatchable",
            });
      } catch (cause) {
        return err(failure(cause));
      }
    },
    complete: async (runId, inputDigest, requestKey, response) => {
      try {
        const complete = database.transaction(() => {
          const result = database
            .query(
              `UPDATE preparation_batch
               SET state = 'completed', request_key = ?, response_json = ?
               WHERE run_id = ? AND input_digest = ? AND state = 'uncertain'`,
            )
            .run(requestKey, JSON.stringify(response), runId, inputDigest);
          if (result.changes !== 1)
            throw new Error("batch checkpoint is not completable");
          database
            .query("UPDATE preparation_run SET updated_at = ? WHERE run_id = ?")
            .run(clock().toISOString(), runId);
        });
        complete.immediate();
        return ok(undefined);
      } catch (cause) {
        return err(failure(cause));
      }
    },
  };
};
