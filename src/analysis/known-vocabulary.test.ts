import { expect, test } from "bun:test";
import type { AnalyzedText, AnalyzedToken } from "./contracts.ts";
import { classifyKnownVocabulary } from "./known-vocabulary.ts";

const token: AnalyzedToken = {
  surface: "橋",
  lemma: "橋",
  reading: "はし",
  partOfSpeech: ["名詞"],
  broadPartOfSpeech: "noun",
  conjugation: null,
  span: {
    start: 0,
    end: 1,
    unit: "utf16-code-unit",
    normalization: "nfkc-v1",
  },
  dictionaryFormFound: true,
  senseCandidates: [],
};

const analysis: AnalyzedText = {
  cueId: "test",
  rawText: "橋",
  normalizedText: "橋",
  normalization: "nfkc-v1",
  spanUnit: "utf16-code-unit",
  rawBoundaryByNormalizedCodeUnit: [0, 1],
  tokens: [token],
};

test("does not call a homograph known without matching sense evidence", () => {
  expect(
    classifyKnownVocabulary(analysis, [
      {
        lemma: "橋",
        reading: "はし",
        partOfSpeech: "noun",
        scope: { kind: "oneSense", senseId: "bridge" },
      },
    ])[0]?.status,
  ).toBe("unresolved");
});

test("allows an explicit all-senses Known Word Bank entry", () => {
  expect(
    classifyKnownVocabulary(analysis, [
      {
        lemma: "橋",
        reading: "はし",
        partOfSpeech: "noun",
        scope: { kind: "allSenses" },
      },
    ])[0]?.status,
  ).toBe("known");
});

const inflected = (
  lemma: string,
  surfaceReading: string,
  broadPartOfSpeech: AnalyzedToken["broadPartOfSpeech"],
): AnalyzedText => ({
  ...analysis,
  tokens: [
    { ...token, lemma, reading: surfaceReading, broadPartOfSpeech, surface: lemma },
  ],
});

test("an inflected known word is known, though its surface reading differs", () => {
  // token.reading is the reading of the surface: 分かる arrives with わかっ.
  const classified = classifyKnownVocabulary(inflected("分かる", "わかっ", "verb"), [
    {
      lemma: "分かる",
      reading: "わかる",
      partOfSpeech: "verb",
      scope: { kind: "allSenses" },
    },
  ]);
  expect(classified[0]?.status).toBe("known");
});

test("a word written in kana is the same word as its kanji entry", () => {
  const bank = [
    {
      lemma: "可愛い",
      reading: "かわいい",
      partOfSpeech: "adjective" as const,
      scope: { kind: "allSenses" as const },
    },
  ];
  expect(
    classifyKnownVocabulary(inflected("かわいい", "かわいく", "adjective"), bank)[0]
      ?.status,
  ).toBe("known");
  expect(
    classifyKnownVocabulary(inflected("可愛い", "かわいい", "adjective"), bank)[0]
      ?.status,
  ).toBe("known");
});

test("a na-adjective lemmatised with its copula is the same word", () => {
  const classified = classifyKnownVocabulary(
    inflected("清潔だ", "せいけつな", "adjective"),
    [
      {
        lemma: "清潔",
        reading: "せいけつ",
        partOfSpeech: "adjective",
        scope: { kind: "allSenses" },
      },
    ],
  );
  expect(classified[0]?.status).toBe("known");
});

test("kana matching does not reach across parts of speech or to another word", () => {
  const bank = [
    {
      lemma: "分かる",
      reading: "わかる",
      partOfSpeech: "verb" as const,
      scope: { kind: "allSenses" as const },
    },
  ];
  expect(
    classifyKnownVocabulary(inflected("わかる", "わかる", "noun"), bank)[0]?.status,
  ).toBe("unresolved");
  expect(
    classifyKnownVocabulary(inflected("わける", "わけ", "verb"), bank)[0]?.status,
  ).toBe("unresolved");
});

/**
 * Kuromoji tags a word by the job it is doing in the sentence, and a Card
 * records what the word is. Where those disagree systematically the learner
 * still has the word, and calling it unknown makes ordinary sentences
 * unwritable.
 */
const analyzed = async (japanese: string): Promise<AnalyzedText> => {
  const { createKuromojiAnalyzer } = await import("./kuromoji-analyzer.ts");
  const { loadKuromojiFromDirectory } = await import("./loaders.ts");
  const analyzer = createKuromojiAnalyzer(() =>
    loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
  );
  const result = await analyzer.analyze("known-vocabulary", japanese);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const statusOf = (
  text: AnalyzedText,
  surface: string,
  bank: Parameters<typeof classifyKnownVocabulary>[1],
): string | undefined =>
  classifyKnownVocabulary(text, bank).find((item) => item.token.surface === surface)
    ?.status;

const noun = (lemma: string, reading: string) => ({
  lemma,
  reading,
  partOfSpeech: "noun" as const,
  scope: { kind: "allSenses" as const },
});

test("a noun Card is the same word used as a な-adjective", async () => {
  // 失礼な lemmatizes 失礼だ and is tagged 形容動詞語幹, so an exact
  // part-of-speech comparison called a learned word new.
  const text = await analyzed("失礼なことを言いました。");
  expect(statusOf(text, "失礼", [noun("失礼", "しつれい")])).toBe("known");
});

test("a noun Card is the same word taking する", async () => {
  // びっくりし is one token, lemmatized びっくりする and tagged both
  // 名詞/サ変接続 and 動詞/自立. びっくり is used no other way.
  const text = await analyzed("私はびっくりしました。");
  expect(statusOf(text, "びっくりし", [noun("びっくり", "びっくり")])).toBe("known");
  const promised = await analyzed("男の子は約束しました。");
  expect(statusOf(promised, "約束し", [noun("約束", "やくそく")])).toBe("known");
});

test("an unrelated word is still unknown", async () => {
  const text = await analyzed("私はびっくりしました。");
  expect(statusOf(text, "びっくりし", [noun("約束", "やくそく")])).toBe("unresolved");
});
