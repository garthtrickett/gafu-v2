import type { AnalyzedText, TextSpan } from "./contracts.ts";

export const normalizeJapanese = (rawText: string): string => rawText.normalize("NFKC");

export const isSupportedJapaneseText = (rawText: string): boolean =>
  rawText.trim().length > 0 && !rawText.includes(String.fromCharCode(0));

export const textSpan = (start: number, end: number): TextSpan => ({
  start,
  end,
  unit: "utf16-code-unit",
  normalization: "nfkc-v1",
});

export const mapNormalizedBoundariesToRaw = (
  rawText: string,
  normalizedText: string,
): readonly (number | null)[] => {
  const boundaries: (number | null)[] = Array.from(
    { length: normalizedText.length + 1 },
    () => null,
  );

  for (let rawBoundary = 0; rawBoundary <= rawText.length; rawBoundary += 1) {
    const normalizedBoundary = rawText.slice(0, rawBoundary).normalize("NFKC").length;
    if (normalizedBoundary <= normalizedText.length) {
      boundaries[normalizedBoundary] = rawBoundary;
    }
  }
  return boundaries;
};

export const reconstructsSurface = (
  analysis: AnalyzedText,
  span: TextSpan,
  surface: string,
): boolean => analysis.normalizedText.slice(span.start, span.end) === surface;

export const katakanaToHiragana = (reading: string): string =>
  Array.from(reading, (character) => {
    const code = character.codePointAt(0);
    if (code !== undefined && code >= 0x30a1 && code <= 0x30f6) {
      return String.fromCodePoint(code - 0x60);
    }
    return character;
  }).join("");

const kanaOnly = /^[ぁ-ゟ゠-ヿー]*$/u;

/**
 * The reading of a token's dictionary form, or null when it cannot be had.
 *
 * Kuromoji reads the surface, so an inflected word reads as it is written:
 * 聞き出し is ききだし, never ききだす. Japanese inflection only rewrites the
 * kana tail, and that tail appears verbatim in the reading, so swapping the
 * surface's tail for the lemma's recovers the dictionary reading. Doing it
 * this way rather than reading the lemma afresh keeps homographs apart:
 * 開いた reads ひらい or あい and yields ひらく or あく, where looking the
 * lemma up again would collapse both onto whichever kuromoji prefers.
 *
 * Null means the rule does not apply — the irregular verbs, whose stem shares
 * no writing with their lemma (した against する), and anything whose tail is
 * not kana. The caller decides what an unknown reading means.
 */
export const dictionaryFormReading = (
  surface: string,
  reading: string,
  lemma: string,
): string | null => {
  if (surface === lemma) return reading;
  let shared = 0;
  while (
    shared < surface.length &&
    shared < lemma.length &&
    surface[shared] === lemma[shared]
  ) {
    shared += 1;
  }
  if (shared === 0) return null;
  const surfaceTail = surface.slice(shared);
  const lemmaTail = lemma.slice(shared);
  if (!kanaOnly.test(surfaceTail) || !kanaOnly.test(lemmaTail)) return null;
  const spoken = katakanaToHiragana(reading);
  const spokenTail = katakanaToHiragana(surfaceTail);
  if (!spoken.endsWith(spokenTail)) return null;
  return spoken.slice(0, spoken.length - spokenTail.length) + lemmaTail;
};
