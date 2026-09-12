import { describe, expect, test } from "bun:test";
import { createMemoryStore, type KeyValueStore } from "./local-store.ts";
import { createOutbox, type OutboxJob, type OutboxState } from "./outbox.ts";

const job = (id: string, label = id): OutboxJob => ({
  id,
  kind: "answer",
  label,
  url: "/api/study/session/answer",
  body: { id },
});

const harness = (
  transport: (job: OutboxJob) => Promise<unknown>,
  extra: { isRetryable?: (error: unknown) => boolean; store?: KeyValueStore } = {},
) => {
  const states: OutboxState[] = [];
  const slept: number[] = [];
  const sent: { job: OutboxJob; result: unknown }[] = [];
  const outbox = createOutbox({
    transport,
    onChange: (state) => states.push(state),
    onSent: (sentJob, result) => sent.push({ job: sentJob, result }),
    ...(extra.isRetryable === undefined ? {} : { isRetryable: extra.isRetryable }),
    ...(extra.store === undefined ? {} : { store: extra.store }),
    retryDelaysMs: [10, 20],
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { outbox, states, slept, sent };
};

describe("the session outbox", () => {
  test("sends jobs in order, hands back each answer, and reports the count", async () => {
    const order: string[] = [];
    const { outbox, states, sent } = harness(async (sentJob) => {
      order.push(sentJob.id);
      return { echoed: sentJob.id };
    });
    outbox.enqueue(job("first"));
    outbox.enqueue(job("second"));
    await outbox.flush();
    expect(order).toEqual(["first", "second"]);
    expect(sent.map((item) => item.result)).toEqual([
      { echoed: "first" },
      { echoed: "second" },
    ]);
    expect(states.map((state) => state.pending)).toEqual([1, 2, 1, 0]);
    expect(outbox.state()).toEqual({ pending: 0, failed: [], stalled: false });
  });

  test("retries a transport failure with the configured waits, then succeeds", async () => {
    let calls = 0;
    const { outbox, slept } = harness(
      async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("network");
      },
      { isRetryable: () => true },
    );
    outbox.enqueue(job("grade"));
    await outbox.flush();
    expect(calls).toBe(3);
    expect(slept).toEqual([10, 20]);
    expect(outbox.state()).toEqual({ pending: 0, failed: [], stalled: false });
  });

  test("a failure that keeps looking transient stalls the queue, and resume picks it up", async () => {
    let offline = true;
    const { outbox, slept } = harness(
      async () => {
        if (offline) throw new TypeError("network");
      },
      { isRetryable: (error) => error instanceof TypeError },
    );
    outbox.enqueue(job("grade"));
    outbox.enqueue(job("after"));
    await outbox.flush();
    // Nothing is dropped: both jobs are still queued behind the stall.
    expect(slept).toEqual([10, 20]);
    expect(outbox.state()).toEqual({ pending: 2, failed: [], stalled: true });
    offline = false;
    outbox.resume();
    await outbox.flush();
    expect(outbox.state()).toEqual({ pending: 0, failed: [], stalled: false });
  });

  test("a refused write is recorded at once, not retried, and the queue moves on", async () => {
    let calls = 0;
    const { outbox, slept } = harness(
      async (sentJob) => {
        calls += 1;
        if (sentJob.id === "bad") throw new Error("presentationInvalid");
      },
      { isRetryable: (error) => error instanceof TypeError },
    );
    outbox.enqueue(job("bad", "Grade: 猫"));
    outbox.enqueue(job("good"));
    await outbox.flush();
    expect(calls).toBe(2);
    expect(slept).toEqual([]);
    expect(outbox.state()).toEqual({
      pending: 0,
      failed: ["Grade: 猫"],
      stalled: false,
    });
  });

  test("queued jobs survive in the store until sent, and a later outbox restores them", async () => {
    const store = createMemoryStore();
    let release = (): void => {};
    const first = harness(
      (sentJob) =>
        sentJob.id === "slow"
          ? new Promise((resolve) => {
              release = () => resolve(undefined);
            })
          : Promise.resolve(undefined),
      { store },
    );
    first.outbox.enqueue(job("slow"));
    first.outbox.enqueue(job("queued"));
    // Both are on disk while the first is in flight; the page could close now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      ((await store.get<OutboxJob[]>("outbox")) ?? []).map((item) => item.id),
    ).toEqual(["slow", "queued"]);

    // A new page: restore sends what the old one left, in order, and clears the store.
    const order: string[] = [];
    const second = harness(
      async (sentJob) => {
        order.push(sentJob.id);
      },
      { store },
    );
    await second.outbox.restore();
    await second.outbox.flush();
    expect(order).toEqual(["slow", "queued"]);
    expect(await store.get<OutboxJob[]>("outbox")).toEqual([]);
    release();
  });
});
