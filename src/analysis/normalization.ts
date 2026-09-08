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
