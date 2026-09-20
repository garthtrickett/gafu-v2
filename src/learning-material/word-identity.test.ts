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
import type { GeneratedMaterial } from "./generated-contracts.ts";
import { createGeneratedMaterialValidator } from "./generated-validator.ts";

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);
const validate = createGeneratedMaterialValidator({
  analyzer,
  grammar: declaredGrammarDetector,
  senses: { resolve: () => [] },
  policy: {
    transparentPartOfSpeech: new Set<BroadPartOfSpeech>([
      "particle",
      "auxiliary",
      "copula",
      "symbol",
    ]),
  },
});

const vocabularyCard = (
  lemma: string,
  reading: string,
  partOfSpeech: string,
  meaning: string,
): CardSummary => ({
  id: asCardId(lemma),
  type: "vocabulary",
  content: { lemma, reading, partOfSpeech, meaning, usageNotes: "" },
  state: "active",
  supportReadyAt: null,
  stagedAt: "2026-09-08T00:00:00.000Z",
  admittedAt: "2026-09-08T00:00:00.000Z",
  dueAt: "2026-09-08T00:00:00.000Z",
  schedulePhase: "new",
  reviewCount: 0,
  consecutiveFailures: 0,
  stage: "sentence",
  consecutiveCorrect: 0,
});

const grammarCard = (canonicalForm: string): CardSummary => ({
  ...vocabularyCard(canonicalForm, "", "noun", ""),
  type: "grammar",
  content: {
    canonicalForm,
    meaning: "not in the least",
    formation: "Formation unavailable in V1 snapshot.",
    usageNotes: "",
  },
});

/** A learner who knows the listed words outright and the listed patterns. */
const knowing = (
  vocabulary: readonly {
    lemma: string;
    reading: string;
    partOfSpeech: string;
    source?: "card" | "baseline";
    senseIds?: readonly string[];
  }[],
  grammar: readonly string[] = [],
): KnowledgeSnapshot => ({
  vocabulary: vocabulary.map((word) => ({
    key: `${word.source ?? "baseline"}:${word.lemma}`,
    baselineKey: null,
    lemma: word.lemma,
    reading: word.reading,
    partOfSpeech: word.partOfSpeech,
    meaning: word.lemma,
    source: word.source ?? "baseline",
    senseIds: word.senseIds ?? [],
  })),
  grammar: grammar.map((canonicalForm) => ({
    cardId: asCardId(canonicalForm),
    canonicalForm,
  })),
  baseline: {
    id: "test",
    version: null,
    availability: "unavailable",
    enabledCount: 0,
    entries: [],
  },
});

/**
 * The particles and inflections these sentences lean on. Declared outright
 * so a detector that grows cannot quietly widen what these tests prove.
 */
const BACKGROUND = [
  "は",
  "を",
  "に",
  "と",
  "な",
  "し",
  "こと",
  "で",
  "〜て",
  "〜た (る)",
  "〜た (う)",
];

const material = (
  japanese: string,
  targetSurface: string,
  card: CardSummary,
): GeneratedMaterial => {
  const start = japanese.indexOf(targetSurface);
  const content = card.content as Record<string, string>;
  return {
    mode: "teach",
    context: "Someone is responding naturally in a simple everyday situation.",
    prompt: "Study the highlighted target.",
    japanese,
    targetSurface,
    targetSpan: {
      start,
      end: start + targetSurface.length,
      unit: "utf16-code-unit",
      normalization: "nfkc-v1",
    },
    readingSegments: [{ written: japanese, reading: "" }],
    answer: content["meaning"] ?? "",
    explanation: content["meaning"] ?? "",
    usageNote: "Use it in an appropriate everyday context.",
    ...(card.type === "grammar"
      ? {
          targetKind: "grammar" as const,
          target: {
            canonicalForm: content["canonicalForm"] ?? "",
            meaning: content["meaning"] ?? "",
            formationHint: content["formation"] ?? "",
          },
        }
      : {
          targetKind: "vocabulary" as const,
          target: {
            lemma: content["lemma"] ?? "",
            reading: content["reading"] ?? "",
            partOfSpeech: content["partOfSpeech"] ?? "",
            meaning: content["meaning"] ?? "",
          },
        }),
  } as GeneratedMaterial;
};

describe("a word is the word however the sentence uses it", () => {
  test("a Card claiming no dictionary sense is still known", async () => {
    // Cards made by hand or imported without a dictionary identity carry no
    // sense ids. Mapping over that empty list dropped them from the bank
    // altogether, so a word the learner had earned came back as unknown —
    // 122 of this learner's 1,531 words, silently.
    const card = vocabularyCard("頬袋", "ほおぶくろ", "noun", "a cheek pouch");
    const knowledge = knowing(
      [
        { lemma: "豆", reading: "まめ", partOfSpeech: "noun", source: "card" },
        { lemma: "入れる", reading: "いれる", partOfSpeech: "verb", source: "card" },
      ],
      BACKGROUND,
    );
    expect(
      await validate({
        value: material("豆を頬袋に入れました。", "頬袋", card),
        mode: "teach",
        card,
        knowledge,
      }),
    ).toMatchObject({ ok: true });
  });

  test("a noun target may be used as a な-adjective", async () => {
    // 失礼 is a noun on the Card and 形容動詞語幹 in 失礼な, lemmatized
    // 失礼だ. Refusing that leaves the commonest use of the word unwritable.
    const card = vocabularyCard("失礼", "しつれい", "noun", "discourtesy");
    const knowledge = knowing(
      [
        { lemma: "言う", reading: "いう", partOfSpeech: "verb" },
        { lemma: "事", reading: "こと", partOfSpeech: "noun" },
      ],
      BACKGROUND,
    );
    expect(
      await validate({
        value: material("失礼なことを言いました。", "失礼", card),
        mode: "teach",
        card,
        knowledge,
      }),
    ).toMatchObject({ ok: true });
  });

  test("a noun target may take する", async () => {
    // びっくりし is one token, lemmatized びっくりする. びっくり is used no
    // other way, so refusing it refuses the word.
    const card = vocabularyCard("びっくり", "びっくり", "noun", "to be surprised");
    const knowledge = knowing(
      [{ lemma: "私", reading: "わたし", partOfSpeech: "noun" }],
      BACKGROUND,
    );
    expect(
      await validate({
        value: material("私はびっくりしました。", "びっくり", card),
        mode: "teach",
        card,
        knowledge,
      }),
    ).toMatchObject({ ok: true });
  });

  test("a な-adjective Card matches whether or not it writes the copula", async () => {
    // Kuromoji lemmatizes 真剣 in 真剣な as 真剣だ, and the token side has
    // always been stripped to meet a Card claiming the bare stem. Cards
    // claim it both ways — the CEJC import writes 真剣, a Kaishi entry
    // staged from "I don't know this word" writes 真剣だ — so stripping only
    // the token refused the second kind for not containing its own word.
    const knowledge = knowing(
      [{ lemma: "顔", reading: "かお", partOfSpeech: "noun" }],
      BACKGROUND,
    );
    for (const lemma of ["真剣だ", "真剣"]) {
      const card = vocabularyCard(lemma, "しんけん", "adjective", "serious");
      expect(
        await validate({
          value: material("真剣な顔です。", "真剣", card),
          mode: "teach",
          card,
          knowledge,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  test("a construction is the same construction inflected", async () => {
    // The declared patterns match citation forms: /にする/ finds にする and
    // not にします, /てしまう/ finds てしまう and not てしまいました. Asking a
    // sentence to carry the citation form asks it to be unnatural — お茶に
    // します is what a person says — and にする had never once produced a
    // valid sentence in this learner's whole history.
    const knowledge = knowing(
      [
        { lemma: "お茶", reading: "おちゃ", partOfSpeech: "noun" },
        { lemma: "魚", reading: "さかな", partOfSpeech: "noun" },
        { lemma: "食べる", reading: "たべる", partOfSpeech: "verb" },
      ],
      [...BACKGROUND, "にする", "てしまう / ちゃう", "〜ます"],
    );
    for (const [form, japanese, surface] of [
      ["にする", "お茶にします。", "にします"],
      ["てしまう / ちゃう", "魚を食べてしまいました。", "てしまいました"],
    ] as const) {
      const card = grammarCard(form);
      expect(
        await validate({
          value: material(japanese, surface, card),
          mode: "teach",
          card,
          knowledge,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  test("a canonical form written with either tilde is the same pattern", async () => {
    // The Card says すこしも~ない (U+007E, from the V1 import); the declared
    // pattern says すこしも～ない (U+FF5E). Compared verbatim the Card could
    // never match the construction it is entirely made of.
    const card = grammarCard("すこしも~ない");
    const knowledge = knowing(
      [{ lemma: "食べる", reading: "たべる", partOfSpeech: "verb" }],
      BACKGROUND,
    );
    expect(
      await validate({
        value: material("すこしも食べない。", "すこしも食べない", card),
        mode: "teach",
        card,
        knowledge,
      }),
    ).toMatchObject({ ok: true });
  });
});
