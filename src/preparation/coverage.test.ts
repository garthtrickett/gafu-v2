import { describe, expect, test } from "bun:test";
import type { AnalyzedToken, JapaneseAnalyzer } from "../analysis/contracts.ts";
import { ok } from "../result.ts";
import type { KnownVocabulary } from "../study/contracts.ts";
import { bucketToken, createKnownLookup, measureCoverage } from "./coverage.ts";

const token = (
  surface: string,
  lemma: string,
  broadPartOfSpeech: string,
  partOfSpeech: readonly string[],
  reading: string | null = null,
): AnalyzedToken =>
  ({
    surface,
    lemma,
    reading,
    partOfSpeech,
    broadPartOfSpeech,
    conjugation: null,
    span: {
      start: 0,
      end: surface.length,
      unit: "utf16-code-unit",
      normalization: "nfkc-v1",
    },
    dictionaryFormFound: true,
    senseCandidates: [],
  }) as AnalyzedToken;

const word = (
  lemma: string,
  reading: string,
  partOfSpeech: string | null,
): KnownVocabulary =>
  ({
    key: `card:${lemma}`,
    baselineKey: null,
    lemma,
    reading,
    meaning: lemma,
    partOfSpeech,
    source: "baseline",
    senseIds: [],
  }) as KnownVocabulary;

/** Returns the tokens it was handed, keyed by cue text. */
const stubAnalyzer = (
  byText: Record<string, readonly AnalyzedToken[]>,
): JapaneseAnalyzer => ({
  name: "stub",
  analyze: async (cueId, rawText) =>
    ok({
      cueId,
      rawText,
      normalizedText: rawText,
      normalization: "nfkc-v1",
      spanUnit: "utf16-code-unit",
      rawBoundaryByNormalizedCodeUnit: [],
      tokens: byText[rawText] ?? [],
    }),
});

describe("which words cost a Card", () => {
  test("grammar, bound forms, suffixes, names, numbers and punctuation are free", () => {
    expect(bucketToken(token("を", "を", "particle", ["助詞"]))).toBe("grammar");
    expect(bucketToken(token("ん", "ん", "noun", ["名詞", "非自立", "一般"]))).toBe(
      "grammar",
    );
    expect(bucketToken(token("てる", "てる", "verb", ["動詞", "非自立"]))).toBe(
      "grammar",
    );
    expect(bucketToken(token("たち", "たち", "noun", ["名詞", "接尾", "一般"]))).toBe(
      "grammar",
    );
    expect(bucketToken(token("うん", "うん", "interjection", ["感動詞"]))).toBe("free");
    expect(bucketToken(token("1", "1", "noun", ["名詞", "数"]))).toBe("free");
    // Kuromoji labels a run of punctuation a sa-hen noun; it is not a word.
    expect(bucketToken(token("...", "...", "noun", ["名詞", "サ変接続"]))).toBe("free");
    expect(
      bucketToken(token("半田", "半田", "noun", ["名詞", "固有名詞", "人名"])),
    ).toBe("name");
    expect(bucketToken(token("動物", "動物", "noun", ["名詞", "一般"]))).toBe(
      "content",
    );
  });
});

describe("recognising a word already known", () => {
  const known = createKnownLookup([
    word("分かる", "わかる", "verb"),
    word("動物", "どうぶつ", "noun"),
  ]);

  test("matches the written form", () => {
    expect(known("分かる", "verb")).toBe(true);
    expect(known("動物", "noun")).toBe(true);
  });

  test("matches a kana spelling against the reading, because subtitles write it that way", () => {
    expect(known("わかる", "verb")).toBe(true);
  });

  test("does not match across parts of speech, or an unknown word", () => {
    expect(known("分かる", "noun")).toBe(false);
    expect(known("難語", "noun")).toBe(false);
    // Kanji that happens to equal another word's reading is not a match.
    expect(known("どうぶつ", "verb")).toBe(false);
  });
});

describe("measuring coverage", () => {
  const analyzer = stubAnalyzer({
    a: [
      token("動物", "動物", "noun", ["名詞", "一般"]),
      token("を", "を", "particle", ["助詞"]),
      token("かわいい", "かわいい", "adjective", ["形容詞", "自立"]),
      token("難語", "難語", "noun", ["名詞", "一般"]),
    ],
    b: [
      token("難語", "難語", "noun", ["名詞", "一般"]),
      token("を", "を", "particle", ["助詞"]),
      token("珍語", "珍語", "noun", ["名詞", "一般"]),
    ],
  });
  const vocabulary = [
    word("動物", "どうぶつ", "noun"),
    word("可愛い", "かわいい", "adjective"),
  ];

  test("counts running words, and the kana spelling of a known word counts as known", async () => {
    const report = await measureCoverage({
      analyzer,
      vocabulary,
      sources: [{ name: "one", cues: ["a"] }],
    });
    // 動物 known, を grammar, かわいい known through 可愛い, 難語 unknown.
    expect(report.runningWords).toBe(4);
    expect(report.knownWords).toBe(2);
    expect(report.grammarWords).toBe(1);
    expect(report.unknownWords).toBe(1);
    expect(report.coverage).toBeCloseTo(0.75, 5);
  });

  test("ranks unknown words by how often they are said, across files", async () => {
    const report = await measureCoverage({
      analyzer,
      vocabulary,
      sources: [
        { name: "one", cues: ["a"] },
        { name: "two", cues: ["b"] },
      ],
    });
    expect(report.words.map((item) => [item.lemma, item.count, item.sources])).toEqual([
      ["難語", 2, ["one", "two"]],
      ["珍語", 1, ["two"]],
    ]);
    expect(report.distinctUnknown).toBe(2);
    // 7 words, 4 already covered; the first word lifts it to 6 of 7.
    expect(report.coverage).toBeCloseTo(4 / 7, 5);
    expect(report.milestones.find((m) => m.coverage === 0.9)?.words).toBe(2);
  });

  test("reports each file on its own, so a single episode can be prepared", async () => {
    const report = await measureCoverage({
      analyzer,
      vocabulary,
      sources: [
        { name: "one", cues: ["a"] },
        { name: "two", cues: ["b"] },
      ],
    });
    expect(report.sources.map((item) => [item.name, item.runningWords])).toEqual([
      ["one", 4],
      ["two", 3],
    ]);
    expect(report.sources[0]?.coverage).toBeCloseTo(0.75, 5);
    // One file needs one word for 95%, the other needs both of its own.
    expect(report.sources[0]?.wordsForTarget).toBe(1);
    expect(report.sources[1]?.wordsForTarget).toBe(2);
  });

  test("nothing to measure is full coverage rather than a division by zero", async () => {
    const report = await measureCoverage({ analyzer, vocabulary, sources: [] });
    expect(report.coverage).toBe(1);
    expect(report.wordsForTarget).toBe(0);
    expect(report.words).toEqual([]);
  });
});
