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
  initialCandidate: string | null = null,
): ProviderKeyCustody => {
  const initialKey = initialCandidate?.trim() ?? "";
  let apiKey: string | null = initialKey === "" ? null : initialKey;
  let revision = 0;
  // Null until this key's usability is known. An environment-seeded key starts
  // unknown; `replace` only stores a key it has already verified.
  let usable: boolean | null = null;
  return {
    replace: async (candidate, signal) => {
      const operationRevision = ++revision;
      const trimmed = candidate.trim();
      if (trimmed === "") {
        return err({ kind: "authentication", detail: "API key is empty" });
      }
      const verified = await verifier.verify(trimmed, signal);
      if (!verified.ok) return verified;
      if (operationRevision !== revision) {
        return err({
          kind: "cancelled",
          detail: "A newer key change superseded this one",
        });
      }
      apiKey = trimmed;
      usable = true;
      return ok(undefined);
    },
    remove: () => {
      revision += 1;
      apiKey = null;
      usable = null;
    },
    isConfigured: () => apiKey !== null,
    ensureUsable: async (signal) => {
      const candidate = apiKey;
      if (candidate === null) return false;
      if (usable !== null) return usable;
      const operationRevision = revision;
      const verified = await verifier.verify(candidate, signal);
      if (operationRevision !== revision) return apiKey !== null && usable !== false;
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
