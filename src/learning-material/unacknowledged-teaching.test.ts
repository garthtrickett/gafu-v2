import { afterEach, describe, expect, test } from "bun:test";
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

const harness = () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-teach-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  const clock = mutableClock("2026-09-12T09:00:00.000Z");
  const material = openLearningMaterial({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    nextToken: sequentialIds(),
    provider: createDeterministicMaterialProvider(),
    keyCustody: createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "sk-test",
    ),
    validate: async ({ value }) => ok(value as GeneratedMaterial),
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
  const knowledge = study.value.knowledgeSnapshot();
  if (!knowledge.ok) throw new Error(knowledge.error.kind);
  return {
    material: material.value,
    card: queue.value.due[0].card,
    knowledge: knowledge.value,
    teaching: {
      mode: "teach",
      context: "鳥 in use.",
      prompt: "鳥 (とり) — bird.",
      japanese: "鳥かな。",
      targetSurface: "鳥",
      targetSpan: {
        start: 0,
        end: 1,
        unit: "utf16-code-unit",
        normalization: "nfkc-v1",
      },
      readingSegments: [{ written: "鳥かな。", reading: "とりかな。" }],
      answer: "鳥（とり）— bird",
      explanation: "bird",
      usageNote: "",
    },
  };
};

describe("teaching stays servable until it is seen", () => {
  test("a shown but unacknowledged teach presentation is served again", async () => {
    const app = harness();
    expect(app.material.canTeach(app.card.id)).toEqual({ ok: true, value: false });
    const stored = await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    if (!stored.ok) throw new Error(stored.error.kind);
    expect(app.material.canTeach(app.card.id)).toEqual({ ok: true, value: true });

    const first = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!first.ok) throw new Error(first.error.kind);
    expect(first.value.mode).toBe("teach");
    // The tab closed here: no Seen it. The unshown reserve is empty now.
    expect(app.material.hasReserve(app.card.id, "teach")).toEqual({
      ok: true,
      value: false,
    });
    expect(app.material.canTeach(app.card.id)).toEqual({ ok: true, value: true });

    const again = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!again.ok) throw new Error(again.error.kind);
    expect(again.value.mode).toBe("teach");
    expect(again.value.id).toBe(first.value.id);
    expect(again.value.permit).toBeNull();

    // Seen it on the re-served presentation is accepted, and the Card moves on.
    const acknowledged = app.material.acknowledgeTeaching(app.card.id, again.value.id);
    expect(acknowledged.ok).toBe(true);
    const review = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!review.ok) throw new Error(review.error.kind);
    expect(review.value.mode).toBe("review");
  });

  test("a Card with no teach presentation at all still fails fast", async () => {
    const app = harness();
    const failed = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    expect(failed).toMatchObject({ ok: false, error: { kind: "teachingNotPrepared" } });
  });
});
