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
import { createGeneratedMaterialValidator } from "./generated-validator.ts";
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
      error: { kind: "validationRejected", reasons: ["unknownVocabulary"] },
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
    ["bad span", { ...valid, targetSpan: { ...valid.targetSpan, start: -1 } }],
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
