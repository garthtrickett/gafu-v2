import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, testSeed } from "../../tests/support/study.ts";
import { err, ok, type Result } from "../result.ts";
import { openStudy } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import type {
  GeneratedMaterial,
  MaterialFailure,
  MaterialProvider,
  PrepareMaterial,
} from "./generated-contracts.ts";
import { openLearningMaterial } from "./learning-material.ts";
import { createReviewPreparation } from "./review-preparation.ts";
import { createDeterministicMaterialProvider } from "./scripted-provider.ts";

const sequence = (prefix: string) => {
  let n = 0;
  return () => prefix + ++n;
};
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
const providerFixture = () => {
  const base = createDeterministicMaterialProvider();
  const batch = base.batch;
  if (!batch) throw Error("Missing test batch");
  const calls: { sizes: number[]; polls: number } = { sizes: [], polls: 0 };
  const provider: MaterialProvider = {
    ...base,
    batch: {
      dispatch: async (...args) => {
        calls.sizes.push(args[0].length);
        return batch.dispatch(...args);
      },
      poll: async (...args) => {
        calls.polls++;
        return batch.poll(...args);
      },
    },
  };
  return { provider, calls };
};
function setup(
  options: {
    count?: number;
    admit?: boolean;
    path?: string;
    provider?: MaterialProvider;
    validate?: (
      input: PrepareMaterial & { value: unknown },
    ) => Promise<Result<GeneratedMaterial, MaterialFailure>>;
    ids?: () => string;
  } = {},
) {
  const folder = options.path ? null : mkdtempSync(join(tmpdir(), "gafu-server-prep-"));
  if (folder) folders.push(folder);
  const path = options.path ?? join(folder ?? tmpdir(), "study.sqlite"),
    clock = mutableClock("2026-11-08T10:00:00.000Z");
  const fixture = providerFixture(),
    ids = options.ids ?? sequence("material-");
  const openedMaterial = openLearningMaterial({
    databasePath: path,
    clock: clock.now,
    nextId: ids,
    nextToken: () => crypto.randomUUID(),
    provider: options.provider ?? fixture.provider,
    keyCustody: createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "test-fixture",
    ),
    validate: options.validate ?? (async ({ value }) => ok(value as GeneratedMaterial)),
    inspectionEnabled: false,
  });
  if (!openedMaterial.ok) throw Error(openedMaterial.error.kind);
  const material = openedMaterial.value;
  const openedStudy = openStudy({
    databasePath: path,
    clock: clock.now,
    nextId: sequence("card-"),
    permitVerifier: material.permitVerifier,
    knownWordSeed: testSeed,
    grammarTargetSupported: () => true,
  });
  if (!openedStudy.ok) throw Error(openedStudy.error.kind);
  const study = openedStudy.value;
  study.setPreferences({
    newCardsPerDay: 100,
    speechEnabled: false,
    automaticPreparation: "server",
    firstReviewAfterMinutes: 0,
  });
  for (let i = 0; i < (options.count ?? 0); i++) {
    const made = study.createCard({
      type: "vocabulary",
      content: {
        lemma: `語${i}`,
        reading: "ご",
        meaning: `test sense ${i}`,
        partOfSpeech: "noun",
        usageNotes: "",
      },
    });
    if (!made.ok) throw Error(made.error.kind);
  }
  if (options.admit !== false) study.studyQueue();
  const runner = createReviewPreparation({
    study,
    material,
    clock: clock.now,
    automaticAllowed: () => true,
  });
  const drain = async (n = 50) => {
    for (let i = 0; i < n; i++) await runner.tick();
  };
  const input = (id?: string) => {
    const queue = study.duePreparationSnapshot(),
      known = study.knowledgeSnapshot();
    if (!queue.ok || !known.ok) throw Error("No study snapshot");
    const card = id
      ? queue.value.due.find((x) => x.card.id === id)?.card
      : queue.value.due[0]?.card;
    if (!card) throw Error("No due Card");
    return { card, knowledge: known.value, cachedOnly: true } satisfies PrepareMaterial;
  };
  return {
    study,
    material,
    runner,
    clock,
    path,
    provider: options.provider ?? fixture.provider,
    calls: fixture.calls,
    drain,
    input,
    close: async () => {
      await runner.stop();
      study.close();
      material.close();
    },
  };
}

test("closed-browser server preparation drains 95 targets as 20/20/20/20/15 and idle checks spend nothing", async () => {
  const app = setup({ count: 95 });
  try {
    await app.drain(20);
    expect(app.calls.sizes).toEqual([20, 20, 20, 20, 15]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { ready: 95, preparing: 0, waiting: 0, blocked: 0 },
    });
    const raw = new Database(app.path, { readonly: true });
    expect(raw.query("SELECT * FROM review_event").all()).toHaveLength(0);
    expect(raw.query("SELECT * FROM teaching_acknowledgement").all()).toHaveLength(0);
    expect(raw.query("SELECT * FROM presentation_permit").all()).toHaveLength(0);
    expect(
      raw
        .query("SELECT * FROM validated_presentation WHERE shown_at IS NOT NULL")
        .all(),
    ).toHaveLength(0);
    expect(raw.query("SELECT * FROM speech_daily_usage").all()).toHaveLength(0);
    raw.close();
    await app.drain(5);
    expect(app.calls.sizes).toHaveLength(5);
  } finally {
    await app.close();
  }
}, 15_000);

test("server ticks never admit staged Cards, even across day rollover", async () => {
  const app = setup({ count: 3, admit: false });
  try {
    await app.drain(4);
    app.clock.set("2026-11-09T10:00:00Z");
    await app.drain(4);
    expect(app.calls.sizes).toEqual([]);
    expect(app.study.status()).toMatchObject({
      ok: true,
      value: { stagedCount: 3, activeCount: 0 },
    });
    app.study.studyQueue();
    await app.drain(5);
    expect(app.calls.sizes).toEqual([3]);
  } finally {
    await app.close();
  }
});

test("simultaneous manual and automatic requests join the same target claims", async () => {
  const app = setup({ count: 5 });
  try {
    const [a, b] = await Promise.all([
      app.runner.request("manual"),
      app.runner.request("server"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.batchId).toBe(b.value.batchId);
    await app.drain(5);
    expect(app.calls.sizes).toEqual([5]);
  } finally {
    await app.close();
  }
});

test("ambiguous dispatch remains blocked through idle ticks until explicitly retried", async () => {
  const base = providerFixture();
  let uncertain = true;
  const savedBatch = base.provider.batch;
  if (!savedBatch) throw Error("Missing batch");
  const provider: MaterialProvider = {
    ...base.provider,
    batch: {
      ...savedBatch,
      dispatch: async (...args) => {
        const made = await savedBatch.dispatch(...args);
        return uncertain
          ? err({ kind: "timeout", detail: "Response lost after remote acceptance" })
          : made;
      },
    },
  };
  const app = setup({ count: 2, provider });
  try {
    await app.drain(6);
    expect(base.calls.sizes).toEqual([2]);
    const state = app.material.preparationState();
    expect(state).toMatchObject({
      ok: true,
      value: { uncertainCardIds: { length: 2 }, uncertainBatches: { length: 1 } },
    });
    await app.drain(5);
    expect(base.calls.sizes).toHaveLength(1);
    if (!state.ok || !state.value.uncertainBatches[0])
      throw Error("No uncertain batch");
    uncertain = false;
    expect(
      app.material.retryUncertainBatch(state.value.uncertainBatches[0], {
        allowRepurchase: true,
      }).ok,
    ).toBe(true);
    await app.drain(5);
    expect(base.calls.sizes).toEqual([2, 2]);
  } finally {
    await app.close();
  }
});

test("a stored response ID resumes on restart without another dispatch", async () => {
  const base = providerFixture(),
    ids = sequence("restart-material-");
  const first = setup({ count: 3, provider: base.provider, ids });
  await first.runner.tick();
  await first.runner.tick();
  expect(base.calls.sizes).toEqual([3]);
  const path = first.path;
  await first.close();
  const second = setup({ path, provider: base.provider, ids });
  try {
    await second.drain(4);
    expect(base.calls.sizes).toEqual([3]);
    expect(second.runner.status()).toMatchObject({ ok: true, value: { ready: 3 } });
  } finally {
    await second.close();
  }
});

test("terminal responses replay locally after validation interruption without another provider poll", async () => {
  const base = providerFixture(),
    ids = sequence("replay-material-");
  let fail = true;
  const first = setup({
    count: 2,
    provider: base.provider,
    ids,
    validate: async ({ value }) => {
      if (fail) throw Error("Simulated validation interruption");
      return ok(value as GeneratedMaterial);
    },
  });
  await first.drain(3);
  expect(base.calls.sizes).toEqual([2]);
  expect(base.calls.polls).toBe(1);
  const path = first.path;
  await first.close();
  fail = false;
  const second = setup({ path, provider: base.provider, ids });
  try {
    await second.drain(4);
    expect(base.calls.sizes).toEqual([2]);
    expect(base.calls.polls).toBe(1);
    expect(second.runner.status()).toMatchObject({ ok: true, value: { ready: 2 } });
  } finally {
    await second.close();
  }
});

test("obsolete permits cannot grade a changed Card, while a saved answer still replays idempotently", async () => {
  const app = setup({ count: 1 });
  try {
    await app.drain(5);
    let input = app.input();
    const first = await app.material.prepare(input);
    if (!first.ok) throw Error(first.error.kind);
    app.material.acknowledgeTeaching(input.card.id, first.value.id);
    app.study.recordTeaching(input.card.id);
    await app.drain(5);
    input = app.input();
    const a = await app.material.prepare(input),
      b = await app.material.prepare(input);
    if (!a.ok || !b.ok || !a.value.permit || !b.value.permit)
      throw Error("Missing review permits");
    expect(b.value.id).toBe(a.value.id);
    expect(b.value.permit.token).toBe(a.value.permit.token);
    const answered = app.study.answer({
      cardId: input.card.id,
      grade: "good",
      permit: a.value.permit,
    });
    expect(answered.ok).toBe(true);
    expect(
      app.study.answer({
        cardId: input.card.id,
        grade: "good",
        permit: a.value.permit,
      }),
    ).toEqual(answered);
    const made = app.study.updateCard(input.card.id, {
      ...input.card.content,
      meaning: "corrected meaning",
    });
    expect(made.ok).toBe(true);
    expect(
      app.study.answer({
        cardId: input.card.id,
        grade: "again",
        permit: b.value.permit,
      }).ok,
    ).toBe(false);
    const raw = new Database(app.path, { readonly: true });
    expect(raw.query("SELECT * FROM review_event").all()).toHaveLength(1);
    raw.close();
  } finally {
    await app.close();
  }
});

test("switching off reconciles paid work but does not buy another validation round", async () => {
  const app = setup({
    count: 2,
    validate: async () =>
      err({ kind: "validationRejected", reasons: ["targetAbsent"] }),
  });
  try {
    await app.drain(2);
    expect(app.calls.sizes).toEqual([2]);
    app.study.setPreferences({ automaticPreparation: "off" });
    await app.drain(6);
    expect(app.calls.polls).toBe(1);
    expect(app.calls.sizes).toEqual([2]);
    await app.runner.request("manual");
    await app.drain(6);
    expect(app.calls.sizes).toEqual([2, 2, 2]);
  } finally {
    await app.close();
  }
});

test("provider rate limits pause the lane and resume cannot bypass Retry-After", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  let attempts = 0;
  const app = setup({
    count: 2,
    provider: {
      ...base.provider,
      batch: {
        ...batch,
        dispatch: async (...args) => {
          attempts++;
          return attempts === 1
            ? err({ kind: "rateLimit", detail: "test", retryAfterMs: 300_000 })
            : batch.dispatch(...args);
        },
      },
    },
  });
  try {
    await app.drain(5);
    expect(attempts).toBe(1);
    expect(app.material.preparationState()).toMatchObject({
      ok: true,
      value: { blockedReason: "rateLimit" },
    });
    app.material.resumePreparation();
    await app.drain(4);
    expect(attempts).toBe(1);
    app.clock.set("2026-11-08T10:06:00.000Z");
    await app.drain(5);
    expect(attempts).toBe(2);
    expect(app.runner.status()).toMatchObject({ ok: true, value: { ready: 2 } });
  } finally {
    await app.close();
  }
});

test("authentication pauses all further automatic dispatch until explicit recovery", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  let attempts = 0,
    authorized = false;
  const app = setup({
    count: 2,
    provider: {
      ...base.provider,
      batch: {
        ...batch,
        dispatch: async (...args) => {
          attempts++;
          return authorized
            ? batch.dispatch(...args)
            : err({ kind: "authentication", detail: "test" });
        },
      },
    },
  });
  try {
    await app.drain(8);
    expect(attempts).toBe(1);
    authorized = true;
    app.clock.set("2026-11-09T10:00:00.000Z");
    await app.drain(8);
    expect(attempts).toBe(1);
    app.material.resumePreparation();
    await app.drain(5);
    expect(attempts).toBe(2);
  } finally {
    await app.close();
  }
});

test("a suspension during asynchronous validation cannot publish old-context material", async () => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const app = setup({
    count: 1,
    validate: async ({ value }) => {
      entered();
      await gate;
      return ok(value as GeneratedMaterial);
    },
  });
  try {
    await app.drain(2);
    const input = app.input();
    const completing = app.runner.tick();
    await waiting;
    expect(
      app.study.setCardState({ cardId: input.card.id, action: "suspend" }).ok,
    ).toBe(true);
    release();
    await completing;
    const raw = new Database(app.path, { readonly: true });
    expect(raw.query("SELECT * FROM validated_presentation").all()).toHaveLength(0);
    raw.close();
    expect(app.calls.sizes).toEqual([1]);
  } finally {
    release();
    await app.close();
  }
});

test("an unused permit loses authority when the Card changes before a direct answer", async () => {
  const app = setup({ count: 1 });
  try {
    await app.drain(5);
    let input = app.input();
    const taught = await app.material.prepare(input);
    if (!taught.ok) throw Error("No teaching");
    app.material.acknowledgeTeaching(input.card.id, taught.value.id);
    app.study.recordTeaching(input.card.id);
    await app.drain(5);
    input = app.input();
    const review = await app.material.prepare(input);
    if (!review.ok || !review.value.permit) throw Error("No review");
    app.study.updateCard(input.card.id, {
      ...input.card.content,
      meaning: "corrected",
    });
    expect(
      app.study.answer({
        cardId: input.card.id,
        grade: "good",
        permit: review.value.permit,
      }),
    ).toMatchObject({ ok: false, error: { kind: "presentationInvalid" } });
    const raw = new Database(app.path, { readonly: true });
    expect(raw.query("SELECT * FROM review_event").all()).toHaveLength(0);
    raw.close();
  } finally {
    await app.close();
  }
});

test("an ungraded review reopens after a knowledge correction revalidates its sentence", async () => {
  const app = setup({ count: 1 });
  try {
    await app.drain(5);
    let input = app.input();
    const taught = await app.material.prepare(input);
    if (!taught.ok) throw Error("No teaching");
    app.material.acknowledgeTeaching(input.card.id, taught.value.id);
    app.study.recordTeaching(input.card.id);
    await app.drain(5);
    input = app.input();
    const review = await app.material.prepare(input);
    if (!review.ok || !review.value.permit) throw Error("No review");
    app.clock.set("2026-11-08T11:00:00.000Z");
    expect(app.study.setBaselineWordEnabled("inu", false).ok).toBe(true);
    const current = app.input(input.card.id);
    expect(await app.material.checkReserves(current)).toMatchObject({ ok: true });
    expect(app.runner.status()).toMatchObject({ ok: true, value: { ready: 1 } });
    expect(
      app.study.answer({
        cardId: input.card.id,
        grade: "good",
        permit: review.value.permit,
      }),
    ).toMatchObject({ ok: false, error: { kind: "presentationInvalid" } });
    const restored = await app.material.prepare(current);
    if (!restored.ok || !restored.value.permit) throw Error("No recovered review");
    expect(restored.value.id).toBe(review.value.id);
    expect(restored.value.permit.token).not.toBe(review.value.permit.token);
    expect(restored.value.permit.expiresAt).toBe(review.value.permit.expiresAt);
    const repeated = await app.material.prepare(current);
    if (!repeated.ok) throw Error("No repeated review");
    expect(repeated.value.permit).toEqual(restored.value.permit);
    expect(
      app.study.answer({
        cardId: input.card.id,
        grade: "good",
        permit: restored.value.permit,
      }).ok,
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test("a review invalidated by a knowledge correction is not reopened", async () => {
  let reject = false;
  const app = setup({
    count: 1,
    validate: async ({ value }) =>
      reject
        ? err({ kind: "validationRejected", reasons: ["unknownVocabulary"] })
        : ok(value as GeneratedMaterial),
  });
  try {
    await app.drain(5);
    let input = app.input();
    const taught = await app.material.prepare(input);
    if (!taught.ok) throw Error("No teaching");
    app.material.acknowledgeTeaching(input.card.id, taught.value.id);
    app.study.recordTeaching(input.card.id);
    await app.drain(5);
    input = app.input();
    const review = await app.material.prepare(input);
    if (!review.ok || !review.value.permit) throw Error("No review");
    app.clock.set("2026-11-08T11:00:00.000Z");
    expect(app.study.setBaselineWordEnabled("inu", false).ok).toBe(true);
    reject = true;
    const current = app.input(input.card.id);
    expect(await app.material.checkReserves(current)).toEqual({
      ok: true,
      value: false,
    });
    expect(await app.material.prepare(current)).toMatchObject({
      ok: false,
      error: { kind: "teachingNotPrepared" },
    });
    expect(app.runner.status()).toMatchObject({ ok: true, value: { ready: 0 } });
    const raw = new Database(app.path, { readonly: true });
    expect(raw.query("SELECT * FROM review_event").all()).toHaveLength(0);
    raw.close();
  } finally {
    await app.close();
  }
});

test("legacy issued review recovery precedes taking another reserve and keeps its original expiry", async () => {
  const app = setup({ count: 1 });
  try {
    await app.drain(5);
    let input = app.input();
    const taught = await app.material.prepare(input);
    if (!taught.ok) throw Error("No teaching");
    app.material.acknowledgeTeaching(input.card.id, taught.value.id);
    app.study.recordTeaching(input.card.id);
    await app.drain(5);
    input = app.input();
    const review = await app.material.prepare(input);
    if (!review.ok || !review.value.permit) throw Error("No review");
    const raw = new Database(app.path);
    raw
      .query("UPDATE validated_presentation SET context_json=NULL WHERE id=?")
      .run(review.value.id);
    raw
      .query("UPDATE presentation_permit SET context_json=NULL WHERE token=?")
      .run(review.value.permit.token);
    raw.close();
    app.clock.set("2026-11-08T11:00:00.000Z");
    expect(
      app.material.permitVerifier.verify(review.value.permit, app.clock.now()),
    ).toMatchObject({ ok: true, value: { context: null } });
    const restored = await app.material.prepare(app.input());
    if (!restored.ok || !restored.value.permit) throw Error("No recovered review");
    expect(restored.value.id).toBe(review.value.id);
    expect(restored.value.permit.expiresAt).toBe(review.value.permit.expiresAt);
    expect(
      app.study.answer({
        cardId: input.card.id,
        grade: "good",
        permit: restored.value.permit,
      }).ok,
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test("a stored job without a dispatch ID is fenced even in the same process", async () => {
  const app = setup({ count: 1 });
  try {
    const begun = await app.runner.request("manual");
    if (!begun.ok) throw Error("No batch");
    const raw = new Database(app.path);
    raw
      .query(
        "INSERT INTO review_batch_job(batch_id,job_id,dispatched_at,phase,owner_token,provider_identity) VALUES (?,'',?,'dispatching','interrupted',?)",
      )
      .run(
        begun.value.batchId,
        app.clock.now().toISOString(),
        JSON.stringify({ ...app.provider.identity, configuration: "default" }),
      );
    raw.close();
    await app.drain(5);
    expect(app.calls.sizes).toEqual([]);
    expect(app.material.preparationState()).toMatchObject({
      ok: true,
      value: { uncertainBatches: [begun.value.batchId] },
    });
  } finally {
    await app.close();
  }
});

test("known provider IDs get one recovery retrieval instead of a new dispatch after their deadline", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  let completed = false;
  const app = setup({
    count: 1,
    provider: {
      ...base.provider,
      batch: {
        ...batch,
        poll: async (...args) =>
          completed ? batch.poll(...args) : ok({ status: "pending" }),
      },
    },
  });
  try {
    await app.drain(2);
    expect(base.calls.sizes).toEqual([1]);
    app.clock.set("2026-11-08T10:16:00.000Z");
    await app.drain(2);
    const state = app.material.preparationState();
    if (!state.ok || !state.value.uncertainBatches[0]) throw Error("No recovery");
    completed = true;
    expect(app.material.retryUncertainBatch(state.value.uncertainBatches[0]).ok).toBe(
      true,
    );
    await app.drain(5);
    expect(base.calls.sizes).toEqual([1]);
    expect(app.runner.status()).toMatchObject({ ok: true, value: { ready: 1 } });
  } finally {
    await app.close();
  }
});

test("an overdue completed provider request is retrieved before it can be marked uncertain", async () => {
  const app = setup({ count: 1 });
  try {
    await app.drain(2);
    expect(app.calls.sizes).toEqual([1]);
    app.clock.set("2026-11-08T10:16:00.000Z");
    await app.drain(5);
    expect(app.calls.sizes).toEqual([1]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { ready: 1, blocked: 0, preparing: 0 },
    });
  } finally {
    await app.close();
  }
});

test("an overdue queued request is replaced only after confirmed cancellation", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  let queued = true,
    cancelled = 0;
  const app = setup({
    count: 1,
    provider: {
      ...base.provider,
      batch: {
        ...batch,
        poll: (...args) =>
          queued
            ? Promise.resolve(ok({ status: "pending", phase: "queued" }))
            : batch.poll(...args),
        cancel: async () => {
          cancelled++;
          queued = false;
          return ok({ status: "cancelled" });
        },
      },
    },
  });
  try {
    await app.drain(2);
    app.clock.set("2026-11-08T10:16:00.000Z");
    await app.runner.tick();
    expect(cancelled).toBe(1);
    expect(base.calls.sizes).toEqual([1]);
    app.clock.set("2026-11-08T10:17:01.000Z");
    await app.drain(5);
    expect(base.calls.sizes).toEqual([1, 1]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { ready: 1, blocked: 0 },
    });
    const raw = new Database(app.path, { readonly: true });
    expect(
      raw
        .query(
          "SELECT provider_job_id FROM review_batch_attempt WHERE disposition='cancelled'",
        )
        .all(),
    ).toHaveLength(1);
    raw.close();
  } finally {
    await app.close();
  }
});

test("an ambiguous cancellation never authorizes a replacement", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  const app = setup({
    count: 1,
    provider: {
      ...base.provider,
      batch: {
        ...batch,
        poll: async () => ok({ status: "pending", phase: "queued" }),
        cancel: async () =>
          err({ kind: "timeout", detail: "Cancellation response lost" }),
      },
    },
  });
  try {
    await app.drain(2);
    app.clock.set("2026-11-08T10:16:00.000Z");
    await app.drain(6);
    expect(base.calls.sizes).toEqual([1]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { ready: 0, blocked: 1, preparing: 0 },
    });
    expect(app.material.preparationState()).toMatchObject({
      ok: true,
      value: { uncertainCardIds: { length: 1 } },
    });
    const state = app.material.preparationState();
    if (!state.ok || !state.value.uncertainBatches[0])
      throw Error("No uncertain request");
    const batchId = state.value.uncertainBatches[0];
    const raw = new Database(app.path);
    raw
      .query(
        "INSERT INTO review_batch_attempt(id,batch_id,created_at,disposition,provider_job_id) VALUES ('prior-cancel',?,?,'cancelled','old-queued-id')",
      )
      .run(batchId, app.clock.now().toISOString());
    expect(app.material.retryUncertainBatch(batchId).ok).toBe(true);
    expect(
      raw
        .query("SELECT disposition FROM review_batch_attempt WHERE id='prior-cancel'")
        .get(),
    ).toEqual({ disposition: "cancelled" });
    raw.close();
  } finally {
    await app.close();
  }
});

test("queue cancellations are bounded and automatic opt-out prevents cancellation and replacement", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  let cancelled = 0;
  const provider: MaterialProvider = {
    ...base.provider,
    batch: {
      ...batch,
      poll: async () => ok({ status: "pending", phase: "queued" }),
      cancel: async () => {
        cancelled++;
        return ok({ status: "cancelled" });
      },
    },
  };
  const app = setup({ count: 1, provider });
  try {
    await app.drain(2);
    for (let i = 0; i < 3; i++) {
      app.clock.set(new Date(app.clock.now().getTime() + 16 * 60_000).toISOString());
      await app.runner.tick();
      app.clock.set(new Date(app.clock.now().getTime() + 61_000).toISOString());
      await app.drain(2);
    }
    expect(cancelled).toBe(3);
    expect(base.calls.sizes).toEqual([1, 1, 1]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { blocked: 1, preparing: 0 },
    });
  } finally {
    await app.close();
  }
  const off = setup({ count: 1, provider });
  try {
    await off.drain(2);
    off.study.setPreferences({ automaticPreparation: "off" });
    off.clock.set("2026-11-08T10:16:00.000Z");
    await off.drain(4);
    expect(cancelled).toBe(3);
    expect(base.calls.sizes).toEqual([1, 1, 1, 1]);
  } finally {
    await off.close();
  }
});

test("completion racing queued cancellation preserves the result without another dispatch", async () => {
  const base = providerFixture(),
    batch = base.provider.batch;
  if (!batch) throw Error("No batch");
  const app = setup({
    count: 1,
    provider: {
      ...base.provider,
      batch: {
        ...batch,
        poll: async () => ok({ status: "pending", phase: "queued" }),
        cancel: (...args) => batch.poll(...args),
      },
    },
  });
  try {
    await app.drain(2);
    app.clock.set("2026-11-08T10:16:00.000Z");
    await app.drain(5);
    expect(base.calls.sizes).toEqual([1]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { ready: 1, blocked: 0 },
    });
  } finally {
    await app.close();
  }
});

test("a manual retry counts as preparing while its previous cooldown is still present", async () => {
  const app = setup({ count: 1 });
  try {
    const id = app.input().card.id;
    const raw = new Database(app.path);
    raw
      .query("INSERT INTO review_batch_cooldown(card_id,failed_at) VALUES (?,?)")
      .run(id, app.clock.now().toISOString());
    raw.close();
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { blocked: 1, preparing: 0 },
    });
    expect((await app.runner.request("manual")).ok).toBe(true);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { blocked: 0, preparing: 1 },
    });
    await app.drain(5);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { blocked: 0, preparing: 0, ready: 1 },
    });
  } finally {
    await app.close();
  }
});

test("corrected Card content can clear only that Card's prior failure cooldown", async () => {
  const app = setup({ count: 2 });
  try {
    const due = app.study.duePreparationSnapshot();
    if (!due.ok || !due.value.due[0] || !due.value.due[1])
      throw Error("No fixture cards");
    const first = due.value.due[0].card,
      second = due.value.due[1].card;
    const raw = new Database(app.path);
    for (const card of [first, second])
      raw
        .query("INSERT INTO review_batch_cooldown(card_id,failed_at) VALUES (?,?)")
        .run(card.id, app.clock.now().toISOString());
    raw.close();
    expect(
      app.study.updateCard(first.id, { ...first.content, meaning: "corrected meaning" })
        .ok,
    ).toBe(true);
    expect(app.material.resetPreparationFailure(first.id).ok).toBe(true);
    await app.drain(5);
    expect(app.calls.sizes).toEqual([1]);
    expect(app.runner.status()).toMatchObject({
      ok: true,
      value: { ready: 1, blocked: 1 },
    });
  } finally {
    await app.close();
  }
});

test("obsolete uncertain work releases claims without deleting remote recovery evidence", async () => {
  const app = setup({ count: 1 });
  try {
    const input = app.input(),
      begun = await app.runner.request("manual");
    if (!begun.ok) throw Error("No batch");
    const raw = new Database(app.path);
    raw
      .query(
        "INSERT INTO review_batch_job(batch_id,job_id,dispatched_at,phase) VALUES (?,'retained-provider-id',?,'uncertain')",
      )
      .run(begun.value.batchId, app.clock.now().toISOString());
    raw.close();
    app.study.setCardState({ cardId: input.card.id, action: "suspend" });
    await app.drain(4);
    expect(app.calls.sizes).toEqual([]);
    expect(app.material.preparationState()).toMatchObject({
      ok: true,
      value: { uncertainCardIds: [], uncertainBatches: [] },
    });
    const check = new Database(app.path, { readonly: true });
    expect(
      check
        .query("SELECT job_id FROM review_batch_job WHERE batch_id=?")
        .get(begun.value.batchId),
    ).toEqual({ job_id: "retained-provider-id" });
    check.close();
  } finally {
    await app.close();
  }
});

test("a named cache miss behind an active group is durably queued and finishes without another client request", async () => {
  const app = setup({ count: 25 });
  try {
    const first = await app.runner.request("manual");
    if (!first.ok) throw Error("No batch");
    await app.runner.tick();
    const queue = app.study.duePreparationSnapshot();
    if (!queue.ok) throw Error("No queue");
    const target = queue.value.due[24]?.card;
    if (!target) throw Error("No last Card");
    const second = await app.runner.requestCard(target.id);
    if (!second.ok) throw Error(second.error.kind);
    expect(second.value.batchId).not.toBe(first.value.batchId);
    const repeated = await app.runner.requestCard(target.id);
    expect(repeated).toEqual(second);
    await app.drain(12);
    expect(app.calls.sizes).toEqual([20, 5]);
    const ready = await app.material.prepare(app.input(target.id));
    expect(ready.ok).toBe(true);
  } finally {
    await app.close();
  }
}, 15_000);
