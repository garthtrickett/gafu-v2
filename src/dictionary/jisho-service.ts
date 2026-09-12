import { err, ok, type Result } from "../result.ts";
import type { Dictionary, DictionaryFailure } from "./contracts.ts";
import {
  extractJapaneseLookupTerm,
  type JishoLookupResult,
  normalizeJishoResponse,
} from "./jisho.ts";

export const JISHO_SEARCH_ENDPOINT = "https://jisho.org/api/v1/search/words";

type Options = Readonly<{
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Dictionary entries are effectively static, and a study session
   * re-highlights the same words constantly. A small bounded cache keeps that
   * off a free community API with no published rate limit.
   */
  cacheTtlMs?: number;
  cacheEntries?: number;
}>;

const maximumPayloadBytes = 1024 * 1024;

export const createJishoDictionary = (options: Options = {}): Dictionary => {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? 6_000;
  const ttl = options.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  const capacity = options.cacheEntries ?? 500;
  const cache = new Map<string, { expiresAt: number; result: JishoLookupResult }>();

  const remember = (term: string, result: JishoLookupResult): void => {
    if (cache.size >= capacity) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(term, { expiresAt: now() + ttl, result });
  };

  const lookup: Dictionary["lookup"] = async (raw, signal) => {
    // Normalised here as well as in the browser, so the cache key and the
    // upstream query are canonical whatever the client sent.
    const term = extractJapaneseLookupTerm(raw);
    if (term === null) return err({ kind: "invalidTerm" });
    const cached = cache.get(term);
    if (cached !== undefined && cached.expiresAt > now()) return ok(cached.result);
    if (cached !== undefined) cache.delete(term);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let response: Response;
    try {
      response = await doFetch(
        `${JISHO_SEARCH_ENDPOINT}?keyword=${encodeURIComponent(term)}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Gafu V2 private study app (learner-initiated dictionary lookup)",
          },
          signal: controller.signal,
        },
      );
    } catch (cause) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      return err(
        controller.signal.aborted
          ? { kind: "unavailable", detail: "jisho.org did not respond in time." }
          : {
              kind: "unavailable",
              detail: `Could not reach jisho.org: ${String(cause)}`,
            },
      );
    }
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (!response.ok) {
      return err({
        kind: "unavailable",
        detail: `jisho.org returned HTTP ${response.status}.`,
      });
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maximumPayloadBytes) {
      return err({
        kind: "unavailable",
        detail: "jisho.org returned an oversized payload.",
      });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return err({
        kind: "unavailable",
        detail: "jisho.org returned an unreadable payload.",
      });
    }
    const result = normalizeJishoResponse(payload, term);
    remember(term, result);
    return ok(result);
  };

  return { lookup };
};

/**
 * Fake-AI stand-in: one fixed entry for any valid term, so browser journeys
 * exercise the highlight-to-dialog path with no network.
 */
export const createDeterministicDictionary = (): Dictionary => ({
  lookup: async (raw): Promise<Result<JishoLookupResult, DictionaryFailure>> => {
    const term = extractJapaneseLookupTerm(raw);
    if (term === null) return err({ kind: "invalidTerm" });
    return ok({
      term,
      entries: [
        {
          slug: term,
          isCommon: true,
          jlpt: ["jlpt-n5"],
          forms: [{ word: term, reading: "よみ" }],
          senses: [
            {
              englishDefinitions: [`deterministic sense of ${term}`],
              partsOfSpeech: ["Noun"],
              tags: [],
              seeAlso: [],
            },
          ],
        },
      ],
    });
  },
});
