import type { Result } from "../result.ts";

export type TextSpan = Readonly<{
  start: number;
  end: number;
  unit: "utf16-code-unit";
  normalization: "nfkc-v1";
}>;

export type BroadPartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "particle"
  | "auxiliary"
  | "copula"
  | "interjection"
  | "symbol";

export type AnalyzedToken = Readonly<{
  surface: string;
  lemma: string;
  reading: string | null;
  partOfSpeech: readonly string[];
  broadPartOfSpeech: BroadPartOfSpeech;
  conjugation: string | null;
  span: TextSpan;
  dictionaryFormFound: boolean;
  senseCandidates: readonly string[];
}>;

export type AnalyzedText = Readonly<{
  cueId: string;
  rawText: string;
  normalizedText: string;
  normalization: "nfkc-v1";
  spanUnit: "utf16-code-unit";
  rawBoundaryByNormalizedCodeUnit: readonly (number | null)[];
  tokens: readonly AnalyzedToken[];
}>;

export type AnalysisError =
  | { readonly kind: "analyzerUnavailable"; readonly cause: string }
  | { readonly kind: "unsupportedText"; readonly cueId: string }
  | { readonly kind: "invalidSpan"; readonly cueId: string; readonly surface: string }
  | { readonly kind: "degraded"; readonly cueId: string; readonly cause: string };

export type JapaneseAnalyzer = Readonly<{
  name: string;
  analyze: (
    cueId: string,
    rawText: string,
  ) => Promise<Result<AnalyzedText, AnalysisError>>;
}>;
