/**
 * A background queue for the writes a study session produces: teaching
 * acknowledgements and grades. The browser advances the moment the learner
 * clicks; each write is sent in order behind the scenes, retried on
 * transport failure, and a write the server refuses is recorded rather than
 * retried, because sending it again would be refused again.
 */
export type OutboxJob = Readonly<{ label: string; send: () => Promise<void> }>;

export type OutboxState = Readonly<{ pending: number; failed: readonly string[] }>;

type Options = Readonly<{
  onChange: (state: OutboxState) => void;
  /** Whether a failure is worth another try; default: never. */
  isRetryable?: (error: unknown) => boolean;
  /** Waits before each retry; one entry per retry. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}>;

export type Outbox = Readonly<{
  enqueue: (job: OutboxJob) => void;
  /** Resolves once every queued job has been sent or given up on. */
  flush: () => Promise<void>;
  state: () => OutboxState;
}>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createOutbox = (options: Options): Outbox => {
  const queue: OutboxJob[] = [];
  const failed: string[] = [];
  let draining: Promise<void> | null = null;
  const isRetryable = options.isRetryable ?? (() => false);
  const delays = options.retryDelaysMs ?? [1_000, 2_000, 4_000, 8_000];
  const sleep = options.sleep ?? defaultSleep;

  const state = (): OutboxState => ({ pending: queue.length, failed: [...failed] });
  const notify = (): void => options.onChange(state());

  const attempt = async (job: OutboxJob): Promise<void> => {
    for (let retry = 0; ; retry += 1) {
      try {
        await job.send();
        return;
      } catch (error) {
        const delay = delays[retry];
        if (delay === undefined || !isRetryable(error)) {
          failed.push(job.label);
          return;
        }
        await sleep(delay);
      }
    }
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const job = queue[0];
      if (job === undefined) break;
      await attempt(job);
      queue.shift();
      notify();
    }
    draining = null;
  };

  return {
    enqueue: (job) => {
      queue.push(job);
      notify();
      if (draining === null) draining = drain();
    },
    flush: async () => {
      while (draining !== null) await draining;
    },
    state,
  };
};
