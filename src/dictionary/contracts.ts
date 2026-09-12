import type { Result } from "../result.ts";
import type { JishoLookupResult } from "./jisho.ts";

export type DictionaryFailure =
  /** The highlight is not one word of Japanese; nothing was sent upstream. */
  | { readonly kind: "invalidTerm" }
  /** jisho.org could not be reached, timed out, or answered unreadably. */
  | { readonly kind: "unavailable"; readonly detail: string };

export type Dictionary = Readonly<{
  lookup: (
    term: string,
    signal?: AbortSignal,
  ) => Promise<Result<JishoLookupResult, DictionaryFailure>>;
}>;
