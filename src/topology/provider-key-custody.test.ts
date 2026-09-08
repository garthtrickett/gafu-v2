import { describe, expect, test } from "bun:test";
import { err, ok } from "../result.ts";
import {
  createOpenAiKeyVerifier,
  createProviderKeyCustody,
  type KeyVerificationFetch,
} from "./provider-key-custody.ts";

describe("server-side provider key custody spike", () => {
  test("enters, verifies, replaces, and removes a key without exposing it in status", async () => {
    const observed: string[] = [];
    const custody = createProviderKeyCustody({
      verify: async (candidate) => {
        observed.push(candidate);
        return ok(undefined);
      },
    });
    expect(custody.isConfigured()).toBe(false);
    expect((await custody.replace("  first-secret  ")).ok).toBe(true);
    expect(custody.isConfigured()).toBe(true);
    expect(custody.readForServerAdapter()).toBe("first-secret");
    expect((await custody.replace("second-secret")).ok).toBe(true);
    expect(custody.readForServerAdapter()).toBe("second-secret");
    custody.remove();
    expect(custody.isConfigured()).toBe(false);
    expect(custody.readForServerAdapter()).toBeNull();
    expect(observed).toEqual(["first-secret", "second-secret"]);
  });

  test("a rejected replacement preserves the last verified key", async () => {
    const custody = createProviderKeyCustody({
      verify: async (candidate) =>
        candidate === "good"
          ? ok(undefined)
          : err({ kind: "authentication", detail: "rejected" }),
    });
    await custody.replace("good");
    const rejected = await custody.replace("bad");
    expect(rejected.ok).toBe(false);
    expect(custody.readForServerAdapter()).toBe("good");
  });

  test.each([
    [401, "authentication"],
    [403, "permission"],
    [429, "rateLimit"],
    [500, "offline"],
  ] as const)("maps verification HTTP %i to %s", async (status, kind) => {
    const verifier = createOpenAiKeyVerifier({
      timeoutMs: 20,
      fetch: async () => new Response("private", { status }),
    });
    const result = await verifier.verify("secret");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(kind);
      expect(result.error.detail).not.toContain("private");
      expect(result.error.detail).not.toContain("secret");
    }
  });

  test("maps verification cancellation and timeout separately", async () => {
    const hangingFetch: KeyVerificationFetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted === true) {
          reject(new Error("aborted"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const verifier = createOpenAiKeyVerifier({ timeoutMs: 20, fetch: hangingFetch });
    const timeout = await verifier.verify("secret");
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.error.kind).toBe("timeout");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await verifier.verify("secret", controller.signal);
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.error.kind).toBe("cancelled");
  });
});
