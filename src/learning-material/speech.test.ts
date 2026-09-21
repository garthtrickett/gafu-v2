import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, sequentialIds, testSeed } from "../../tests/support/study.ts";
import { err, ok } from "../result.ts";
import type { CardSummary } from "../study/contracts.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import type { GeneratedMaterial } from "./generated-contracts.ts";
import { openLearningMaterial } from "./learning-material.ts";
import { createDeterministicMaterialProvider } from "./scripted-provider.ts";
import {
  createScriptedSpeechProvider,
  type ScriptedSpeechStep,
  silentWav,
} from "./scripted-speech-provider.ts";
import type { SpeechProvider } from "./speech-contracts.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const clip = ok({ contentType: "audio/wav" as const, bytes: silentWav(100) });

/**
 * Validation is stubbed to pass material through: these tests are about what
 * happens around a banked sentence, not about the validator.
 */
const harness = (speech: SpeechProvider | undefined, speechDailyLimit?: number) => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-speech-"));
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
    speech,
    ...(speechDailyLimit === undefined ? {} : { speechDailyLimit }),
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
  const card: CardSummary = queue.value.due[0].card;
  const teaching = {
    mode: "teach",
    context: "鳥 in use.",
    prompt: "鳥 (とり) — bird.",
    japanese: "鳥かな。",
    targetSurface: "鳥",
    targetSpan: { start: 0, end: 1, unit: "utf16-code-unit", normalization: "nfkc-v1" },
    readingSegments: [{ written: "鳥かな。", reading: "とりかな。" }],
    answer: "鳥（とり）— bird",
    explanation: "bird",
    usageNote: "",
  };
  return {
    material: material.value,
    card,
    knowledge: knowledge.value,
    teaching,
    databasePath,
    clock,
  };
};

const scripted = (steps: readonly ScriptedSpeechStep[]) => {
  const spoken: string[] = [];
  return {
    provider: createScriptedSpeechProvider(steps, (text) => spoken.push(text)),
    spoken,
  };
};

describe("spoken sentences", () => {
  test("an authored teach sentence is spoken on first serve and the clip is stored once", async () => {
    const { provider, spoken } = scripted([clip]);
    const app = harness(provider);
    const stored = await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    expect(stored.ok).toBe(true);
    const prepared = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!prepared.ok) throw new Error(prepared.error.kind);
    expect(prepared.value.mode).toBe("teach");
    expect(prepared.value.audioUrl).toBe(
      `/api/study/presentations/${encodeURIComponent(prepared.value.id)}/audio`,
    );
    expect(spoken).toEqual(["鳥かな。"]);
    const audio = app.material.presentationAudio(prepared.value.id);
    expect(audio.ok && audio.value?.contentType).toBe("audio/wav");
    expect(audio.ok && audio.value?.bytes.byteLength).toBe(silentWav(100).byteLength);
  });

  test("generated review sentences are spoken when banked, so the serve does not wait", async () => {
    const { provider, spoken } = scripted([clip]);
    const app = harness(provider);
    const stored = await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    if (!stored.ok) throw new Error(stored.error.kind);
    const taught = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!taught.ok) throw new Error(taught.error.kind);
    const acknowledged = app.material.acknowledgeTeaching(app.card.id, taught.value.id);
    if (!acknowledged.ok) throw new Error(acknowledged.error.kind);
    spoken.length = 0;
    const review = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!review.ok) throw new Error(review.error.kind);
    expect(review.value.mode).toBe("review");
    expect(review.value.audioUrl).not.toBeNull();
    // Every banked candidate of the generation was spoken, not only the one served.
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken).toContain(review.value.material.japanese);
    // A second serve of a banked reserve adds no synthesis.
    const before = spoken.length;
    const next = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!next.ok) throw new Error(next.error.kind);
    expect(next.value.source).toBe("reserve");
    expect(next.value.audioUrl).not.toBeNull();
    expect(spoken.length).toBe(before);
  });

  test("a failed synthesis leaves the sentence audio-less and still served", async () => {
    const { provider, spoken } = scripted([err({ kind: "rateLimit", detail: "429" })]);
    const app = harness(provider);
    await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    const prepared = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!prepared.ok) throw new Error(prepared.error.kind);
    expect(prepared.value.audioUrl).toBeNull();
    expect(spoken).toHaveLength(1);
    expect(app.material.presentationAudio(prepared.value.id)).toEqual({
      ok: true,
      value: null,
    });
  });

  test("the daily ceiling stops new synthesis but not serving", async () => {
    const { provider, spoken } = scripted([clip]);
    const app = harness(provider, 1);
    await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    const taught = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!taught.ok) throw new Error(taught.error.kind);
    expect(taught.value.audioUrl).not.toBeNull();
    app.material.acknowledgeTeaching(app.card.id, taught.value.id);
    const review = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!review.ok) throw new Error(review.error.kind);
    expect(review.value.audioUrl).toBeNull();
    expect(spoken).toEqual(["鳥かな。"]);
  });

  test("a clip from another voice is re-spoken on its next serve", async () => {
    const first = scripted([clip]);
    const app = harness(first.provider);
    await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    const taught = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!taught.ok) throw new Error(taught.error.kind);
    expect(first.spoken).toEqual(["鳥かな。"]);
    app.material.close();

    // The same database, a different voice: the banked sentence is spoken
    // again by the new voice the first time it is served, then kept.
    const second = scripted([clip]);
    const reopened = openLearningMaterial({
      databasePath: app.databasePath,
      clock: app.clock.now,
      nextId: sequentialIds(),
      nextToken: () => `t-${Math.random()}`,
      provider: createDeterministicMaterialProvider(),
      keyCustody: createProviderKeyCustody(
        { verify: async () => ok(undefined) },
        "sk-test",
      ),
      validate: async ({ value }) => ok(value as GeneratedMaterial),
      inspectionEnabled: false,
      speech: {
        ...second.provider,
        identity: { ...second.provider.identity, voice: "another-voice" },
      },
    });
    if (!reopened.ok) throw new Error(reopened.error.kind);
    const again = await reopened.value.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!again.ok) throw new Error(again.error.kind);
    expect(again.value.audioUrl).not.toBeNull();
    expect(second.spoken).toEqual(["鳥かな。"]);
    const once = await reopened.value.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!once.ok) throw new Error(once.error.kind);
    expect(second.spoken).toHaveLength(1);
    reopened.value.close();
  });

  test("without a speech provider every presentation serves with no clip", async () => {
    const app = harness(undefined);
    await app.material.storeAuthoredTeaching({
      card: app.card,
      knowledge: app.knowledge,
      value: app.teaching,
    });
    const prepared = await app.material.prepare({
      card: app.card,
      knowledge: app.knowledge,
    });
    if (!prepared.ok) throw new Error(prepared.error.kind);
    expect(prepared.value.audioUrl).toBeNull();
    expect(app.material.presentationAudio(prepared.value.id)).toEqual({
      ok: true,
      value: null,
    });
  });
});
