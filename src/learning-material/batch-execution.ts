import type { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type { CardId } from "../study/contracts.ts";
import type {
  BatchAdvanceOptions,
  GeneratedMaterial,
  MaterialBatch,
  MaterialFailure,
  MaterialMode,
  MaterialProvider,
  PrepareMaterial,
} from "./generated-contracts.ts";
import { MAX_REVIEW_BATCH_ROUNDS } from "./generated-contracts.ts";

type Item = {
  seq: number;
  card_id: CardId;
  input_json: string;
  attempts: number;
  hints_json: string | null;
};
type Job = {
  job_id: string;
  dispatched_at: string;
  phase: string;
  owner_token: string | null;
  response_json: string | null;
  provider_identity: string | null;
};
type Options = {
  database: Database;
  clock: () => Date;
  nextId: () => string;
  ownerToken: string;
  provider: MaterialProvider;
  providerBinding: string;
  input: (batchId: string, json: string) => PrepareMaterial | null;
  mode: (input: PrepareMaterial) => Result<MaterialMode, MaterialFailure>;
  hasReserve: (
    input: PrepareMaterial,
    mode: MaterialMode,
  ) => Result<boolean, MaterialFailure>;
  recent: (cardId: CardId) => Result<readonly string[], MaterialFailure>;
  validate: (
    input: PrepareMaterial & { value: unknown; mode: MaterialMode },
  ) => Promise<Result<GeneratedMaterial, MaterialFailure>>;
  store: (
    input: PrepareMaterial,
    mode: MaterialMode,
    value: GeneratedMaterial,
    at: Date,
  ) => Result<string | null, MaterialFailure>;
  word: (input: PrepareMaterial, mode: MaterialMode) => Result<void, MaterialFailure>;
  cooldown: (cardId: CardId, status: "ready" | "failed", at: string) => void;
  ready: (items: readonly { id: string; japanese: string }[]) => void;
};
const DEADLINE = 15 * 60_000;
const transient = new Set(["offline", "timeout", "rateLimit", "cancelled"]);

/** Durable provider execution; callers share one instance and cannot advance a batch concurrently. */
export function createBatchExecution(o: Options) {
  const db = o.database,
    active = new Map<string, Promise<Result<void, MaterialFailure>>>();
  const control = () =>
    db.query("SELECT * FROM review_preparation_control WHERE singleton=1").get() as {
      blocked_reason: string | null;
      retry_at: string | null;
      provider_identity: string | null;
    };
  const pause = (reason: string, retryAt: string | null) =>
    db
      .query(
        "UPDATE review_preparation_control SET blocked_reason=?,retry_at=?,provider_identity=? WHERE singleton=1",
      )
      .run(reason, retryAt, o.providerBinding);
  const initial = control();
  if (initial.provider_identity && initial.provider_identity !== o.providerBinding)
    pause("", null);
  const terminal = (
    batchId: string,
    kind: MaterialFailure["kind"],
    at: string,
    uncertain = false,
  ) =>
    db.transaction(() => {
      const cards = db
        .query(
          "SELECT card_id FROM review_batch_item WHERE batch_id=? AND status='pending'",
        )
        .all(batchId) as { card_id: CardId }[];
      db.query(
        "UPDATE review_batch_item SET status='failed',failure_kind=?,updated_at=? WHERE batch_id=? AND status='pending'",
      ).run(kind, at, batchId);
      if (uncertain) {
        db.query(
          "UPDATE review_batch_job SET phase='uncertain',owner_token=? WHERE batch_id=?",
        ).run(o.ownerToken, batchId);
        db.query(
          "UPDATE review_batch SET blocked_reason='dispatchUncertain' WHERE batch_id=?",
        ).run(batchId);
      } else {
        for (const c of cards) o.cooldown(c.card_id, "failed", at);
        db.query("DELETE FROM review_batch_claim WHERE batch_id=?").run(batchId);
        db.query("DELETE FROM review_batch_job WHERE batch_id=?").run(batchId);
      }
    })();
  const run = async (
    batchId: string,
    batch: MaterialBatch,
    policy: BatchAdvanceOptions,
  ): Promise<Result<void, MaterialFailure>> => {
    try {
      let items = db
        .query(
          "SELECT seq,card_id,input_json,attempts,hints_json FROM review_batch_item WHERE batch_id=? AND status='pending' ORDER BY seq",
        )
        .all(batchId) as Item[];
      let job = db
        .query("SELECT * FROM review_batch_job WHERE batch_id=?")
        .get(batchId) as Job | null;
      const now = o.clock(),
        at = now.toISOString();
      if (!items.length) return ok(undefined);
      const current = (input: PrepareMaterial) =>
        policy.signal?.aborted !== true && policy.isCurrent?.(input) !== false;
      if (job?.phase === "uncertain" || job?.phase === "dispatching") {
        terminal(batchId, "dispatchUncertain", at, true);
        return ok(undefined);
      }
      if (job && job.provider_identity !== o.providerBinding) {
        terminal(batchId, "dispatchUncertain", at, true);
        return ok(undefined);
      }
      const overdue =
        job !== null && now.getTime() - Date.parse(job.dispatched_at) >= DEADLINE;
      const lane = control();
      if (lane.provider_identity === o.providerBinding && lane.blocked_reason) {
        if (!lane.retry_at || lane.retry_at > at) return ok(undefined);
        pause("", null);
      }
      if (job === null) {
        if (policy.allowDispatch === false) return ok(undefined);
        const targets = [];
        let knowledge: PrepareMaterial["knowledge"] | undefined;
        for (const item of items) {
          const input = o.input(batchId, item.input_json);
          if (!input) return err({ kind: "readFailed", detail: "Corrupt batch input" });
          if (!current(input)) {
            db.transaction(() => {
              db.query(
                "UPDATE review_batch_item SET status='failed',failure_kind='presentationNotFound',updated_at=? WHERE batch_id=? AND seq=?",
              ).run(at, batchId, item.seq);
              db.query(
                "DELETE FROM review_batch_claim WHERE card_id=? AND batch_id=?",
              ).run(item.card_id, batchId);
            })();
            continue;
          }
          const mode = o.mode(input);
          if (!mode.ok) return mode;
          const ready = o.hasReserve(input, mode.value);
          if (!ready.ok) return ready;
          if (ready.value) {
            db.transaction(() => {
              db.query(
                "UPDATE review_batch_item SET status='ready',updated_at=? WHERE batch_id=? AND seq=?",
              ).run(at, batchId, item.seq);
              db.query(
                "DELETE FROM review_batch_claim WHERE card_id=? AND batch_id=?",
              ).run(item.card_id, batchId);
            })();
            continue;
          }
          const recent = o.recent(item.card_id);
          if (!recent.ok) return recent;
          let hints: readonly string[] = [];
          try {
            const x: unknown = JSON.parse(item.hints_json ?? "[]");
            if (Array.isArray(x))
              hints = x.filter((v): v is string => typeof v === "string");
          } catch {}
          knowledge = input.knowledge;
          targets.push({
            mode: mode.value,
            card: input.card,
            recentJapanese: recent.value,
            previousRejections: hints,
          });
        }
        if (!targets.length || !knowledge) return ok(undefined);
        const attempt = o.nextId();
        db.transaction(() => {
          db.query(
            "INSERT INTO review_batch_attempt(id,batch_id,created_at,disposition) VALUES (?,?,?,'dispatching')",
          ).run(attempt, batchId, at);
          db.query(
            "INSERT INTO review_batch_job(batch_id,job_id,dispatched_at,phase,owner_token,provider_identity) VALUES (?,'',?,'dispatching',?,?)",
          ).run(batchId, at, o.ownerToken, o.providerBinding);
        })();
        const sent = await batch.dispatch(targets, knowledge, policy.signal);
        if (policy.signal?.aborted && !sent.ok) {
          terminal(batchId, "dispatchUncertain", at, true);
          return ok(undefined);
        }
        if (!sent.ok) {
          if (
            ["providerNotConfigured", "authentication", "permission"].includes(
              sent.error.kind,
            )
          ) {
            db.query("DELETE FROM review_batch_job WHERE batch_id=?").run(batchId);
            pause(sent.error.kind, null);
          } else if (sent.error.kind === "rateLimit") {
            db.query("DELETE FROM review_batch_job WHERE batch_id=?").run(batchId);
            pause(
              "rateLimit",
              new Date(
                o.clock().getTime() + (sent.error.retryAfterMs ?? 60_000),
              ).toISOString(),
            );
          } else terminal(batchId, "dispatchUncertain", at, true);
          return ok(undefined);
        }
        db.transaction(() => {
          db.query(
            "UPDATE review_batch_job SET job_id=?,phase='running' WHERE batch_id=? AND phase='dispatching' AND owner_token=?",
          ).run(sent.value.jobId, batchId, o.ownerToken);
          db.query(
            "UPDATE review_batch_attempt SET disposition='running',provider_job_id=? WHERE id=?",
          ).run(sent.value.jobId, attempt);
        })();
        return ok(undefined);
      }
      if (job.phase === "dispatching") return ok(undefined);
      // Reclaim only an identified request/result. A lost dispatch ID is never recreated automatically.
      db.query("UPDATE review_batch_job SET owner_token=? WHERE batch_id=?").run(
        o.ownerToken,
        batchId,
      );
      if (job.response_json === null) {
        const polled = await batch.poll(job.job_id, policy.signal);
        if (!polled.ok) {
          if (
            job.phase === "recovering" ||
            polled.error.kind === "dispatchUncertain" ||
            (overdue && transient.has(polled.error.kind))
          ) {
            terminal(batchId, "dispatchUncertain", at, true);
            return ok(undefined);
          }
          if (transient.has(polled.error.kind)) {
            if (polled.error.kind === "rateLimit")
              pause(
                "rateLimit",
                new Date(
                  o.clock().getTime() + (polled.error.retryAfterMs ?? 60_000),
                ).toISOString(),
              );
            else
              db.query("UPDATE review_batch SET retry_at=? WHERE batch_id=?").run(
                new Date(o.clock().getTime() + 10_000).toISOString(),
                batchId,
              );
            return ok(undefined);
          }
          if (
            polled.error.kind === "authentication" ||
            polled.error.kind === "permission"
          ) {
            pause(polled.error.kind, null);
            return ok(undefined);
          }
          terminal(batchId, polled.error.kind, at);
          return ok(undefined);
        }
        if (polled.value.status === "pending") {
          if (
            overdue &&
            polled.value.phase === "queued" &&
            batch.cancel &&
            policy.allowDispatch !== false
          ) {
            const cancelled = await batch.cancel(job.job_id, policy.signal);
            if (!cancelled.ok || cancelled.value.status === "pending") {
              terminal(batchId, "dispatchUncertain", at, true);
              return ok(undefined);
            }
            if (cancelled.value.status === "cancelled") {
              const cancelledJobId = job.job_id;
              db.transaction(() => {
                db.query(
                  "UPDATE review_batch_attempt SET disposition='cancelled' WHERE batch_id=? AND provider_job_id=?",
                ).run(batchId, cancelledJobId);
                const count = db
                  .query(
                    "SELECT count(*) AS count FROM review_batch_attempt WHERE batch_id=? AND disposition='cancelled'",
                  )
                  .get(batchId) as { count: number };
                if (count.count >= MAX_REVIEW_BATCH_ROUNDS) {
                  terminal(batchId, "timeout", at);
                } else {
                  db.query("DELETE FROM review_batch_job WHERE batch_id=?").run(
                    batchId,
                  );
                  db.query(
                    "UPDATE review_batch SET retry_at=?,blocked_reason=NULL WHERE batch_id=?",
                  ).run(new Date(o.clock().getTime() + 60_000).toISOString(), batchId);
                }
              })();
              return ok(undefined);
            }
            db.query(
              "UPDATE review_batch_job SET response_json=?,phase='validating' WHERE batch_id=? AND owner_token=?",
            ).run(JSON.stringify(cancelled.value.items), batchId, o.ownerToken);
            // Continue through the same durable validation path next tick.
            return ok(undefined);
          }
          // Check the saved ID before declaring a timeout. It may have finished
          // while the app was offline; completed work can be validated for free.
          // A still-pending request remains uncertain and is never bought twice.
          if (job.phase === "recovering" || overdue)
            terminal(batchId, "dispatchUncertain", at, true);
          return ok(undefined);
        }
        const response = JSON.stringify(polled.value.items);
        db.query(
          "UPDATE review_batch_job SET response_json=?,phase='validating' WHERE batch_id=? AND owner_token=?",
        ).run(response, batchId, o.ownerToken);
        job = { ...job, response_json: response, phase: "validating" };
      }
      const results = JSON.parse(job.response_json ?? "[]") as {
        cardId: CardId;
        candidates: unknown[];
      }[];
      const byCard = new Map(results.map((r) => [r.cardId, r.candidates]));
      const banked: { id: string; japanese: string }[] = [];
      items = db
        .query(
          "SELECT seq,card_id,input_json,attempts,hints_json FROM review_batch_item WHERE batch_id=? AND status='pending' ORDER BY seq",
        )
        .all(batchId) as Item[];
      for (const item of items) {
        const input = o.input(batchId, item.input_json);
        if (!input) return err({ kind: "readFailed", detail: "Corrupt batch input" });
        const mode = o.mode(input);
        if (!mode.ok) return mode;
        const accepted: GeneratedMaterial[] = [],
          hints: string[] = [];
        for (const value of byCard.get(item.card_id) ?? []) {
          const validation = await o.validate({ ...input, value, mode: mode.value });
          if (validation.ok) accepted.push(validation.value);
          else if (
            ["readFailed", "writeFailed", "clockFailed"].includes(validation.error.kind)
          )
            return validation;
          else if (validation.error.kind === "validationRejected")
            hints.push(...validation.error.reasons);
          else hints.push(validation.error.kind);
        }
        if (policy.signal?.aborted) return ok(undefined);
        const owner = db
          .query("SELECT owner_token FROM review_batch_job WHERE batch_id=?")
          .get(batchId) as { owner_token: string } | null;
        if (owner?.owner_token !== o.ownerToken) return ok(undefined);
        const stillCurrent = current(input);
        const settled = db
          .transaction((): Result<void, MaterialFailure> => {
            let ready = false;
            if (stillCurrent) {
              for (const value of accepted) {
                const saved = o.store(input, mode.value, value, o.clock());
                if (!saved.ok) throw new Error(saved.error.kind);
                if (saved.value) {
                  banked.push({ id: saved.value, japanese: value.japanese });
                  ready = true;
                }
              }
              const existing = o.hasReserve(input, mode.value);
              if (!existing.ok) throw new Error(existing.error.kind);
              ready ||= existing.value;
            }
            const attempts = item.attempts + 1;
            if (!ready && stillCurrent && attempts < MAX_REVIEW_BATCH_ROUNDS) {
              db.query(
                "UPDATE review_batch_item SET attempts=?,hints_json=?,failure_kind='noValidCandidate',updated_at=? WHERE batch_id=? AND seq=?",
              ).run(
                attempts,
                JSON.stringify([...new Set(hints)]),
                at,
                batchId,
                item.seq,
              );
            } else {
              if (
                !ready &&
                stillCurrent &&
                mode.value === "teach" &&
                input.card.type === "vocabulary"
              ) {
                const fallback = o.word(input, mode.value);
                if (!fallback.ok) throw new Error(fallback.error.kind);
                ready = true;
              }
              db.query(
                "UPDATE review_batch_item SET status=?,attempts=?,failure_kind=?,hints_json=?,updated_at=? WHERE batch_id=? AND seq=?",
              ).run(
                ready ? "ready" : "failed",
                attempts,
                ready
                  ? null
                  : stillCurrent
                    ? hints.length
                      ? "validationRejected"
                      : "noValidCandidate"
                    : "presentationNotFound",
                JSON.stringify([...new Set(hints)]),
                at,
                batchId,
                item.seq,
              );
              if (stillCurrent)
                o.cooldown(item.card_id, ready ? "ready" : "failed", at);
              db.query(
                "DELETE FROM review_batch_claim WHERE card_id=? AND batch_id=?",
              ).run(item.card_id, batchId);
            }
            return ok(undefined);
          })
          .immediate();
        if (!settled.ok) return settled;
      }
      db.transaction(() => {
        db.query(
          "UPDATE review_batch_attempt SET disposition='settled' WHERE batch_id=? AND disposition='running'",
        ).run(batchId);
        db.query("DELETE FROM review_batch_job WHERE batch_id=? AND owner_token=?").run(
          batchId,
          o.ownerToken,
        );
        db.query("UPDATE review_batch SET retry_at=NULL WHERE batch_id=?").run(batchId);
      })();
      o.ready(banked);
      return ok(undefined);
    } catch (cause) {
      return err({
        kind: "writeFailed",
        detail: cause instanceof Error ? cause.message : "Batch execution failed",
      });
    }
  };
  return {
    advance: (id: string, batch: MaterialBatch, policy: BatchAdvanceOptions = {}) => {
      const old = active.get(id);
      if (old) return old;
      const task = run(id, batch, policy).finally(() => {
        if (active.get(id) === task) active.delete(id);
      });
      active.set(id, task);
      return task;
    },
    state: control,
    resume: () => {
      const state = control();
      if (
        state.blocked_reason === "rateLimit" &&
        state.retry_at &&
        state.retry_at > o.clock().toISOString()
      )
        return;
      pause("", null);
    },
  };
}
