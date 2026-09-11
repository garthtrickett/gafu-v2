import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, sequentialIds, testSeed } from "../../tests/support/study.ts";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { err, ok } from "../result.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import { declaredGrammarDetector } from "./declared-grammar.ts";
import { createGeneratedMaterialValidator } from "./generated-validator.ts";
import { openLearningMaterial } from "./learning-material.ts";
import {
  createDeterministicMaterialProvider,
  createScriptedMaterialProvider,
  deterministicMaterialResult,
} from "./scripted-provider.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const validation = () => {
  const analyzer = createKuromojiAnalyzer(() =>
    loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
  );
  const transparentPartOfSpeech = new Set<BroadPartOfSpeech>([
    "particle",
    "auxiliary",
    "copula",
    "symbol",
  ]);
  return createGeneratedMaterialValidator({
    analyzer,
    grammar: declaredGrammarDetector,
    senses: { resolve: () => [] },
    policy: { transparentPartOfSpeech },
  });
};

const harness = (provider = createDeterministicMaterialProvider()) => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-phase2-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  const clock = mutableClock("2026-09-08T09:00:00.000Z");
  // The key is a deployment value: it arrives with the process, not through a
  // route, so the harness supplies it the way the server environment does.
  const keyCustody = createProviderKeyCustody(
    { verify: async () => ok(undefined) },
    "sk-test",
  );
  const material = openLearningMaterial({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    nextToken: sequentialIds(),
    provider,
    keyCustody,
    validate: validation(),
    inspectionEnabled: true,
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
  return {
    databasePath,
    clock,
    keyCustody,
    material: material.value,
    study: study.value,
  };
};

describe("Phase 2 generated study lifecycle", () => {
  test("teaches, reviews once, varies, and retains an outage reserve", async () => {
    const app = harness();
    const created = app.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "鳥",
        reading: "とり",
        partOfSpeech: "noun",
        meaning: "bird",
        usageNotes: "A general word for a bird.",
      },
    });
    if (!created.ok) throw new Error(created.error.kind);
    const queue = app.study.studyQueue();
    if (!queue.ok || queue.value.due[0] === undefined) throw new Error("missing queue");
    // The deterministic provider's sentences use background particles the
    // learner is expected to know. Declare them after the queue is computed so
    // due[0] stays the 鳥 card while knowledge reflects a real learner.
    for (const canonicalForm of [
      "か",
      "な",
      "かな",
      "で",
      "も",
      "だ",
      "よ",
      "ね",
      "〜て",
      "って",
      "だけ",
      "でも",
      "〜ても・〜でも",
      "だって / んだって",
    ]) {
      const background = app.study.createCard({
        type: "grammar",
        content: {
          canonicalForm,
          meaning: `background ${canonicalForm}`,
          formation: canonicalForm,
          usageNotes: "",
        },
      });
      if (!background.ok || background.value.outcome !== "created")
        throw new Error(`background ${canonicalForm} setup`);
      const known = app.study.setCardState({
        cardId: background.value.card.id,
        action: "markKnown",
      });
      if (!known.ok) throw new Error(`background ${canonicalForm} known`);
    }
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);

    // First exposure shows only what was stored when the Card was made. The
    // deterministic teach fixture is stored the way the cards CLI stores it.
    const authored = deterministicMaterialResult({
      mode: "teach",
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
      recentJapanese: [],
      candidateCount: 3,
    });
    if (!authored.ok || authored.value.candidates[0] === undefined)
      throw new Error("deterministic teach");
    const stored = await app.material.storeAuthoredTeaching({
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
      value: authored.value.candidates[0],
    });
    if (!stored.ok) throw new Error(`authored teach rejected: ${stored.error.kind}`);

    const taught = await app.material.prepare({
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
    });
    expect(taught.ok).toBe(true);
    if (!taught.ok) return;
    expect(taught.value.mode).toBe("teach");
    expect(taught.value.permit).toBeNull();
    expect(
      app.material.acknowledgeTeaching(created.value.card.id, taught.value.id).ok,
    ).toBe(true);

    const recalled = await app.material.prepare({
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
    });
    expect(recalled.ok).toBe(true);
    if (!recalled.ok || recalled.value.permit === null) return;
    const concurrent = await app.material.prepare({
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
    });
    expect(concurrent.ok).toBe(true);
    expect(recalled.value.material.japanese).not.toBe(taught.value.material.japanese);
    expect(
      app.material.permitVerifier.verify(recalled.value.permit, app.clock.now()),
    ).toMatchObject({
      ok: true,
      value: { presentationId: recalled.value.id, cardId: created.value.card.id },
    });
    const answered = app.study.answer({
      cardId: created.value.card.id,
      grade: "good",
      permit: recalled.value.permit,
    });
    expect(answered.ok).toBe(true);
    expect(
      app.study.answer({
        cardId: created.value.card.id,
        grade: "good",
        permit: recalled.value.permit,
      }),
    ).toMatchObject({ ok: false, error: { kind: "presentationAlreadyUsed" } });
    if (concurrent.ok && concurrent.value.permit !== null) {
      expect(
        app.study.answer({
          cardId: created.value.card.id,
          grade: "good",
          permit: concurrent.value.permit,
        }),
      ).toMatchObject({ ok: false, error: { kind: "cardNotAnswerable" } });
    }
    if (!answered.ok) return;

    app.clock.set(
      new Date(new Date(answered.value.nextDueAt).getTime() + 1).toISOString(),
    );
    const backup = app.study.exportBackup();
    expect(backup.ok).toBe(true);
    if (backup.ok)
      expect(new TextDecoder().decode(backup.value.bytes)).not.toContain("sk-test");
    app.study.close();
    app.material.close();

    const restartedCustody = createProviderKeyCustody({
      verify: async () => ok(undefined),
    });
    const restartedMaterial = openLearningMaterial({
      databasePath: app.databasePath,
      clock: app.clock.now,
      nextId: sequentialIds(),
      nextToken: sequentialIds(),
      provider: createScriptedMaterialProvider([
        err({ kind: "timeout", detail: "provider timed out" }),
      ]),
      keyCustody: restartedCustody,
      validate: validation(),
      inspectionEnabled: false,
    });
    if (!restartedMaterial.ok) throw new Error(restartedMaterial.error.kind);
    const restartedStudy = openStudy({
      databasePath: app.databasePath,
      clock: app.clock.now,
      nextId: sequentialIds(),
      permitVerifier: restartedMaterial.value.permitVerifier,
      knownWordSeed: testSeed,
      grammarTargetSupported: () => true,
    });
    if (!restartedStudy.ok) throw new Error(restartedStudy.error.kind);
    const nextQueue = restartedStudy.value.studyQueue();
    if (!nextQueue.ok || nextQueue.value.due[0] === undefined)
      throw new Error("missing next queue");
    const restartedKnowledge = restartedStudy.value.knowledgeSnapshot();
    if (!restartedKnowledge.ok) throw new Error(restartedKnowledge.error.kind);
    const reserve = await restartedMaterial.value.prepare({
      card: nextQueue.value.due[0].card,
      knowledge: restartedKnowledge.value,
    });
    expect(reserve).toMatchObject({
      ok: true,
      value: { source: "reserve", mode: "review" },
    });
    if (reserve.ok)
      expect(reserve.value.material.japanese).not.toBe(
        recalled.value.material.japanese,
      );

    restartedStudy.value.close();
    restartedMaterial.value.close();
  });

  test("supports declared Grammar Cards and never permits invalid output", async () => {
    const app = harness();
    const grammar = app.study.createCard({
      type: "grammar",
      content: {
        canonicalForm: "〜かもしれない",
        meaning: "might; perhaps",
        formation: "plain form + かもしれない",
        usageNotes: "Expresses uncertainty.",
      },
    });
    if (!grammar.ok) throw new Error(grammar.error.kind);
    // The deterministic かもしれない sentence ends in かな, contains も,
    // ない, and もし, and also fires the verbatim twin かもしれない
    // alongside the 〜-prefixed target. Alias unification (knowing either
    // twin satisfies both) is recorded as follow-up; until then both must
    // be known.
    for (const canonicalForm of [
      "か",
      "な",
      "かな",
      "も",
      "もし",
      "かもしれない",
      "〜ない (る-Verb Negative)",
      "〜ない (う-Verb Negative)",
    ]) {
      const background = app.study.createCard({
        type: "grammar",
        content: {
          canonicalForm,
          meaning: `background ${canonicalForm}`,
          formation: canonicalForm,
          usageNotes: "",
        },
      });
      if (!background.ok || background.value.outcome !== "created")
        throw new Error(`background ${canonicalForm} setup`);
      const backgroundKnown = app.study.setCardState({
        cardId: background.value.card.id,
        action: "markKnown",
      });
      if (!backgroundKnown.ok) throw new Error(`background ${canonicalForm} known`);
    }
    const queue = app.study.studyQueue();
    const knowledge = app.study.knowledgeSnapshot();
    if (!queue.ok || queue.value.due[0] === undefined || !knowledge.ok)
      throw new Error("setup");
    const authoredGrammar = deterministicMaterialResult({
      mode: "teach",
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
      recentJapanese: [],
      candidateCount: 3,
    });
    if (!authoredGrammar.ok || authoredGrammar.value.candidates[0] === undefined)
      throw new Error("deterministic grammar teach");
    const storedGrammar = await app.material.storeAuthoredTeaching({
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
      value: authoredGrammar.value.candidates[0],
    });
    if (!storedGrammar.ok)
      throw new Error(`authored grammar teach rejected: ${storedGrammar.error.kind}`);
    const prepared = await app.material.prepare({
      card: queue.value.due[0].card,
      knowledge: knowledge.value,
    });
    expect(prepared).toMatchObject({ ok: true, value: { mode: "teach" } });
    app.study.close();
    app.material.close();
  });

  test("a new Card without stored teaching fails without calling the provider", async () => {
    // An empty script answers every provider call with an offline error and
    // records it. A null last request proves Study never asked.
    const provider = createScriptedMaterialProvider([]);
    const app = harness(provider);
    const card = app.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "鳥",
        reading: "とり",
        partOfSpeech: "noun",
        meaning: "bird",
        usageNotes: "",
      },
    });
    if (!card.ok) throw new Error(card.error.kind);
    const invalidQueue = app.study.studyQueue();
    const invalidKnowledge = app.study.knowledgeSnapshot();
    if (
      !invalidQueue.ok ||
      invalidQueue.value.due[0] === undefined ||
      !invalidKnowledge.ok
    )
      throw new Error("setup");
    const failed = await app.material.prepare({
      card: invalidQueue.value.due[0].card,
      knowledge: invalidKnowledge.value,
    });
    expect(failed).toMatchObject({ ok: false, error: { kind: "teachingNotPrepared" } });
    expect(provider.inspectLastRequest()).toBeNull();
    expect(app.study.listCards()).toMatchObject({
      ok: true,
      value: [{ reviewCount: 0 }],
    });
    app.study.close();
    app.material.close();
  });
});
