import { describe, expect, test } from "bun:test";
import { createOutbox, type OutboxState } from "./outbox.ts";

const harness = (isRetryable?: (error: unknown) => boolean) => {
  const states: OutboxState[] = [];
  const slept: number[] = [];
  const outbox = createOutbox({
    onChange: (state) => states.push(state),
    ...(isRetryable === undefined ? {} : { isRetryable }),
    retryDelaysMs: [10, 20],
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { outbox, states, slept };
};

describe("the session outbox", () => {
  test("sends jobs in order and reports the count as it goes", async () => {
    const { outbox, states } = harness();
    const sent: string[] = [];
    const send = (label: string) => async () => {
      sent.push(label);
    };
    outbox.enqueue({ label: "first", send: send("first") });
    outbox.enqueue({ label: "second", send: send("second") });
    await outbox.flush();
    expect(sent).toEqual(["first", "second"]);
    expect(states.map((state) => state.pending)).toEqual([1, 2, 1, 0]);
    expect(outbox.state()).toEqual({ pending: 0, failed: [] });
  });

  test("retries a transport failure with the configured waits, then succeeds", async () => {
    const { outbox, slept } = harness(() => true);
    let calls = 0;
    outbox.enqueue({
      label: "grade",
      send: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("network");
      },
    });
    await outbox.flush();
    expect(calls).toBe(3);
    expect(slept).toEqual([10, 20]);
    expect(outbox.state().failed).toEqual([]);
  });

  test("gives up after the last retry and records the job", async () => {
    const { outbox, slept } = harness(() => true);
    outbox.enqueue({
      label: "grade 猫",
      send: async () => {
        throw new TypeError("network");
      },
    });
    outbox.enqueue({
      label: "after",
      send: async () => undefined,
    });
    await outbox.flush();
    expect(slept).toEqual([10, 20]);
    expect(outbox.state()).toEqual({ pending: 0, failed: ["grade 猫"] });
  });

  test("a refused write is recorded at once, not retried", async () => {
    const { outbox, slept } = harness((error) => error instanceof TypeError);
    let calls = 0;
    outbox.enqueue({
      label: "grade",
      send: async () => {
        calls += 1;
        throw new Error("presentationInvalid");
      },
    });
    await outbox.flush();
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
    expect(outbox.state().failed).toEqual(["grade"]);
  });

  test("jobs enqueued while draining are sent by the same drain", async () => {
    const { outbox } = harness();
    const sent: string[] = [];
    let release = (): void => {};
    outbox.enqueue({
      label: "slow",
      send: () =>
        new Promise((resolve) => {
          release = () => {
            sent.push("slow");
            resolve();
          };
        }),
    });
    outbox.enqueue({
      label: "queued",
      send: async () => {
        sent.push("queued");
      },
    });
    expect(outbox.state().pending).toBe(2);
    release();
    await outbox.flush();
    expect(sent).toEqual(["slow", "queued"]);
  });
});
