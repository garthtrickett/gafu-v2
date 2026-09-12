import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mutableClock,
  sequentialIds,
  testPermitVerifier,
  testSeed,
} from "../../tests/support/study.ts";
import {
  type PlanDraft,
  type PlanDraftItem,
  planDraftDigest,
} from "../preparation-plan-contracts.ts";
import { openStudy } from "./study.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const grammar = (
  findingKey: string,
  form: string,
  episodeKey: string,
  order: number,
  priority: number,
): PlanDraftItem => ({
  findingKey,
  classification: "required",
  preparationPriority: priority,
  stagingPriority: priority,
  rankReasons: ["fixture priority"],
  firstNeeded: { episodeKey, episodeOrder: order, episodeTitle: `Episode ${order}` },
  evidence: [{ episodeKey, cueKey: `${episodeKey}-cue` }],
  existingCardId: null,
  proposedCard: {
    type: "grammar",
    content: {
      canonicalForm: form,
      meaning: `meaning ${form}`,
      formation: form,
      usageNotes: "",
    },
    stagingPriority: priority,
  },
  identityClaim: {
    authority: "gafu-preparation-v1",
    claimKey: `grammar:${form}`,
  },
});

const vocabulary = (
  findingKey: string,
  lemma: string,
  episodeKey: string,
  order: number,
  priority: number,
): PlanDraftItem => ({
  findingKey,
  classification: "required",
  preparationPriority: priority,
  stagingPriority: priority,
  rankReasons: ["fixture priority"],
  firstNeeded: { episodeKey, episodeOrder: order, episodeTitle: `Episode ${order}` },
  evidence: [{ episodeKey, cueKey: `${episodeKey}-${findingKey}` }],
  existingCardId: null,
  proposedCard: {
    type: "vocabulary",
    content: {
      lemma,
      reading: lemma,
      partOfSpeech: "noun",
      meaning: `meaning ${lemma}`,
      usageNotes: "",
    },
    stagingPriority: priority,
  },
  identityClaim: {
    authority: "gafu-preparation-v1",
    claimKey: `vocabulary:${JSON.stringify([lemma, lemma, "noun", "fixture-sense"])}`,
  },
});

const draft = (items: readonly PlanDraftItem[]): PlanDraft => {
  const payload = {
    version: "plan-draft-v1" as const,
    sourceKey: "subtitle-set-one",
    sourceRevision: "source-one",
    analysisRunId: "run-one",
    studyDigest: "study-one",
    title: "Fixture series",
    episodes: [
      { episodeKey: "episode-one", order: 1, title: "Episode 1" },
      { episodeKey: "episode-two", order: 2, title: "Episode 2" },
    ],
    selection: {
      required: items.length,
      helpful: 0,
      grammar: items.filter((item) => item.proposedCard.type === "grammar").length,
      vocabulary: items.filter((item) => item.proposedCard.type === "vocabulary")
        .length,
    },
    blockers: [],
    items,
  };
  return { ...payload, digest: planDraftDigest(payload) };
};

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-plan-"));
  directories.push(directory);
  const databasePath = join(directory, "study.sqlite");
  const clock = mutableClock("2026-09-08T08:00:00.000Z");
  const study = openStudy({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
    grammarTargetSupported: () => true,
  });
  if (!study.ok) throw new Error(study.error.kind);
  return { study: study.value, databasePath, clock };
};

describe("Phase 4 Preparation Plans", () => {
  test("starts atomically, reuses identities, and is idempotent under retries", () => {
    const context = setup();
    const existing = context.study.createCard({
      type: "grammar",
      content: {
        canonicalForm: "〜ながら",
        meaning: "meaning 〜ながら",
        formation: "〜ながら",
        usageNotes: "",
      },
    });
    if (!existing.ok) throw new Error(existing.error.kind);
    const existingItem = {
      ...grammar("finding-existing", "〜ながら", "episode-one", 1, 900),
      existingCardId: existing.value.card.id,
    };
    const value = draft([
      existingItem,
      vocabulary("finding-cafe", "カフェ", "episode-one", 1, 800),
      grammar("finding-two", "〜てから", "episode-two", 2, 700),
    ]);
    const started = context.study.startPlan({
      operationKey: "start-one",
      draft: value,
    });
    expect(started).toMatchObject({
      ok: true,
      value: { revision: 1, createdCards: 2, reusedCards: 1, members: { length: 3 } },
    });
    const repeated = context.study.startPlan({
      operationKey: "start-one",
      draft: value,
    });
    expect(repeated).toEqual(started);
    const secondKey = context.study.startPlan({
      operationKey: "start-two",
      draft: value,
    });
    expect(secondKey).toMatchObject({
      ok: true,
      value: { id: started.ok ? started.value.id : "", revision: 1 },
    });
    expect(context.study.listCards()).toMatchObject({ ok: true, value: { length: 3 } });
    const { digest: _digest, ...changedPayload } = value;
    const changedDraft = { ...changedPayload, title: "Changed title" };
    expect(
      context.study.startPlan({
        operationKey: "start-one",
        draft: { ...changedDraft, digest: planDraftDigest(changedDraft) },
      }),
    ).toEqual({ ok: false, error: { kind: "planOperationConflict" } });
    context.study.close();
  });

  test("rejects the complete draft before writing any plan or Card", () => {
    const context = setup();
    const before = context.study.listCards();
    const invalid = draft([grammar("duplicate", "〜ながら", "episode-one", 1, 2)]);
    const result = context.study.startPlan({
      operationKey: "invalid",
      draft: {
        ...invalid,
        blockers: [{ findingKey: "x", label: "x", reason: "missingEvidence" }],
      },
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "invalidPlanDraft" } });
    expect(context.study.listCards()).toEqual(before);
    expect(context.study.listPlans()).toEqual({ ok: true, value: [] });
    const valid = draft([grammar("valid", "〜てから", "episode-one", 1, 2)]);
    expect(
      context.study.startPlan({
        operationKey: "tampered",
        draft: { ...valid, title: "Changed after signing" },
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidPlanDraft" } });
    context.study.close();
  });

  test("shares one three-card daily allowance and reports per-episode readiness", () => {
    const context = setup();
    context.study.setPreferences({ newCardsPerDay: 3, timeZone: "UTC" });
    const manual = context.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "手動",
        reading: "しゅどう",
        partOfSpeech: "noun",
        meaning: "manual",
        usageNotes: "",
      },
      stagingPriority: 10_000,
    });
    if (!manual.ok) throw new Error(manual.error.kind);
    const started = context.study.startPlan({
      operationKey: "shared-limit",
      draft: draft([
        vocabulary("one", "珈琲", "episode-one", 1, 9_000),
        grammar("two", "〜ながら", "episode-one", 1, 8_000),
        vocabulary("three", "店員", "episode-two", 2, 7_000),
      ]),
    });
    if (!started.ok) throw new Error(started.error.kind);
    const queue = context.study.studyQueue();
    expect(queue).toMatchObject({
      ok: true,
      value: { admittedToday: 3, newlyAdmitted: 3, stagedCount: 1 },
    });
    const afterAdmission = context.study.plan(started.value.id);
    expect(afterAdmission).toMatchObject({
      ok: true,
      value: {
        ready: false,
        episodes: [
          { order: 1, ready: false },
          { order: 2, ready: false, estimatedIntroductionDay: "2026-09-09" },
        ],
      },
    });
    if (!afterAdmission.ok) throw new Error(afterAdmission.error.kind);
    const episodeOneCards = afterAdmission.value.members.filter(
      (member) => member.firstNeededEpisodeOrder === 1,
    );
    for (const member of episodeOneCards) {
      context.study.setCardState({
        cardId: member.cardId as never,
        action: "markSupportReady",
      });
    }
    expect(context.study.plan(started.value.id)).toMatchObject({
      ok: true,
      value: {
        episodes: [
          { order: 1, ready: true },
          { order: 2, ready: false },
        ],
      },
    });
    context.study.close();
  });

  test("pause and delete remove only plan staging intent", () => {
    const context = setup();
    const started = context.study.startPlan({
      operationKey: "lifecycle",
      draft: draft([vocabulary("one", "珈琲", "episode-one", 1, 100)]),
    });
    if (!started.ok) throw new Error(started.error.kind);
    const paused = context.study.setPlanState({
      planId: started.value.id,
      action: "pause",
    });
    expect(paused.ok && paused.value.state).toBe("paused");
    expect(paused.ok && paused.value.episodes[0]).toMatchObject({
      inactiveStagedBlockers: 1,
      estimatedIntroductionDay: null,
    });
    const database = new Database(context.databasePath, { readonly: true });
    const rowsBefore = database.query("SELECT count(*) AS count FROM card").get() as {
      count: number;
    };
    database.close();
    expect(context.study.deletePlan(started.value.id, "delete")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(context.study.listCards()).toMatchObject({
      ok: true,
      value: { length: rowsBefore.count },
    });
    expect(context.study.listPlans()).toEqual({ ok: true, value: [] });
    const operations = new Database(context.databasePath, { readonly: true });
    expect(
      operations.query("SELECT count(*) AS count FROM plan_start_operation").get(),
    ).toEqual({ count: 1 });
    expect(
      operations.query("SELECT deleted_at FROM preparation_plan").get(),
    ).toMatchObject({ deleted_at: expect.any(String) });
    expect(
      operations
        .query(
          "SELECT active FROM staging_source WHERE source_kind = 'plan' AND source_key = ?",
        )
        .get(started.value.id),
    ).toEqual({ active: 0 });
    operations.close();
    expect(
      context.study.startPlan({
        operationKey: "lifecycle",
        draft: draft([vocabulary("one", "珈琲", "episode-one", 1, 100)]),
      }),
    ).toMatchObject({ ok: true, value: { id: started.value.id } });
    context.study.close();
  });

  test("rejects conflicting source and canonical Card identities", () => {
    const context = setup();
    const cat = context.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "猫",
        reading: "猫",
        partOfSpeech: "noun",
        meaning: "meaning 猫",
        usageNotes: "",
      },
    });
    const dog = context.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "犬",
        reading: "犬",
        partOfSpeech: "noun",
        meaning: "meaning 犬",
        usageNotes: "",
      },
    });
    if (!cat.ok || !dog.ok) throw new Error("fixture Card creation failed");
    const item = vocabulary("cat", "猫", "episode-one", 1, 100);
    const database = new Database(context.databasePath);
    database
      .query(
        "INSERT INTO identity_claim(authority, claim_key, card_id) VALUES (?, ?, ?)",
      )
      .run(
        item.identityClaim.authority,
        item.identityClaim.claimKey,
        dog.value.card.id,
      );
    database.close();
    expect(
      context.study.startPlan({
        operationKey: "identity-conflict",
        draft: draft([item]),
      }),
    ).toEqual({
      ok: false,
      error: { kind: "identityConflict", existingCardId: dog.value.card.id },
    });
    context.study.close();
  });
});
