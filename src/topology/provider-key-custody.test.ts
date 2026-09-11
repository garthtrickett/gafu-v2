import { describe, expect, test } from "bun:test";
import { err, ok } from "../result.ts";
import {
  createOpenAiKeyVerifier,
  createProviderKeyCustody,
  type KeyVerificationFetch,
} from "./provider-key-custody.ts";

describe("server-side provider key custody spike", () => {
  test("takes the server-held deployment secret and trims it", () => {
    const custody = createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "  sk-deployed  ",
    );
    expect(custody.isConfigured()).toBe(true);
    expect(custody.readForServerAdapter()).toBe("sk-deployed");
  });

  test("reports no key when the environment supplies none or only blanks", () => {
    const verifier = { verify: async () => ok(undefined) };
    expect(createProviderKeyCustody(verifier).isConfigured()).toBe(false);
    expect(createProviderKeyCustody(verifier, "   ").isConfigured()).toBe(false);
    expect(createProviderKeyCustody(verifier, "   ").readForServerAdapter()).toBeNull();
  });

  test("verifies an environment-seeded key once, on first use", async () => {
    let verifications = 0;
    const custody = createProviderKeyCustody(
      {
        verify: async () => {
          verifications += 1;
          return ok(undefined);
        },
      },
      "sk-deployed",
    );
    expect(await custody.ensureUsable()).toBe(true);
    expect(await custody.ensureUsable()).toBe(true);
    // Verified once and remembered: the scope panel is drawn on every preflight.
    expect(verifications).toBe(1);
  });

  test("an environment-seeded key the provider rejects is not usable", async () => {
    const custody = createProviderKeyCustody(
      {
        verify: async () =>
          err({ kind: "authentication", detail: "HTTP 401" } as const),
      },
      "sk-revoked",
    );
    // isConfigured only knows a key is present; it cannot know it works.
    expect(custody.isConfigured()).toBe(true);
    expect(await custody.ensureUsable()).toBe(false);
  });

  test("an unreachable provider does not condemn the key", async () => {
    let verifications = 0;
    const custody = createProviderKeyCustody(
      {
        verify: async () => {
          verifications += 1;
          return err({ kind: "offline", detail: "no route" } as const);
        },
      },
      "sk-deployed",
    );
    // A network blip is not evidence about the key, and is not remembered.
    expect(await custody.ensureUsable()).toBe(true);
    expect(await custody.ensureUsable()).toBe(true);
    expect(verifications).toBe(2);
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
