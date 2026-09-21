import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, sequentialIds, testSeed } from "../../tests/support/study.ts";
import { ok } from "../result.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import type { GeneratedMaterial } from "./generated-contracts.ts";
import { openLearningMaterial } from "./learning-material.ts";
import { createDeterministicMaterialProvider } from "./scripted-provider.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const openMaterial = (databasePath: string, clock: ReturnType<typeof mutableClock>) => {
  const material = openLearningMaterial({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    nextToken: () => `token-${Math.random().toString(36).slice(2)}`,
    provider: createDeterministicMaterialProvider(),
    keyCustody: createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "sk-test",
    ),
    validate: async ({ value }) => ok(value as GeneratedMaterial),
    inspectionEnabled: false,
  });
  if (!material.ok) throw new Error(material.error.kind);
  return material.value;
};

test("a review permit survives a restart and expires after twelve hours", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-permit-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  const clock = mutableClock("2026-09-12T09:00:00.000Z");
  const material = openMaterial(databasePath, clock);
  const study = openStudy({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    permitVerifier: material.permitVerifier,
    knownWordSeed: testSeed,
    grammarTargetSupported: () => true,
  });
  if (!study.ok) throw new Error(study.error.kind);
  const created = study.value.createCard({
    type: "vocabulary",
    content: {
      lemma: "鳥",
      reading: "とり",
      partOfSpeech: "noun",
      meaning: "bird",
      usageNotes: "",
    },
  });
  if (!created.ok) throw new Error(created.error.kind);
  const queue = study.value.studyQueue();
  if (!queue.ok || queue.value.due[0] === undefined) throw new Error("no due card");
  const card = queue.value.due[0].card;
  const knowledge = study.value.knowledgeSnapshot();
  if (!knowledge.ok) throw new Error(knowledge.error.kind);
  const stored = await material.storeAuthoredTeaching({
    card,
    knowledge: knowledge.value,
    value: {
      mode: "teach",
      context: "c",
      prompt: "p",
      japanese: "鳥かな。",
      targetSurface: "鳥",
      targetSpan: {
        start: 0,
        end: 1,
        unit: "utf16-code-unit",
        normalization: "nfkc-v1",
      },
      readingSegments: [{ written: "鳥かな。", reading: "x" }],
      answer: "a",
      explanation: "e",
      usageNote: "",
    },
  });
  if (!stored.ok) throw new Error(stored.error.kind);
  const taught = await material.prepare({ card, knowledge: knowledge.value });
  if (!taught.ok) throw new Error(taught.error.kind);
  material.acknowledgeTeaching(card.id, taught.value.id);
  const review = await material.prepare({ card, knowledge: knowledge.value });
  if (!review.ok || review.value.permit === null) throw new Error("no permit");
  const permit = review.value.permit;

  // The process restarts; the permit is still good.
  study.value.close();
  material.close();
  const reopened = openMaterial(databasePath, clock);
  const verified = reopened.permitVerifier.verify(permit, clock.now());
  expect(verified.ok).toBe(true);
  if (verified.ok) expect(verified.value.cardId).toBe(card.id);

  // Eleven hours on it is still good; past twelve it is gone.
  clock.set("2026-09-12T20:00:00.000Z");
  expect(reopened.permitVerifier.verify(permit, clock.now()).ok).toBe(true);
  clock.set("2026-09-12T21:00:01.000Z");
  expect(reopened.permitVerifier.verify(permit, clock.now())).toMatchObject({
    ok: false,
    error: { kind: "presentationInvalid" },
  });
  reopened.close();
});
