import type { KeyValueStore } from "./local-store.ts";

/**
 * A background queue for the writes a study session produces: teaching
 * acknowledgements, grades, and suspensions. The browser advances the moment the learner
 * clicks; each write is sent in order behind the scenes and retried on
 * transport failure. An expired login pauses the queue until sign-in. A write
 * the server permanently refuses is recorded rather than retried. Jobs are plain
 * data so the queue can be persisted and picked up by a later page load.
 */
export type OutboxJob = Readonly<{
  id: string;
  kind: "teach" | "answer" | "suspend";
  label: string;
  url: string;
  body: unknown;
}>;

export type OutboxState = Readonly<{
  pending: number;
  failed: readonly string[];
  /** Delivery is paused for sign-in or a connection that may recover. */
  stalled: boolean;
  stalledFor: "authentication" | "connection" | null;
}>;

type Options = Readonly<{
  transport: (job: OutboxJob) => Promise<unknown>;
  onChange: (state: OutboxState) => void;
  /** Called with the server's answer once a job has been sent. */
  onSent?: (job: OutboxJob, result: unknown) => void;
  /** Whether a failure is worth another try; default: never. */
  isRetryable?: (error: unknown) => boolean;
  /** A blocked login needs user action, so keep the job without retrying it. */
  needsAuthentication?: (error: unknown) => boolean;
  /** Waits before each retry; one entry per retry. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** Where queued jobs survive a page load; default: nowhere. */
  store?: KeyValueStore;
  storeKey?: string;
  /** When true, stall at once instead of trying: the browser knows it is offline. */
  shouldWait?: () => boolean;
}>;

export type Outbox = Readonly<{
  enqueue: (job: OutboxJob) => void;
  /** Loads jobs a previous page left queued and starts sending them. */
  restore: () => Promise<void>;
  /** Tries again after a stall, e.g. when the browser comes back online. */
  resume: () => void;
  /** Resolves once every queued job has been sent, given up on, or stalled. */
  flush: () => Promise<void>;
  state: () => OutboxState;
}>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createOutbox = (options: Options): Outbox => {
  const queue: OutboxJob[] = [];
  const failed: string[] = [];
  let stalled = false;
  let stalledFor: OutboxState["stalledFor"] = null;
  let draining: Promise<void> | null = null;
  const isRetryable = options.isRetryable ?? (() => false);
  const delays = options.retryDelaysMs ?? [1_000, 2_000, 4_000, 8_000];
  const sleep = options.sleep ?? defaultSleep;
  const storeKey = options.storeKey ?? "outbox";

  const state = (): OutboxState => ({
    pending: queue.length,
    failed: [...failed],
    stalled,
    stalledFor,
  });
  const notify = (): void => options.onChange(state());
  const persist = async (): Promise<void> => {
    await options.store?.set(storeKey, [...queue]);
  };

  /** Sends one job: sent, refused, or (after every retry) stalled. */
  const attempt = async (
    job: OutboxJob,
  ): Promise<
    | { kind: "sent" | "stalled"; reason?: OutboxState["stalledFor"] }
    | { kind: "refused"; error: unknown }
  > => {
    for (let retry = 0; ; retry += 1) {
      if (options.shouldWait?.() === true)
        return { kind: "stalled", reason: "connection" };
      try {
        const result = await options.transport(job);
        options.onSent?.(job, result);
        return { kind: "sent" };
      } catch (error) {
        if (options.needsAuthentication?.(error)) {
          return { kind: "stalled", reason: "authentication" };
        }
        if (!isRetryable(error)) return { kind: "refused", error };
        const delay = delays[retry];
        if (delay === undefined) return { kind: "stalled", reason: "connection" };
        await sleep(delay);
      }
    }
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0 && !stalled) {
      const job = queue[0];
      if (job === undefined) break;
      const outcome = await attempt(job);
      if (outcome.kind === "stalled") {
        stalled = true;
        stalledFor = outcome.reason ?? "connection";
        notify();
        break;
      }
      if (outcome.kind === "refused") {
        const reason =
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error);
        failed.push(`${job.label} (${reason})`);
      }
      queue.shift();
      await persist();
      notify();
    }
    draining = null;
  };

  const start = (): void => {
    if (draining === null && !stalled && queue.length > 0) draining = drain();
  };

  return {
    enqueue: (job) => {
      queue.push(job);
      void persist();
      notify();
      start();
    },
    restore: async () => {
      const saved = await options.store?.get<OutboxJob[]>(storeKey);
      if (Array.isArray(saved) && saved.length > 0) {
        queue.push(
          ...saved.filter((job) => !queue.some((queued) => queued.id === job.id)),
        );
        notify();
      }
      start();
    },
    resume: () => {
      if (!stalled) return;
      stalled = false;
      stalledFor = null;
      notify();
      start();
    },
    flush: async () => {
      while (draining !== null) await draining;
    },
    state,
  };
};
