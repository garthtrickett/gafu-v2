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
