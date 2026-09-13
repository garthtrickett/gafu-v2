import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, sequentialIds, testSeed } from "../../tests/support/study.ts";
import { err, ok } from "../result.ts";
import type { CardSummary } from "../study/contracts.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import type { GeneratedMaterial, MaterialProvider } from "./generated-contracts.ts";
import { openLearningMaterial } from "./learning-material.ts";
import { createDeterministicMaterialProvider } from "./scripted-provider.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

/**
 * Validation is scripted per Card: `refuseRounds` says how many rounds a
 * Card's review candidates are refused before they pass. Refusals name the
 * unknown word, as the real validator does. Teaching always passes.
 */
const harness = (refuseRounds: Record<string, number>) => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-retry-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  const clock = mutableClock("2026-09-12T09:00:00.000Z");
  const provider: MaterialProvider = createDeterministicMaterialProvider();
  const candidatesSeen = new Map<string, number>();
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
    validate: async ({ card, value, mode }) => {
      if (mode === "teach") return ok(value as GeneratedMaterial);
      // The deterministic provider offers three candidates per Card per
      // round, so the round is read off how many this Card has had.
      const seen = (candidatesSeen.get(card.id) ?? 0) + 1;
      candidatesSeen.set(card.id, seen);
      const round = Math.ceil(seen / 3);
      if (round <= (refuseRounds[card.content.meaning] ?? 0)) {
        return err({
          kind: "validationRejected",
          reasons: [`unknownVocabulary: 難語${round}`],
        });
      }
      return ok(value as GeneratedMaterial);
    },
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
  const make = (lemma: string, reading: string, meaning: string): CardSummary => {
    const created = study.value.createCard({
      type: "vocabulary",
      content: { lemma, reading, partOfSpeech: "noun", meaning, usageNotes: "" },
    });
    if (!created.ok) throw new Error(created.error.kind);
    return created.value.card;
  };
  const bird = make("鳥", "とり", "bird");
  const cat = make("猫", "ねこ", "cat");
  const queue = study.value.studyQueue();
  if (!queue.ok) throw new Error(queue.error.kind);
  const due = (id: string) => {
    const found = queue.value.due.find((item) => item.card.id === id);
    if (found === undefined) throw new Error("not due");
    return found.card;
  };
  const knowledge = study.value.knowledgeSnapshot();
  if (!knowledge.ok) throw new Error(knowledge.error.kind);
  return {
    material: material.value,
    provider,
    bird: due(bird.id),
    cat: due(cat.id),
    knowledge: knowledge.value,
  };
};

const teach = async (app: ReturnType<typeof harness>, card: CardSummary) => {
  const lemma = "lemma" in card.content ? card.content.lemma : "";
  const stored = await app.material.storeAuthoredTeaching({
    card,
    knowledge: app.knowledge,
    value: {
      mode: "teach",
      context: "c",
      prompt: "p",
      japanese: `${lemma}かな。`,
      targetSurface: lemma,
      targetSpan: {
        start: 0,
        end: 1,
        unit: "utf16-code-unit",
        normalization: "nfkc-v1",
      },
      readingSegments: [{ written: `${lemma}かな。`, reading: "x" }],
      answer: "a",
      explanation: "e",
      usageNote: "",
    },
  });
  if (!stored.ok) throw new Error(stored.error.kind);
  const taught = await app.material.prepare({ card, knowledge: app.knowledge });
  if (!taught.ok) throw new Error(taught.error.kind);
  const acknowledged = app.material.acknowledgeTeaching(card.id, taught.value.id);
  if (!acknowledged.ok) throw new Error("ack");
};

describe("whole-batch retry rounds", () => {
  test("a refused Card goes back into the next request with its reasons, and passes on round two", async () => {
    const app = harness({ cat: 1 });
    await teach(app, app.bird);
    await teach(app, app.cat);
    const begun = app.material.beginReviewBatch([
      { card: app.bird, knowledge: app.knowledge },
      { card: app.cat, knowledge: app.knowledge },
    ]);
    if (!begun.ok) throw new Error(begun.error.kind);

    // Round 1: dispatch, then complete. Bird passes; cat is refused and
    // stays pending for round 2 rather than failing.
    await app.material.advanceReviewBatch(begun.value);
    const afterRoundOne = await app.material.advanceReviewBatch(begun.value);
    expect(afterRoundOne).toMatchObject({
      ok: true,
      value: {
        done: false,
        pending: 1,
        completed: [app.bird.id],
        failed: [],
        round: 2,
      },
    });

    // Round 2 dispatches only the cat, carrying why round 1 was refused.
    await app.material.advanceReviewBatch(begun.value);
    const last = app.provider.inspectLastRequest();
    if (last === null) throw new Error("no batch request recorded");
    expect(last.endpoint).toBe("scripted://learning-material/batch");
    const targets = (
      last.body as { targets: { card: CardSummary; previousRejections: string[] }[] }
    ).targets;
    expect(targets.map((target) => target.card.id)).toEqual([app.cat.id]);
    expect(targets[0]?.previousRejections).toEqual(["unknownVocabulary: 難語1"]);

    const done = await app.material.advanceReviewBatch(begun.value);
    expect(done).toMatchObject({
      ok: true,
      value: {
        done: true,
        pending: 0,
        completed: [app.bird.id, app.cat.id],
        failed: [],
      },
    });
  });

  test("a Card refused in every round is dropped after the third with its reason", async () => {
    const app = harness({ cat: 99 });
    await teach(app, app.cat);
    const begun = app.material.beginReviewBatch([
      { card: app.cat, knowledge: app.knowledge },
    ]);
    if (!begun.ok) throw new Error(begun.error.kind);
    let progress = await app.material.advanceReviewBatch(begun.value);
    let advances = 1;
    while (progress.ok && !progress.value.done && advances < 12) {
      progress = await app.material.advanceReviewBatch(begun.value);
      advances += 1;
    }
    // Three rounds, each a dispatch and a completion: six advances.
    expect(advances).toBe(6);
    expect(progress).toMatchObject({
      ok: true,
      value: {
        done: true,
        completed: [],
        failed: [
          {
            cardId: app.cat.id,
            kind: "validationRejected",
            reasons: ["unknownVocabulary: 難語3"],
          },
        ],
      },
    });
  });
});
