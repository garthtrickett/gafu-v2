import { describe, expect, test } from "bun:test";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import {
  asCardId,
  type CardSummary,
  type KnowledgeSnapshot,
} from "../study/contracts.ts";
import { declaredGrammarDetector } from "./declared-grammar.ts";
import type {
  GeneratedMaterial,
  MaterialProviderRequest,
} from "./generated-contracts.ts";
import { parseBroadPartOfSpeech } from "./generated-decode.ts";
import {
  createGeneratedMaterialValidator,
  readsAsEnglish,
} from "./generated-validator.ts";
import { deterministicMaterialResult } from "./scripted-provider.ts";

const card: CardSummary = {
  id: asCardId("bird"),
  type: "vocabulary",
  content: {
    lemma: "鳥",
    reading: "とり",
    partOfSpeech: "noun",
    meaning: "bird",
    usageNotes: "",
  },
  state: "active",
  supportReadyAt: null,
  stagedAt: "2026-09-08T00:00:00.000Z",
  admittedAt: "2026-09-08T00:00:00.000Z",
  dueAt: "2026-09-08T00:00:00.000Z",
  schedulePhase: "new",
  reviewCount: 0,
  consecutiveFailures: 0,
};

const knowledge: KnowledgeSnapshot = {
  vocabulary: [],
  // The deterministic teach fixture ("鳥かな。") is only valid for a learner
  // who already knows か, な, and かな. Background knowledge is declared
  // explicitly so the growing detector cannot silently widen or narrow these
  // boundaries.
  grammar: [
    { cardId: asCardId("background-ka"), canonicalForm: "か" },
    { cardId: asCardId("background-na"), canonicalForm: "な" },
    { cardId: asCardId("background-kana"), canonicalForm: "かな" },
  ],
  baseline: {
    id: "none",
    version: null,
    availability: "unavailable",
    enabledCount: 0,
    entries: [],
  },
};

const request: MaterialProviderRequest = {
  mode: "teach",
  card,
  knowledge,
  recentJapanese: [],
  candidateCount: 3,
};

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);
const transparentPartOfSpeech = new Set<BroadPartOfSpeech>([
  "particle",
  "auxiliary",
  "copula",
  "symbol",
]);
const validate = createGeneratedMaterialValidator({
  analyzer,
  grammar: declaredGrammarDetector,
  senses: { resolve: () => [] },
  policy: { transparentPartOfSpeech },
});

test("provider part-of-speech decoding does not collapse adverbs into verbs", () => {
  expect(parseBroadPartOfSpeech("adverb")).toBe("adverb");
  expect(parseBroadPartOfSpeech("adverb (fukushi)")).toBe("adverb");
});
const generated = deterministicMaterialResult(request);
if (!generated.ok || generated.value.candidates[0] === undefined) {
  throw new Error("missing fixture");
}
const valid = generated.value.candidates[0] as GeneratedMaterial;

describe("generated material validation boundary", () => {
  test("accepts the valid local fixture", async () => {
    expect(
      await validate({ value: valid, mode: "teach", card, knowledge }),
    ).toMatchObject({ ok: true });
  });

  test("does not widen one known Card sense into every homograph sense", async () => {
    const senseAware = createGeneratedMaterialValidator({
      analyzer,
      grammar: declaredGrammarDetector,
      senses: {
        resolve: (token) => (token.lemma === "猫" ? ["dictionary:cat:figurative"] : []),
      },
      policy: { transparentPartOfSpeech },
    });
    const japanese = "鳥と猫かな。";
    const withHomograph = {
      ...valid,
      japanese,
      readingSegments: [{ written: japanese, reading: "" }],
    };
    expect(
      await senseAware({
        value: withHomograph,
        mode: "teach",
        card,
        knowledge: {
          ...knowledge,
          grammar: [
            { cardId: asCardId("background-ka"), canonicalForm: "か" },
            { cardId: asCardId("background-na"), canonicalForm: "な" },
            { cardId: asCardId("background-kana"), canonicalForm: "かな" },
            { cardId: asCardId("background-to"), canonicalForm: "と" },
          ],
          vocabulary: [
            {
              key: "card:cat",
              baselineKey: null,
              lemma: "猫",
              reading: "ねこ",
              partOfSpeech: "noun",
              meaning: "cat",
              source: "card",
              senseIds: ["dictionary:cat:animal"],
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "validationRejected",
        reasons: [expect.stringMatching(/^unknownVocabulary: /u)],
      },
    });
  });

  test.each([
    ["malformed", { japanese: 7 }],
    [
      "missing target",
      {
        ...valid,
        japanese: "かな。",
        readingSegments: [{ written: "かな。", reading: "" }],
      },
    ],
    [
      "a span that cannot be reconciled",
      {
        ...valid,
        japanese: "鳥と鳥かな。",
        readingSegments: [{ written: "鳥と鳥かな。", reading: "" }],
        targetSpan: { ...valid.targetSpan, start: -1 },
      },
    ],
    [
      "reconstruction",
      { ...valid, readingSegments: [{ written: "不一致", reading: "" }] },
    ],
    ["wrong metadata", { ...valid, target: { ...valid.target, meaning: "fish" } }],
    [
      "unknown vocabulary",
      {
        ...valid,
        japanese: "鳥と宇宙船かな。",
        readingSegments: [{ written: "鳥と宇宙船かな。", reading: "" }],
      },
    ],
    [
      "unknown grammar",
      {
        ...valid,
        japanese: "鳥かもしれない。",
        readingSegments: [{ written: "鳥かもしれない。", reading: "" }],
      },
    ],
  ] as const)("rejects %s before display", async (_name, value) => {
    expect(await validate({ value, mode: "teach", card, knowledge })).toMatchObject({
      ok: false,
    });
  });
});

describe("English fields read as English", () => {
  test("English with the target quoted passes; Japanese prose does not", () => {
    expect(readsAsEnglish("A clerk sorts papers, looking calm.")).toBe(true);
    expect(readsAsEnglish("順位 — ranking, order of preference")).toBe(true);
    expect(readsAsEnglish("係の人が、会場の隅で紙を整理している。")).toBe(false);
    expect(readsAsEnglish("「順位」は、上から何番目かという位置です。")).toBe(false);
    expect(readsAsEnglish("")).toBe(false);
  });
});

describe("an inflected target is still the target", () => {
  // The Card that found this: every generated review was refused because the
  // sentence conjugated the verb, which is what a sentence does with a verb.
  const verb: CardSummary = {
    ...card,
    id: asCardId("kikidasu"),
    content: {
      lemma: "聞き出す",
      reading: "ききだす",
      partOfSpeech: "verb",
      meaning: "to draw information out of someone",
      usageNotes: "",
    },
    schedulePhase: "review",
    reviewCount: 1,
    consecutiveFailures: 0,
  };
  const known = (
    lemma: string,
    reading: string,
  ): KnowledgeSnapshot["vocabulary"][number] => ({
    key: `baseline:${lemma}`,
    baselineKey: lemma,
    lemma,
    reading,
    partOfSpeech: "noun",
    meaning: lemma,
    source: "baseline",
    senseIds: [],
  });
  const verbKnowledge: KnowledgeSnapshot = {
    ...knowledge,
    vocabulary: [known("先生", "せんせい"), known("理由", "りゆう")],
    grammar: [
      { cardId: asCardId("background-wa"), canonicalForm: "は" },
      { cardId: asCardId("background-wo"), canonicalForm: "を" },
      { cardId: asCardId("background-ta-ru"), canonicalForm: "〜た (る)" },
      { cardId: asCardId("background-ta-u"), canonicalForm: "〜た (う)" },
      { cardId: asCardId("background-masu"), canonicalForm: "〜ます" },
    ],
  };
  const material = (japanese: string, surface: string): GeneratedMaterial => ({
    ...valid,
    mode: "review",
    targetKind: "vocabulary",
    target: {
      lemma: "聞き出す",
      reading: "ききだす",
      partOfSpeech: "verb",
      meaning: "to draw information out of someone",
    },
    japanese,
    targetSurface: surface,
    targetSpan: {
      ...valid.targetSpan,
      start: japanese.indexOf(surface),
      end: japanese.indexOf(surface) + surface.length,
    },
    readingSegments: [{ written: japanese, reading: "" }],
    answer: "The teacher drew the reason out of them.",
    explanation: "The marked verb means to draw information out of someone.",
    usageNote: "Used when someone gets information out of another person.",
  });

  test.each([
    ["the dictionary form", "先生は理由を聞き出す。", "聞き出す"],
    // The span may cover the word as it is written, inflection and all: the
    // tail is grammar, and it is checked as grammar.
    ["a whole inflected form", "先生は理由を聞き出した。", "聞き出した"],
    ["a whole polite form", "先生は理由を聞き出します。", "聞き出します"],
    // Or it may cover only the stem the analyzer calls the verb.
    ["an inflected stem", "先生は理由を聞き出した。", "聞き出し"],
  ] as const)("accepts %s", async (_name, japanese, surface) => {
    expect(
      await validate({
        value: material(japanese, surface),
        mode: "review",
        card: verb,
        knowledge: verbKnowledge,
      }),
    ).toMatchObject({ ok: true });
  });

  test("the target is never counted as a word the learner does not know", async () => {
    const refused = await validate({
      value: material("先生は理由を聞き出した。", "聞き出した"),
      mode: "review",
      card: verb,
      knowledge: { ...verbKnowledge, vocabulary: [] },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const reasons =
      refused.error.kind === "validationRejected" ? refused.error.reasons : [];
    expect(reasons.join(" ")).not.toContain("聞き出");
  });
});

describe("a reading has to explain its writing", () => {
  // The Card that found this: the model dropped the ず from 相変わらず and the
  // sentence still passed, so the learner was shown one ruby stretched over
  // the whole line, kana included, and the whole line coloured as the target.
  // What is caught is a reading contradicting the kana its writing shows; a
  // reading merely wrong over the kanji reads as well as a right one and
  // needs a dictionary, not this.
  test("a reading dropping a kana the writing shows is refused", async () => {
    const japanese = "鳥かな。";
    expect(
      await validate({
        value: {
          ...valid,
          readingSegments: [{ written: japanese, reading: "とり。" }],
        },
        mode: "teach",
        card,
        knowledge,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "validationRejected",
        reasons: [`readingUnplaceable: ${japanese}`],
      },
    });
  });

  test("a reading that places over the kanji is accepted", async () => {
    expect(
      await validate({
        value: {
          ...valid,
          readingSegments: [{ written: "鳥かな。", reading: "とりかな。" }],
        },
        mode: "teach",
        card,
        knowledge,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("a miscounted span is repaired from the sentence", () => {
  // The Cards that found this: eight in a row refused for a span that did
  // not land on the word it named, and the word then counted against its own
  // sentence as vocabulary the learner had never met.
  test("the target is found and the repaired span is what is banked", async () => {
    const japanese = "鳥かな。";
    const result = await validate({
      value: {
        ...valid,
        japanese,
        // One out: 鳥 is at 0, not 1.
        targetSpan: { ...valid.targetSpan, start: 1, end: 2 },
        readingSegments: [{ written: japanese, reading: "" }],
      },
      mode: "teach",
      card,
      knowledge,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.targetSpan).toMatchObject({ start: 0, end: 1 });
  });

  test("a surface the sentence says twice is refused, not guessed at", async () => {
    const japanese = "鳥と鳥かな。";
    const result = await validate({
      value: {
        ...valid,
        japanese,
        targetSpan: { ...valid.targetSpan, start: 4, end: 5 },
        readingSegments: [{ written: japanese, reading: "" }],
      },
      mode: "teach",
      card,
      knowledge,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const reasons =
      result.error.kind === "validationRejected" ? result.error.reasons : [];
    expect(reasons).toContain("targetSurfaceMismatch");
  });
});
