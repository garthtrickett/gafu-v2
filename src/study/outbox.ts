import type { KeyValueStore } from "./local-store.ts";

/**
 * A background queue for the writes a study session produces: teaching
 * acknowledgements and grades. The browser advances the moment the learner
 * clicks; each write is sent in order behind the scenes and retried on
 * transport failure. A write the server refuses is recorded rather than
 * retried, because sending it again would be refused again. Jobs are plain
 * data so the queue can be persisted and picked up by a later page load.
 */
export type OutboxJob = Readonly<{
  id: string;
  kind: "teach" | "answer";
  label: string;
  url: string;
  body: unknown;
}>;

export type OutboxState = Readonly<{
  pending: number;
  failed: readonly string[];
  /** Retries are exhausted but the failure looked transient: waiting to resume. */
  stalled: boolean;
}>;

type Options = Readonly<{
  transport: (job: OutboxJob) => Promise<unknown>;
  onChange: (state: OutboxState) => void;
  /** Called with the server's answer once a job has been sent. */
  onSent?: (job: OutboxJob, result: unknown) => void;
  /** Whether a failure is worth another try; default: never. */
  isRetryable?: (error: unknown) => boolean;
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
  let draining: Promise<void> | null = null;
  const isRetryable = options.isRetryable ?? (() => false);
  const delays = options.retryDelaysMs ?? [1_000, 2_000, 4_000, 8_000];
  const sleep = options.sleep ?? defaultSleep;
  const storeKey = options.storeKey ?? "outbox";

  const state = (): OutboxState => ({
    pending: queue.length,
    failed: [...failed],
    stalled,
  });
  const notify = (): void => options.onChange(state());
  const persist = async (): Promise<void> => {
    await options.store?.set(storeKey, [...queue]);
  };

  /** Sends one job: sent, refused, or (after every retry) stalled. */
  const attempt = async (job: OutboxJob): Promise<"sent" | "refused" | "stalled"> => {
    for (let retry = 0; ; retry += 1) {
      if (options.shouldWait?.() === true) return "stalled";
      try {
        const result = await options.transport(job);
        options.onSent?.(job, result);
        return "sent";
      } catch (error) {
        if (!isRetryable(error)) return "refused";
        const delay = delays[retry];
        if (delay === undefined) return "stalled";
        await sleep(delay);
      }
    }
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0 && !stalled) {
      const job = queue[0];
      if (job === undefined) break;
      const outcome = await attempt(job);
      if (outcome === "stalled") {
        stalled = true;
        notify();
        break;
      }
      if (outcome === "refused") failed.push(job.label);
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
      notify();
      start();
    },
    flush: async () => {
      while (draining !== null) await draining;
    },
    state,
  };
};
