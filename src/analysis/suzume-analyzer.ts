import type { Morpheme, Suzume } from "@libraz/suzume";
import { err, ok } from "../result.ts";
import type { AnalyzedText, BroadPartOfSpeech, JapaneseAnalyzer } from "./contracts.ts";
import {
  isSupportedJapaneseText,
  mapNormalizedBoundariesToRaw,
  normalizeJapanese,
  textSpan,
} from "./normalization.ts";

const broadPartOfSpeech = (token: Morpheme): BroadPartOfSpeech => {
  switch (token.pos) {
    case "NOUN":
      return "noun";
    case "VERB":
      return "verb";
    case "ADJECTIVE":
      return "adjective";
    case "ADVERB":
      return "adverb";
    case "PARTICLE":
      return "particle";
    case "AUX":
      return "auxiliary";
    case "INTERJECTION":
      return "interjection";
    default:
      return "symbol";
  }
};

export const createSuzumeAnalyzer = (load: () => Promise<Suzume>): JapaneseAnalyzer => {
  let analyzerPromise: Promise<Suzume> | undefined;
  const analyzer = (): Promise<Suzume> => {
    analyzerPromise ??= load();
    return analyzerPromise;
  };

  return {
    name: "suzume-embedded",
    analyze: async (cueId, rawText) => {
      if (!isSupportedJapaneseText(rawText)) {
        return err({ kind: "unsupportedText", cueId });
      }
      const normalizedText = normalizeJapanese(rawText);
      let tokens: readonly Morpheme[];
      try {
        tokens = (await analyzer()).analyze(normalizedText);
      } catch (cause) {
        return err({
          kind: "analyzerUnavailable",
          cause: cause instanceof Error ? cause.message : "Unknown Suzume load failure",
        });
      }
      if (tokens.length === 0) {
        return err({ kind: "degraded", cueId, cause: "Analyzer returned no tokens" });
      }

      const analysis: AnalyzedText = {
        cueId,
        rawText,
        normalizedText,
        normalization: "nfkc-v1",
        spanUnit: "utf16-code-unit",
        rawBoundaryByNormalizedCodeUnit: mapNormalizedBoundariesToRaw(
          rawText,
          normalizedText,
        ),
        tokens: tokens.map((token) => ({
          surface: token.surface,
          lemma: token.baseForm,
          // Suzume deliberately does not provide readings. Null is an explicit
          // missing capability, never an inferred or fabricated reading.
          reading: null,
          partOfSpeech: [token.posJa, token.extendedPos],
          broadPartOfSpeech: broadPartOfSpeech(token),
          conjugation: token.conjForm,
          span: textSpan(token.startUtf16, token.endUtf16),
          dictionaryFormFound: token.isFromDictionary,
          senseCandidates: [],
        })),
      };
      return ok(analysis);
    },
  };
};
