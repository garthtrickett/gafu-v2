import type { IpadicFeatures, Tokenizer } from "@faanau/kuromoji";
import { err, ok } from "../result.ts";
import type {
  AnalysisError,
  AnalyzedText,
  AnalyzedToken,
  BroadPartOfSpeech,
  JapaneseAnalyzer,
} from "./contracts.ts";
import {
  isSupportedJapaneseText,
  katakanaToHiragana,
  mapNormalizedBoundariesToRaw,
  normalizeJapanese,
  textSpan,
} from "./normalization.ts";

export type KuromojiTokenizerLoader = () => Promise<Tokenizer>;

const broadPartOfSpeech = (token: IpadicFeatures): BroadPartOfSpeech => {
  switch (token.pos) {
    case "名詞":
      return token.pos_detail_1 === "副詞可能" ? "adverb" : "noun";
    case "動詞":
      return "verb";
    case "形容詞":
    case "形容動詞":
      return "adjective";
    case "副詞":
    case "連体詞":
      return "adverb";
    case "助詞":
      return "particle";
    case "助動詞":
      return "auxiliary";
    case "感動詞":
      return "interjection";
    default:
      return "symbol";
  }
};

const findSpan = (
  normalizedText: string,
  surface: string,
  cursor: number,
): readonly [number, number] | null => {
  const start = normalizedText.indexOf(surface, cursor);
  return start < 0 ? null : [start, start + surface.length];
};

const mapTokens = (
  cueId: string,
  normalizedText: string,
  nativeTokens: readonly IpadicFeatures[],
):
  | { readonly ok: true; readonly tokens: readonly AnalyzedToken[] }
  | {
      readonly ok: false;
      readonly error: AnalysisError;
    } => {
  const tokens: AnalyzedToken[] = [];
  let cursor = 0;

  for (const token of nativeTokens) {
    const located = findSpan(normalizedText, token.surface_form, cursor);
    if (located === null) {
      return {
        ok: false,
        error: { kind: "invalidSpan", cueId, surface: token.surface_form },
      };
    }
    const [start, end] = located;
    tokens.push({
      surface: token.surface_form,
      lemma: token.basic_form === "*" ? token.surface_form : token.basic_form,
      reading: token.reading === undefined ? null : katakanaToHiragana(token.reading),
      partOfSpeech: [
        token.pos,
        token.pos_detail_1,
        token.pos_detail_2,
        token.pos_detail_3,
      ],
      broadPartOfSpeech: broadPartOfSpeech(token),
      conjugation: token.conjugated_form === "*" ? null : token.conjugated_form,
      span: textSpan(start, end),
      dictionaryFormFound: token.word_type === "KNOWN",
      senseCandidates: [],
    });
    cursor = end;
  }
  const reconciled: AnalyzedToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    const currentNative = nativeTokens[index];
    const nextNative = nativeTokens[index + 1];
    if (
      current !== undefined &&
      next !== undefined &&
      currentNative !== undefined &&
      nextNative !== undefined &&
      current.span.end === next.span.start
    ) {
      const sahenVerb =
        currentNative.pos === "名詞" &&
        currentNative.pos_detail_1 === "サ変接続" &&
        nextNative.basic_form === "する";
      const voiceAuxiliary =
        currentNative.pos === "動詞" &&
        (nextNative.pos === "助動詞" || nextNative.pos_detail_1 === "接尾") &&
        ["れる", "られる", "せる", "させる"].includes(nextNative.basic_form);
      if (sahenVerb || voiceAuxiliary) {
        reconciled.push({
          surface: current.surface + next.surface,
          lemma: sahenVerb ? current.lemma + next.lemma : current.lemma,
          reading:
            current.reading === null || next.reading === null
              ? null
              : current.reading + next.reading,
          partOfSpeech: [...current.partOfSpeech, ...next.partOfSpeech],
          broadPartOfSpeech: "verb",
          conjugation:
            voiceAuxiliary && ["せる", "させる"].includes(nextNative.basic_form)
              ? "使役形"
              : voiceAuxiliary
                ? "受身形"
                : next.conjugation,
          span: textSpan(current.span.start, next.span.end),
          dictionaryFormFound: current.dictionaryFormFound && next.dictionaryFormFound,
          senseCandidates: [],
        });
        index += 1;
        continue;
      }
    }
    if (current !== undefined) reconciled.push(current);
  }
  return { ok: true, tokens: reconciled };
};

export const createKuromojiAnalyzer = (
  load: KuromojiTokenizerLoader,
): JapaneseAnalyzer => {
  let tokenizerPromise: Promise<Tokenizer> | undefined;
  const tokenizer = (): Promise<Tokenizer> => {
    tokenizerPromise ??= load();
    return tokenizerPromise;
  };

  return {
    name: "kuromoji-ipadic",
    analyze: async (cueId, rawText) => {
      if (!isSupportedJapaneseText(rawText)) {
        return err({ kind: "unsupportedText", cueId });
      }

      const normalizedText = normalizeJapanese(rawText);
      let nativeTokens: readonly IpadicFeatures[];
      try {
        nativeTokens = (await tokenizer()).tokenize(normalizedText);
      } catch (cause) {
        return err({
          kind: "analyzerUnavailable",
          cause:
            cause instanceof Error ? cause.message : "Unknown Kuromoji load failure",
        });
      }

      const mapped = mapTokens(cueId, normalizedText, nativeTokens);
      if (!mapped.ok) return err(mapped.error);
      if (mapped.tokens.length === 0) {
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
        tokens: mapped.tokens,
      };
      return ok(analysis);
    },
  };
};
