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
