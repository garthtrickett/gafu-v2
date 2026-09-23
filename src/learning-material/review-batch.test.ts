import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, sequentialIds, testSeed } from "../../tests/support/study.ts";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { err, ok } from "../result.ts";
import type { CardSummary } from "../study/contracts.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import { declaredGrammarDetector } from "./declared-grammar.ts";
import type { MaterialProvider } from "./generated-contracts.ts";
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

const backgroundForms = [
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
];

const harness = (provider: MaterialProvider) => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-batch-"));
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
    provider,
    keyCustody: createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "sk-test",
    ),
    validate: createGeneratedMaterialValidator({
      analyzer: createKuromojiAnalyzer(() =>
        loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
      ),
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
  return { material: material.value, study: study.value, databasePath, clock };
};

const createWord = (
  study: ReturnType<typeof harness>["study"],
  lemma: string,
  reading: string,
  meaning: string,
) => {
  const created = study.createCard({
    type: "vocabulary",
    content: { lemma, reading, partOfSpeech: "noun", meaning, usageNotes: "" },
  });
  if (!created.ok || created.value.outcome !== "created") throw new Error("create");
  return created.value.card;
};

const markBackgroundKnown = (study: ReturnType<typeof harness>["study"]) => {
  for (const canonicalForm of backgroundForms) {
    const background = study.createCard({
      type: "grammar",
      content: {
        canonicalForm,
        meaning: `background ${canonicalForm}`,
        formation: canonicalForm,
        usageNotes: "",
      },
    });
    if (!background.ok || background.value.outcome !== "created")
      throw new Error("background setup");
    const known = study.setCardState({
      cardId: background.value.card.id,
      action: "markSupportReady",
    });
    if (!known.ok) throw new Error("background known");
  }
};

const teachCard = async (
  app: ReturnType<typeof harness>,
  card: CardSummary,
): Promise<void> => {
  const knowledge = app.study.knowledgeSnapshot();
  if (!knowledge.ok) throw new Error(knowledge.error.kind);
  const authored = deterministicMaterialResult({
    mode: "teach",
    card,
    knowledge: knowledge.value,
    recentJapanese: [],
    candidateCount: 3,
  });
  if (!authored.ok || authored.value.candidates[0] === undefined)
    throw new Error("deterministic teach");
  const stored = await app.material.storeAuthoredTeaching({
    card,
    knowledge: knowledge.value,
    value: authored.value.candidates[0],
  });
  if (!stored.ok) throw new Error(`authored rejected: ${stored.error.kind}`);
  const taught = await app.material.prepare({ card, knowledge: knowledge.value });
  if (!taught.ok) throw new Error(`teach failed: ${taught.error.kind}`);
  const acknowledged = app.material.acknowledgeTeaching(card.id, taught.value.id);
  if (!acknowledged.ok) throw new Error("ack failed");
};

describe("review batch job", () => {
  test("dispatches one request for every card, completes together, and serves banked reviews without new calls", async () => {
    let calls = 0;
    const inner = createDeterministicMaterialProvider();
    const provider: MaterialProvider = {
      ...inner,
      generate: (async (request, signal) => {
        calls += 1;
        return inner.generate(request, signal);
      }) as MaterialProvider["generate"],
    };
    const app = harness(provider);
    const createdFirst = createWord(app.study, "鳥", "とり", "bird");
    const createdSecond = createWord(app.study, "猫", "ねこ", "cat");
    markBackgroundKnown(app.study);
    // Admission is what gives a Card its schedule phase; teach only applies
    // to admitted new Cards, so work with the queue Cards from here on.
    const admitted = app.study.studyQueue();
    if (!admitted.ok) throw new Error("queue");
    const dueCard = (id: string) => {
      const found = admitted.value.due.find((item) => item.card.id === id);
      if (found === undefined) throw new Error(`card not due: ${id}`);
      return found.card;
    };
    const first = dueCard(createdFirst.id);
    const second = dueCard(createdSecond.id);
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    await teachCard(app, first);
    await teachCard(app, second);

    const begun = app.material.beginReviewBatch([
      { card: first, knowledge: knowledge.value },
      { card: second, knowledge: knowledge.value },
    ]);
    if (!begun.ok) throw new Error(begun.error.kind);

    // The first advance dispatches the whole batch; nothing is ready yet.
    const one = await app.material.advanceReviewBatch(begun.value);
    expect(one).toMatchObject({
      ok: true,
      value: { done: false, pending: 2, requestInFlight: true },
    });
    expect(provider.inspectLastRequest()?.endpoint).toBe(
      "scripted://learning-material/batch",
    );
    // The second advance polls the finished job and banks both together.
    const two = await app.material.advanceReviewBatch(begun.value);
    expect(two).toMatchObject({
      ok: true,
      value: {
        done: true,
        pending: 0,
        completed: [first.id, second.id],
        failed: [],
        requestInFlight: false,
      },
    });
    // A third advance reports the finished batch instead of working.
    const three = await app.material.advanceReviewBatch(begun.value);
    expect(three).toMatchObject({ ok: true, value: { done: true } });

    // Work-through serves from the banked reserves with no new calls.
    const banked = calls;
    for (const card of [first, second]) {
      const prepared = await app.material.prepare({ card, knowledge: knowledge.value });
      expect(prepared).toMatchObject({ ok: true, value: { mode: "review" } });
    }
    expect(calls).toBe(banked);
    app.study.close();
    app.material.close();
  });

  test("reports stored Cards ready while one request generates the rest", async () => {
    const provider = createDeterministicMaterialProvider();
    const app = harness(provider);
    const firstCreated = createWord(app.study, "鳥", "とり", "bird");
    const secondCreated = createWord(app.study, "猫", "ねこ", "cat");
    markBackgroundKnown(app.study);
    const admitted = app.study.studyQueue();
    if (!admitted.ok) throw new Error("queue");
    const first = admitted.value.due.find(
      (item) => item.card.id === firstCreated.id,
    )?.card;
    const second = admitted.value.due.find(
      (item) => item.card.id === secondCreated.id,
    )?.card;
    if (first === undefined || second === undefined) throw new Error("cards not due");
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    await teachCard(app, first);
    await teachCard(app, second);
    const shown = await app.material.prepare({
      card: first,
      knowledge: knowledge.value,
    });
    if (!shown.ok) throw new Error(shown.error.kind);
    expect(app.material.hasReserve(first.id, "review")).toEqual({
      ok: true,
      value: true,
    });

    const begun = app.material.beginReviewBatch([
      { card: first, knowledge: knowledge.value },
      { card: second, knowledge: knowledge.value },
    ]);
    if (!begun.ok) throw new Error(begun.error.kind);
    const progress = await app.material.advanceReviewBatch(begun.value);
    expect(progress).toMatchObject({
      ok: true,
      value: { completed: [first.id], pending: 1, requestInFlight: true },
    });
    expect(provider.inspectLastRequest()).toMatchObject({
      endpoint: "scripted://learning-material/batch",
      body: { targets: [{ card: { id: second.id } }] },
    });
    app.study.close();
    app.material.close();
  });

  test("a wrong answer throws away the sentences banked while it was going well", async () => {
    // How much the sentence hands the target over is read from the Card's
    // run of right answers, and a wrong answer takes that run to zero. A
    // sentence banked at the plain level would then be served anyway, and
    // the Card would stay plain for as many rounds as there are reserves —
    // which is the whole run again. The unshown ones go; what the learner
    // has already seen stays, because the permits are issued against it.
    const app = harness(createDeterministicMaterialProvider());
    const created = createWord(app.study, "鳥", "とり", "bird");
    markBackgroundKnown(app.study);
    const admitted = app.study.studyQueue();
    if (!admitted.ok) throw new Error("queue");
    const card = admitted.value.due.find((item) => item.card.id === created.id)?.card;
    if (card === undefined) throw new Error("card not due");
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    await teachCard(app, card);

    const begun = app.material.beginReviewBatch([{ card, knowledge: knowledge.value }]);
    if (!begun.ok) throw new Error(begun.error.kind);
    await app.material.advanceReviewBatch(begun.value);
    await app.material.advanceReviewBatch(begun.value);
    const shown = await app.material.prepare({ card, knowledge: knowledge.value });
    if (!shown.ok) throw new Error(shown.error.kind);

    const rows = new Database(app.databasePath);
    const unshown = () =>
      (
        rows
          .query(`SELECT count(*) AS count FROM validated_presentation
            WHERE card_id = ? AND mode = 'review' AND shown_at IS NULL`)
          .get(card.id) as { count: number }
      ).count;
    const kept = () =>
      (
        rows
          .query(`SELECT count(*) AS count FROM validated_presentation
            WHERE card_id = ? AND shown_at IS NOT NULL`)
          .get(card.id) as { count: number }
      ).count;
    const before = unshown();
    expect(before).toBeGreaterThan(0);
    const alreadySeen = kept();

    expect(app.material.discardReserves(card.id)).toEqual({ ok: true, value: before });
    expect(unshown()).toBe(0);
    expect(kept()).toBe(alreadySeen);
    // Discarding twice is not an error; there is simply nothing left.
    expect(app.material.discardReserves(card.id)).toEqual({ ok: true, value: 0 });
    rows.close();
    app.study.close();
    app.material.close();
  });

  test("a card the provider never answers for is served as itself", async () => {
    const app = harness(
      createScriptedMaterialProvider([
        (request) =>
          request.card.id === ("bad-card" as CardSummary["id"])
            ? err({ kind: "timeout", detail: "provider timed out" })
            : deterministicMaterialResult(request),
      ]),
    );
    const createdFirst = createWord(app.study, "鳥", "とり", "bird");
    markBackgroundKnown(app.study);
    // Admission is what gives a Card its schedule phase; teach only applies
    // to admitted new Cards, so work with the queue Card from here on.
    const admitted = app.study.studyQueue();
    if (!admitted.ok) throw new Error("queue");
    const dueCard = (id: string) => {
      const found = admitted.value.due.find((item) => item.card.id === id);
      if (found === undefined) throw new Error(`card not due: ${id}`);
      return found.card;
    };
    const first = dueCard(createdFirst.id);
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    await teachCard(app, first);

    const bad = { ...first, id: "bad-card" as CardSummary["id"] };
    const begun = app.material.beginReviewBatch([
      { card: first, knowledge: knowledge.value },
      { card: bad, knowledge: knowledge.value },
    ]);
    if (!begun.ok) throw new Error(begun.error.kind);
    // The provider answers for one card only. The other is retried for two
    // more rounds and then, rather than being dropped, banked as itself —
    // the batch is what hands Cards to the session, so a Card it reports
    // only as failed is a Card the learner never sees.
    let done = await app.material.advanceReviewBatch(begun.value);
    let advances = 1;
    while (done.ok && !done.value.done && advances < 12) {
      done = await app.material.advanceReviewBatch(begun.value);
      advances += 1;
    }
    expect(advances).toBe(6);
    expect(done).toMatchObject({
      ok: true,
      value: {
        done: true,
        pending: 0,
        completed: [first.id, bad.id],
        failed: [],
      },
    });
    const served = await app.material.prepare({
      card: bad,
      knowledge: knowledge.value,
    });
    if (!served.ok) throw new Error(served.error.kind);
    expect(served.value.material.japanese).toBe("鳥");
    app.study.close();
    app.material.close();
  });

  test("a provider that cannot be reached fails the whole batch instead", async () => {
    // The fallback above is for a word no sentence can be written for. A
    // provider that is down is a different thing: every Card would be
    // banked as a bare word and the learner would lose a day of sentences
    // to an outage that ends in a minute. Those Cards stay due.
    const inner = createDeterministicMaterialProvider();
    const app = harness({
      ...inner,
      batch: {
        dispatch: async () => err({ kind: "offline", detail: "no network" }),
        poll: async () => err({ kind: "offline", detail: "no network" }),
      },
    } as MaterialProvider);
    const created = createWord(app.study, "鳥", "とり", "bird");
    markBackgroundKnown(app.study);
    const admitted = app.study.studyQueue();
    if (!admitted.ok) throw new Error("queue");
    const card = admitted.value.due.find((item) => item.card.id === created.id)?.card;
    if (card === undefined) throw new Error("card not due");
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    await teachCard(app, card);

    const begun = app.material.beginReviewBatch([{ card, knowledge: knowledge.value }]);
    if (!begun.ok) throw new Error(begun.error.kind);
    const done = await app.material.advanceReviewBatch(begun.value);
    expect(done).toMatchObject({
      ok: true,
      value: {
        done: true,
        completed: [],
        failed: [{ cardId: card.id, kind: "offline" }],
      },
    });
    expect(app.material.hasReserve(card.id, "review")).toEqual({
      ok: true,
      value: false,
    });
    app.study.close();
    app.material.close();
  });

  test("knowledge is stored once per batch, and finished batches are cleared after an hour", async () => {
    const app = harness(createDeterministicMaterialProvider());
    const createdFirst = createWord(app.study, "鳥", "とり", "bird");
    markBackgroundKnown(app.study);
    const admitted = app.study.studyQueue();
    if (!admitted.ok) throw new Error("queue");
    const first = admitted.value.due.find(
      (item) => item.card.id === createdFirst.id,
    )?.card;
    if (first === undefined) throw new Error("card not due");
    const knowledge = app.study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    await teachCard(app, first);

    const begun = app.material.beginReviewBatch([
      { card: first, knowledge: knowledge.value },
    ]);
    if (!begun.ok) throw new Error(begun.error.kind);
    const raw = new Database(app.databasePath);
    const item = raw
      .query("SELECT input_json FROM review_batch_item WHERE batch_id = ?")
      .get(begun.value) as { input_json: string };
    // The item carries its Card only; the knowledge lives on the batch row.
    expect(item.input_json.length).toBeLessThan(2_000);
    expect(JSON.parse(item.input_json)).not.toHaveProperty("knowledge");
    expect(
      raw
        .query("SELECT count(*) AS count FROM review_batch WHERE batch_id = ?")
        .get(begun.value),
    ).toEqual({ count: 1 });

    // Maintenance may clear finished batches at once, but not a pending one.
    expect(app.material.purgeFinishedBatches(0)).toEqual({ ok: true, value: 0 });
    // Work it to done, then an hour and more passes; the next batch clears it.
    let progress = await app.material.advanceReviewBatch(begun.value);
    for (
      let advances = 0;
      progress.ok && !progress.value.done && advances < 8;
      advances += 1
    ) {
      progress = await app.material.advanceReviewBatch(begun.value);
    }
    expect(progress).toMatchObject({
      ok: true,
      value: { done: true, completed: [first.id] },
    });
    app.clock.set(
      new Date(app.clock.now().getTime() + 2 * 60 * 60 * 1_000).toISOString(),
    );
    const next = app.material.beginReviewBatch([
      { card: first, knowledge: knowledge.value },
    ]);
    if (!next.ok) throw new Error(next.error.kind);
    expect(
      raw
        .query("SELECT count(*) AS count FROM review_batch_item WHERE batch_id = ?")
        .get(begun.value),
    ).toEqual({ count: 0 });
    expect(
      raw
        .query("SELECT count(*) AS count FROM review_batch WHERE batch_id = ?")
        .get(begun.value),
    ).toEqual({ count: 0 });
    expect(await app.material.advanceReviewBatch(begun.value)).toMatchObject({
      ok: false,
      error: { kind: "reviewBatchNotFound" },
    });
    raw.close();
    app.study.close();
    app.material.close();
  });

  test("a Card no sentence can be written for is served as the Card itself", async () => {
    // Some words cannot have an i+1 sentence yet — 頬袋 wants ハムスター,
    // which the learner has not met — and those Cards used to be admitted
    // and then refused every round for ever. The Card's own writing, reading
    // and meaning are banked instead, as an ordinary reserve, so the batch
    // and the session hand-over need no special case for it.
    let asked = 0;
    const refusing = {
      identity: { provider: "refusing", model: "-", promptVersion: "-" },
      inspectLastRequest: () => null,
      generate: async () => {
        asked += 1;
        return { ok: false as const, error: { kind: "noValidCandidate", detail: "" } };
      },
    } as unknown as MaterialProvider;
    const { material, study } = harness(refusing);
    const created = study.createCard({
      type: "vocabulary",
      content: {
        lemma: "頬袋",
        reading: "ほおぶくろ",
        partOfSpeech: "noun",
        meaning: "a cheek pouch",
        usageNotes: "",
      },
    });
    if (!created.ok) throw new Error("create");
    study.setPreferences({ newCardsPerDay: 5 });
    const queue = study.studyQueue();
    if (!queue.ok) throw new Error("queue");
    const due = queue.value.due.find((item) => item.card.id === created.value.card.id);
    if (due === undefined) throw new Error("not due");
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error("knowledge");

    // The provider is asked for a first exposure too, and refuses; the Card
    // itself is what the learner meets.
    const taught = await material.prepare({
      card: due.card,
      knowledge: knowledge.value,
    });
    if (!taught.ok) throw new Error(`teach: ${taught.error.kind}`);
    expect(asked).toBeGreaterThan(0);
    expect(taught.value.mode).toBe("teach");
    expect(taught.value.material.japanese).toBe("頬袋");
    const acknowledged = material.acknowledgeTeaching(due.card.id, taught.value.id);
    if (!acknowledged.ok) throw new Error("ack");

    // The review is where the provider is asked and cannot answer. The Card
    // is served all the same, with its own writing, reading and meaning.
    const served = await material.prepare({
      card: due.card,
      knowledge: knowledge.value,
    });
    if (!served.ok) throw new Error(`serve: ${served.error.kind}`);
    expect(asked).toBeGreaterThan(0);
    expect(served.value.mode).toBe("review");
    expect(served.value.material.japanese).toBe("頬袋");
    expect(served.value.material.targetKind).toBe("vocabulary");
    expect(served.value.material.target).toMatchObject({
      lemma: "頬袋",
      reading: "ほおぶくろ",
      meaning: "a cheek pouch",
    });
    expect(
      served.value.material.readingSegments.map((segment) => segment.written).join(""),
    ).toBe("頬袋");
  });

  test("an unknown batch id is not found", async () => {
    const app = harness(createDeterministicMaterialProvider());
    const missing = await app.material.advanceReviewBatch("no-such-batch");
    expect(missing).toMatchObject({
      ok: false,
      error: { kind: "reviewBatchNotFound" },
    });
    app.study.close();
    app.material.close();
  });
});
