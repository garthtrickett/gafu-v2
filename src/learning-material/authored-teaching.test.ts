import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTeaching } from "../../scripts/authored-teaching.ts";
import { mutableClock, sequentialIds, testSeed } from "../../tests/support/study.ts";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { ok } from "../result.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import { declaredGrammarDetector } from "./declared-grammar.ts";
import { createGeneratedMaterialValidator } from "./generated-validator.ts";
import { openLearningMaterial } from "./learning-material.ts";
import { createScriptedMaterialProvider } from "./scripted-provider.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);

const harness = () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-authored-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  const clock = mutableClock("2026-09-08T09:00:00.000Z");
  const transparentPartOfSpeech = new Set<BroadPartOfSpeech>([
    "particle",
    "auxiliary",
    "copula",
    "symbol",
  ]);
  const material = openLearningMaterial({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    nextToken: sequentialIds(),
    // Empty: any call to generate throws, so a test that passes proves first
    // exposure never reached the provider.
    provider: createScriptedMaterialProvider([]),
    keyCustody: createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "sk-test",
    ),
    validate: createGeneratedMaterialValidator({
      analyzer,
      grammar: declaredGrammarDetector,
      senses: { resolve: () => [] },
      policy: { transparentPartOfSpeech },
    }),
    inspectionEnabled: false,
  });
  if (!material.ok) throw new Error(material.error.kind);
  const study = openStudy({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    permitVerifier: material.value.permitVerifier,
    knownWordSeed: testSeed,
    grammarTargetSupported: () => true,
  });
  if (!study.ok) throw new Error(study.error.kind);
  return { material: material.value, study: study.value };
};

const card = {
  type: "vocabulary" as const,
  content: {
    lemma: "\u5024\u6bb5",
    reading: "\u306d\u3060\u3093",
    partOfSpeech: "noun",
    meaning: "price",
    usageNotes:
      "Cue: 4\u5206\u306e1\u306e\u304a\u5024\u6bb5\u3067\u3044\u3044\u308f\u3088\u306d?",
  },
};

const sentence = "\u5024\u6bb5\u304c\u9ad8\u3044\u3002";

// What the sentence leans on besides the target. A teaching sentence may only
// use language the learner has, so the harness states exactly what that is.
const supporting = {
  vocabulary: [
    { lemma: "\u9ad8\u3044", reading: "\u305f\u304b\u3044", partOfSpeech: "adjective" },
  ],
  grammar: new Set(["\u304c"]),
};

describe("a Card taught from a sentence written when it was made", () => {
  test("first exposure comes from the authored sentence, not the provider", async () => {
    const { material, study } = harness();
    const created = study.createCard(card);
    if (!created.ok) throw new Error(created.error.kind);
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);

    const built = await buildTeaching(
      analyzer,
      { type: "vocabulary", ...card.content, example: sentence },
      supporting,
    );
    expect(built).not.toHaveProperty("reason");
    if ("reason" in built) throw new Error(built.reason);

    const stored = await material.storeAuthoredTeaching({
      card: created.value.card,
      knowledge: {
        vocabulary: supporting.vocabulary.map((word) => ({
          ...word,
          key: word.lemma,
          baselineKey: null,
          meaning: "",
          source: "baseline" as const,
          senseIds: [],
        })),
        grammar: [...supporting.grammar].map((canonicalForm) => ({
          canonicalForm,
          cardId: created.value.card.id,
        })),
        baseline: knowledge.value.baseline,
      },
      value: built.value,
    });
    expect(stored).toMatchObject({ ok: true });

    // A staged Card has no schedule phase, and teaching is only offered to a
    // new one, so admit it the way starting a session does.
    const queue = study.studyQueue();
    if (!queue.ok) throw new Error(queue.error.kind);
    const due = queue.value.due.find((item) => item.card.id === created.value.card.id);
    expect(due).toBeDefined();
    if (due === undefined) return;

    // The provider is empty, so reaching it would throw rather than answer.
    const prepared = await material.prepare({
      card: due.card,
      knowledge: knowledge.value,
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(prepared.value.material.mode).toBe("teach");
    expect(prepared.value.source).toBe("reserve");
    expect(prepared.value.material.japanese).toBe(sentence);
    expect(prepared.value.material.targetSurface).toBe("\u5024\u6bb5");
  });

  test("a る-verb target is not refused for its own morphology", async () => {
    // The potential-form patterns match the める tail of 詰める, which is a
    // plain る-verb. Counting that as supporting language the learner lacks
    // would make every る-verb Card unteachable from a plain-form sentence --
    // and plain form is the only form whose reading identifies the Card.
    const { material, study } = harness();
    const verb = {
      type: "vocabulary" as const,
      content: {
        lemma: "\u8a70\u3081\u308b",
        reading: "\u3064\u3081\u308b",
        partOfSpeech: "verb",
        meaning: "to pack",
        usageNotes: "",
      },
    };
    const created = study.createCard(verb);
    if (!created.ok) throw new Error(created.error.kind);
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);

    const built = await buildTeaching(
      analyzer,
      {
        type: "vocabulary",
        ...verb.content,
        example: "\u888b\u306b\u8a70\u3081\u308b\u3002",
      },
      {
        vocabulary: [
          { lemma: "\u888b", reading: "\u3075\u304f\u308d", partOfSpeech: "noun" },
        ],
        grammar: new Set(["\u306b"]),
      },
    );
    expect(built).not.toHaveProperty("reason");
    if ("reason" in built) throw new Error(built.reason);

    const stored = await material.storeAuthoredTeaching({
      card: created.value.card,
      knowledge: {
        vocabulary: [
          {
            key: "\u888b",
            baselineKey: null,
            lemma: "\u888b",
            reading: "\u3075\u304f\u308d",
            meaning: "",
            partOfSpeech: "noun",
            source: "baseline" as const,
            senseIds: [],
          },
        ],
        grammar: [{ canonicalForm: "\u306b", cardId: created.value.card.id }],
        baseline: knowledge.value.baseline,
      },
      value: built.value,
    });
    expect(stored).toMatchObject({ ok: true });
  });

  test("a sentence whose form reads differently is refused before it is stored", async () => {
    // token.reading is the reading of the surface, so \u8a70\u3081\u3066 reads \u3064\u3081 and does
    // not identify a Card whose reading is \u3064\u3081\u308b. Catching that here keeps it
    // out of the Card rather than failing validation on the server.
    const built = await buildTeaching(
      analyzer,
      {
        type: "vocabulary",
        lemma: "\u8a70\u3081\u308b",
        reading: "\u3064\u3081\u308b",
        partOfSpeech: "verb",
        meaning: "to pack",
        usageNotes: "",
        example: "\u888b\u306b\u8a70\u3081\u3066\u3044\u304f\u3002",
      },
      supporting,
    );
    expect(built).toHaveProperty("reason");
  });
});

describe("compound and copula-lemmatized targets", () => {
  test("a compound target tiles its tokens", async () => {
    const built = await buildTeaching(
      analyzer,
      {
        type: "vocabulary",
        lemma: "飼育員",
        reading: "しいくいん",
        partOfSpeech: "noun",
        meaning: "a zookeeper",
        usageNotes: "",
        example: "飼育員は多い。",
      },
      {
        vocabulary: [{ lemma: "多い", reading: "おおい", partOfSpeech: "adjective" }],
        grammar: new Set(["は"]),
      },
    );
    expect(built).not.toHaveProperty("reason");
    if ("reason" in built) throw new Error(built.reason);
    expect(built.value["targetSpan"]).toMatchObject({ start: 0, end: 3 });
  });

  test("a な-adjective stem meets its だ-lemmatized token", async () => {
    const built = await buildTeaching(
      analyzer,
      {
        type: "vocabulary",
        lemma: "肝心",
        reading: "かんじん",
        partOfSpeech: "adjective",
        meaning: "the crucial thing",
        usageNotes: "",
        example: "これは肝心だ。",
      },
      {
        vocabulary: [{ lemma: "これ", reading: "これ", partOfSpeech: "noun" }],
        grammar: new Set(["は", "だ", "これ"]),
      },
    );
    expect(built).not.toHaveProperty("reason");
    if ("reason" in built) throw new Error(built.reason);
    expect(built.value["targetSpan"]).toMatchObject({ start: 3, end: 5 });
  });
});
