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

/**
 * The key is supplied by the server environment and is read-only at runtime.
 * It is held in process memory only; nothing writes it to SQLite, a backup, a
 * response, or a log. Changing it is a deployment operation, so there is no
 * route, form, or session copy that could disagree with the environment.
 */
export type ProviderKeyCustody = Readonly<{
  isConfigured: () => boolean;
  /**
   * Whether the current key is usable, verifying it once if it arrived without
   * having been checked -- a key seeded from the environment never passed
   * through `replace`. A key the provider rejects is remembered as unusable; a
   * verification that could not reach the provider is not, because a network
   * blip must not present as a bad key.
   */
  ensureUsable: (signal?: AbortSignal) => Promise<boolean>;
  readForServerAdapter: () => string | null;
}>;

export type KeyVerificationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const createProviderKeyCustody = (
  verifier: ProviderKeyVerifier,
  candidate: string | null = null,
): ProviderKeyCustody => {
  const trimmed = candidate?.trim() ?? "";
  const apiKey: string | null = trimmed === "" ? null : trimmed;
  // Null until the provider has been asked. Verified once and remembered,
  // because the scope panel is drawn on every preflight.
  let usable: boolean | null = null;
  return {
    isConfigured: () => apiKey !== null,
    ensureUsable: async (signal) => {
      if (apiKey === null) return false;
      if (usable !== null) return usable;
      const verified = await verifier.verify(apiKey, signal);
      if (verified.ok) {
        usable = true;
        return true;
      }
      // Only the provider's own refusal is evidence about the key itself.
      if (
        verified.error.kind === "authentication" ||
        verified.error.kind === "permission"
      ) {
        usable = false;
        return false;
      }
      return true;
    },
    readForServerAdapter: () => apiKey,
  };
};

export const createOpenAiKeyVerifier = (options: {
  fetch?: KeyVerificationFetch;
  timeoutMs: number;
  model?: string;
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
      const endpoint =
        options.model === undefined
          ? "https://api.openai.com/v1/models"
          : `https://api.openai.com/v1/models/${encodeURIComponent(options.model)}`;
      const response = await request(endpoint, {
        headers: { Authorization: `Bearer ${candidate}` },
        signal: controller.signal,
      });
      if (response.ok) return ok(undefined);
      const failure = { detail: `key verification returned HTTP ${response.status}` };
      if (response.status === 401) return err({ kind: "authentication", ...failure });
      if (response.status === 403) return err({ kind: "permission", ...failure });
      if (response.status === 429) return err({ kind: "rateLimit", ...failure });
      return err({ kind: "offline", ...failure });
    } catch {
      if (outerSignal?.aborted === true) {
        return err({ kind: "cancelled", detail: "key verification was cancelled" });
      }
      if (timedOut) {
        return err({ kind: "timeout", detail: "key verification timed out" });
      }
      return err({
        kind: "offline",
        detail: "key verification network request failed",
      });
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener("abort", cancel);
    }
  },
});
