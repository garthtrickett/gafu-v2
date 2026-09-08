import { err, ok, type Result } from "../result.ts";

export type KeyVerificationFailure =
  | { readonly kind: "authentication"; readonly detail: string }
  | { readonly kind: "permission"; readonly detail: string }
  | { readonly kind: "rateLimit"; readonly detail: string }
  | { readonly kind: "offline"; readonly detail: string }
  | { readonly kind: "timeout"; readonly detail: string }
  | { readonly kind: "cancelled"; readonly detail: string };

export type ProviderKeyVerifier = Readonly<{
  verify: (
    candidate: string,
    signal?: AbortSignal,
  ) => Promise<Result<void, KeyVerificationFailure>>;
}>;

export type ProviderKeyCustody = Readonly<{
  replace: (
    candidate: string,
    signal?: AbortSignal,
  ) => Promise<Result<void, KeyVerificationFailure>>;
  remove: () => void;
  isConfigured: () => boolean;
  readForServerAdapter: () => string | null;
}>;

export type KeyVerificationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const createProviderKeyCustody = (
  verifier: ProviderKeyVerifier,
): ProviderKeyCustody => {
  let apiKey: string | null = null;
  return {
    replace: async (candidate, signal) => {
      const trimmed = candidate.trim();
      if (trimmed === "") {
        return err({ kind: "authentication", detail: "API key is empty" });
      }
      const verified = await verifier.verify(trimmed, signal);
      if (!verified.ok) return verified;
      apiKey = trimmed;
      return ok(undefined);
    },
    remove: () => {
      apiKey = null;
    },
    isConfigured: () => apiKey !== null,
    readForServerAdapter: () => apiKey,
  };
};

export const createOpenAiKeyVerifier = (options: {
  fetch?: KeyVerificationFetch;
  timeoutMs: number;
}): ProviderKeyVerifier => ({
  verify: async (candidate, outerSignal) => {
    const request = options.fetch ?? fetch;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const cancel = () => controller.abort();
    if (outerSignal?.aborted === true) cancel();
    else outerSignal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await request("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${candidate}` },
        signal: controller.signal,
      });
      if (response.ok) return ok(undefined);
      const failure = { detail: `key verification returned HTTP ${response.status}` };
      if (response.status === 401) return err({ kind: "authentication", ...failure });
      if (response.status === 403) return err({ kind: "permission", ...failure });
      if (response.status === 429) return err({ kind: "rateLimit", ...failure });
      return err({ kind: "offline", ...failure });
    } catch (cause) {
      if (outerSignal?.aborted === true) {
        return err({ kind: "cancelled", detail: "key verification was cancelled" });
      }
      if (timedOut) {
        return err({ kind: "timeout", detail: "key verification timed out" });
      }
      return err({
        kind: "offline",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener("abort", cancel);
    }
  },
});
