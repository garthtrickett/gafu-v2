/**
 * Jisho lookup: the wire contract the browser renders, and the two pure
 * steps every lookup passes through on both sides — reducing a highlight to
 * a term, and reducing jisho.org's unversioned community payload to that
 * contract.
 *
 * The browser cannot call jisho.org directly (it serves no CORS headers), so
 * the server proxies one bounded, learner-gated search. Every upstream field
 * is treated as untrusted: an unreadable entry is dropped, never thrown.
 */

export type JishoForm = Readonly<{ word: string | null; reading: string | null }>;

export type JishoSense = Readonly<{
  englishDefinitions: readonly string[];
  partsOfSpeech: readonly string[];
  tags: readonly string[];
  seeAlso: readonly string[];
}>;

export type JishoEntry = Readonly<{
  slug: string;
  isCommon: boolean;
  jlpt: readonly string[];
  forms: readonly JishoForm[];
  senses: readonly JishoSense[];
}>;

export type JishoLookupResult = Readonly<{
  term: string;
  entries: readonly JishoEntry[];
}>;

// A highlighted run longer than this is a sentence, not a word: Jisho would
// return nothing useful and the learner almost certainly mis-dragged.
export const MAX_LOOKUP_TERM_LENGTH = 24;
export const MAX_LOOKUP_ENTRIES = 6;
export const MAX_LOOKUP_SENSES = 5;
export const MAX_LOOKUP_DEFINITIONS = 6;

// 々 and 〆 sit inside the CJK punctuation block but are part of real words
// (人々, 〆切), so they are matched as letters rather than stripped as edges.
const JAPANESE_CHARACTER = /[々〆぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/u;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Reduces a highlight to a lookup term, or null when it is not one word of
 * Japanese. Selections spanning ruby markup arrive with layout whitespace
 * baked in, so all whitespace goes, not just the edges.
 */
export const extractJapaneseLookupTerm = (raw: string): string | null => {
  const collapsed = raw.replace(/\s+/gu, "");
  const trimmed = collapsed.replace(EDGE_PUNCTUATION, "");
  if (trimmed.length === 0 || trimmed.length > MAX_LOOKUP_TERM_LENGTH) return null;
  if (!JAPANESE_CHARACTER.test(trimmed)) return null;
  return trimmed;
};

export const jishoWebUrl = (term: string): string =>
  `https://jisho.org/search/${encodeURIComponent(term)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown, limit: number): readonly string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, limit)
    : [];

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeSense = (value: unknown): JishoSense | null => {
  if (!isRecord(value)) return null;
  const englishDefinitions = strings(
    value["english_definitions"],
    MAX_LOOKUP_DEFINITIONS,
  );
  if (englishDefinitions.length === 0) return null;
  return {
    englishDefinitions,
    partsOfSpeech: strings(value["parts_of_speech"], MAX_LOOKUP_DEFINITIONS),
    tags: strings(value["tags"], MAX_LOOKUP_DEFINITIONS),
    seeAlso: strings(value["see_also"], MAX_LOOKUP_DEFINITIONS),
  };
};

const normalizeEntry = (value: unknown, term: string): JishoEntry | null => {
  if (!isRecord(value)) return null;
  const forms = (Array.isArray(value["japanese"]) ? value["japanese"] : [])
    .map((form): JishoForm | null =>
      isRecord(form)
        ? {
            word: optionalString(form["word"]),
            reading: optionalString(form["reading"]),
          }
        : null,
    )
    .filter(
      (form): form is JishoForm =>
        form !== null && (form.word !== null || form.reading !== null),
    );
  const senses = (Array.isArray(value["senses"]) ? value["senses"] : [])
    .map(normalizeSense)
    .filter((sense): sense is JishoSense => sense !== null)
    .slice(0, MAX_LOOKUP_SENSES);
  if (senses.length === 0) return null;
  const slug =
    optionalString(value["slug"]) ?? forms[0]?.word ?? forms[0]?.reading ?? term;
  return {
    slug,
    isCommon: value["is_common"] === true,
    jlpt: strings(value["jlpt"], MAX_LOOKUP_DEFINITIONS),
    forms,
    senses,
  };
};

/**
 * Reduces jisho.org's `/api/v1/search/words` payload to the contract. An
 * unparseable payload is an empty result, not a failure: the learner sees
 * "no entry" rather than an error for a word Jisho simply lacks.
 */
export const normalizeJishoResponse = (
  payload: unknown,
  term: string,
): JishoLookupResult => {
  const data =
    isRecord(payload) && Array.isArray(payload["data"]) ? payload["data"] : [];
  const entries = data
    .map((entry) => normalizeEntry(entry, term))
    .filter((entry): entry is JishoEntry => entry !== null)
    .slice(0, MAX_LOOKUP_ENTRIES);
  return { term, entries };
};
