import { describe, expect, test } from "bun:test";
import {
  batchingCandidates,
  batchingCues,
} from "../../tests/fixtures/preparation/batching.ts";
import { createDeterministicBatchProvider } from "../../tests/support/deterministic-batch-provider.ts";
import { createPreparationBatching } from "./batching.ts";
import type {
  AnalysisManifest,
  BatchCheckpoint,
  ProviderFailure,
} from "./batching-contracts.ts";
import { createInMemoryCheckpointStore } from "./in-memory-checkpoint-store.ts";
import { mergeCompletedBatches } from "./merge.ts";

const setup = (
  options: Parameters<typeof createDeterministicBatchProvider>[1] = {},
) => {
  const provider = createDeterministicBatchProvider(batchingCandidates, options);
  const store = createInMemoryCheckpointStore();
  return {
    provider,
    store,
    batching: createPreparationBatching({
      provider,
      store,
      normalizationVersion: "nfkc-v1",
      analyzerVersion: "kuromoji-ipadic-v1",
    }),
  };
};

describe("complete resumable preparation batching", () => {
  test("creates stable content-derived manifests and estimates scope", async () => {
    const { batching } = setup();
    const first = await batching.createManifest(batchingCues, 3);
    const second = await batching.createManifest(batchingCues, 3);
    expect(first).toEqual(second);
    expect(first.runId).toStartWith("run-v1:sha256:");
    expect(first.batches).toHaveLength(4);
    expect(new Set(first.batches.map((batch) => batch.inputDigest)).size).toBe(4);
    expect(first.estimatedRequests).toBe(4);
    expect(first.estimatedInputBytes).toBeGreaterThan(0);
  });

  test("one batch and many batches merge to the same complete result", async () => {
    const one = setup();
    const many = setup();
    const oneResult = await one.batching.analyze(
      await one.batching.createManifest(batchingCues, batchingCues.length),
    );
    const manyResult = await many.batching.analyze(
      await many.batching.createManifest(batchingCues, 3),
    );
    expect(oneResult.state).toBe("complete");
    expect(manyResult.state).toBe("complete");
    expect(manyResult.merged).toEqual(oneResult.merged);
    expect(
      manyResult.merged?.some(
        (candidate) => candidate.canonicalKey === "最終目標:さいしゅうもくひょう",
      ),
    ).toBe(true);
  });

  test("merge order is stable and duplicate evidence is removed", async () => {
    const { batching } = setup();
    const complete = await batching.analyze(
      await batching.createManifest(batchingCues, 3),
    );
    const completed = complete.batches.filter(
      (batch): batch is Extract<BatchCheckpoint, { state: "completed" }> =>
        batch.state === "completed",
    );
    const expected = mergeCompletedBatches(completed);
    for (let seed = 1; seed <= 40; seed += 1) {
      const shuffled = [...completed].sort(
        (left, right) =>
          ((left.inputDigest.charCodeAt(seed % left.inputDigest.length) * seed) % 7) -
          ((right.inputDigest.charCodeAt(seed % right.inputDigest.length) * seed) % 7),
      );
      expect(
        mergeCompletedBatches([...shuffled, shuffled[0] as BatchCheckpoint]),
      ).toEqual(expected);
    }
  });

  test("recovers a provider-accepted timeout through retrieval", async () => {
    const timeout: ProviderFailure = { kind: "timeout", detail: "injected" };
    const context = setup({
      failure: { batchId: "batch-0002", failure: timeout, afterAccept: true },
    });
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const interrupted = await context.batching.analyze(manifest);
    expect(interrupted.state).toBe("paused");
    expect(interrupted.failure?.kind).toBe("timeout");
    const resumed = await createPreparationBatching({
      provider: context.provider,
      store: context.store,
      normalizationVersion: "nfkc-v1",
      analyzerVersion: "kuromoji-ipadic-v1",
    }).analyze(manifest);
    expect(resumed.state).toBe("complete");
    expect(context.provider.chargedRequests).toBe(4);
    expect(context.provider.submissions).toHaveLength(4);
    expect(context.provider.retrievals).toHaveLength(1);
  });

  test("a failure before the request leaves a safe pending batch", async () => {
    const context = setup();
    context.store.failNext("requested");
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const interrupted = await context.batching.analyze(manifest);
    expect(interrupted.state).toBe("paused");
    expect(interrupted.batches[0]?.state).toBe("pending");
    expect(context.provider.submissions).toHaveLength(0);
    const resumed = await context.batching.analyze(manifest);
    expect(resumed.state).toBe("complete");
    expect(context.provider.submissions).toHaveLength(4);
  });

  test("recovers a failed completion commit without reissuing the provider call", async () => {
    const context = setup();
    context.store.failNext("complete");
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const interrupted = await context.batching.analyze(manifest);
    expect(interrupted.state).toBe("paused");
    expect(interrupted.batches[0]?.state).toBe("uncertain");
    const submissions = context.provider.submissions.length;
    const resumed = await context.batching.analyze(manifest);
    expect(resumed.state).toBe("complete");
    expect(context.provider.submissions).toHaveLength(submissions + 3);
    expect(context.provider.retrievals).toHaveLength(1);
  });

  test("an unretrievable uncertain request requires an explicit charged retry", async () => {
    const offline: ProviderFailure = { kind: "offline", detail: "injected" };
    const context = setup({
      failure: { batchId: "batch-0001", failure: offline, afterAccept: false },
      retrievalAvailable: false,
    });
    const manifest = await context.batching.createManifest(batchingCues, 3);
    expect((await context.batching.analyze(manifest)).state).toBe("paused");
    const awaitingDecision = await context.batching.analyze(manifest);
    expect(awaitingDecision.state).toBe("paused");
    expect(awaitingDecision.failure).toBeNull();
    expect(awaitingDecision.possibleDuplicateCharge).toBe(true);
    const resumed = await context.batching.analyze(manifest, {
      retryUncertain: true,
    });
    expect(resumed.state).toBe("complete");
  });

  test("a timeout after dispatch resumes by retrieval instead of stalling", async () => {
    // The production shape: the provider accepted the request and is billing
    // for it, but the wait for output was cut short. Three rounds of retrying
    // must make progress rather than returning the same paused snapshot.
    const timeout: ProviderFailure = { kind: "timeout", detail: "injected" };
    const context = setup({
      failure: { batchId: "batch-0001", failure: timeout, afterAccept: true },
    });
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const interrupted = await context.batching.analyze(manifest);
    expect(interrupted.state).toBe("paused");
    expect(interrupted.failure?.kind).toBe("timeout");
    expect(interrupted.batches[0]?.state).toBe("uncertain");
    // Nothing to decide: the dispatched request can simply be read back.
    expect(interrupted.possibleDuplicateCharge).toBe(false);

    const resumed = await context.batching.analyze(manifest);
    expect(resumed.state).toBe("complete");
    expect(context.provider.retrievals).toHaveLength(1);
    // The interrupted batch was recovered, not bought a second time.
    expect(context.provider.chargedRequests).toBe(4);
  });

  test("an interrupted batch is retrievable before its first poll", async () => {
    const context = setup();
    const manifest = await context.batching.createManifest(batchingCues, 3);
    await context.batching.analyze(manifest, { maxBatches: 1 });
    // markDispatched lands between markUncertain and the commit, so a crash at
    // any point after dispatch finds an id to resume from.
    const uncertainAt = context.store.history.findIndex((event) =>
      event.startsWith("uncertain:"),
    );
    const dispatchedAt = context.store.history.findIndex((event) =>
      event.startsWith("dispatched:"),
    );
    const completedAt = context.store.history.findIndex((event) =>
      event.startsWith("completed:"),
    );
    expect(uncertainAt).toBeLessThan(dispatchedAt);
    expect(dispatchedAt).toBeLessThan(completedAt);
  });

  test.each(["authentication", "permission", "rateLimit"] as const)(
    "a %s rejection is not a possible duplicate charge and does not latch",
    async (kind) => {
      // The provider refused to run the request, so nothing was generated and
      // nothing was billed. Warning about a second charge would be false, and
      // holding the batch dispatched would block every later batch.
      const context = setup({
        failure: {
          batchId: "batch-0001",
          failure: { kind, detail: "injected" },
          afterAccept: false,
        },
      });
      const manifest = await context.batching.createManifest(batchingCues, 3);
      const rejected = await context.batching.analyze(manifest);
      expect(rejected.state).toBe("paused");
      expect(rejected.failure?.kind).toBe(kind);
      expect(rejected.possibleDuplicateCharge).toBe(false);
      expect(rejected.batches[0]?.state).toBe("pending");

      // Fixing the cause needs no duplicate-charge decision.
      const resumed = await context.batching.analyze(manifest);
      expect(resumed.state).toBe("complete");
      expect(context.provider.chargedRequests).toBe(4);
    },
  );

  test("a rejected round keeps naming its cause instead of falling silent", async () => {
    const context = setup({
      failure: {
        batchId: "batch-0001",
        failure: { kind: "authentication", detail: "injected" },
        afterAccept: false,
      },
      alwaysFail: true,
    });
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const first = await context.batching.analyze(manifest);
    const second = await context.batching.analyze(manifest);
    expect(first.failure?.kind).toBe("authentication");
    // The old shape reported `null` here, which the UI showed as an unexplained
    // stall rather than as a rejected key.
    expect(second.failure?.kind).toBe("authentication");
    expect(second.possibleDuplicateCharge).toBe(false);
  });

  test("never reissues completed digests on a complete rerun", async () => {
    const context = setup();
    const manifest = await context.batching.createManifest(batchingCues, 3);
    expect((await context.batching.analyze(manifest)).state).toBe("complete");
    const submissions = [...context.provider.submissions];
    expect((await context.batching.analyze(manifest)).state).toBe("complete");
    expect(context.provider.submissions).toEqual(submissions);
    expect(
      context.store.history.findIndex((event) => event.startsWith("requested:")),
    ).toBeLessThan(
      context.store.history.findIndex((event) => event.startsWith("uncertain:")),
    );
  });

  test.each(["cueId", "span"] as const)(
    "invalid %s evidence fails its batch and cannot produce a merged result",
    async (kind) => {
      const context = setup({
        invalidEvidence: { batchId: "batch-0004", kind },
      });
      const result = await context.batching.analyze(
        await context.batching.createManifest(batchingCues, 3),
      );
      expect(result.state).toBe("failed");
      expect(result.failure?.kind).toBe("invalidCueEvidence");
      expect(result.merged).toBeNull();
      // Not left dispatched: a rejected response is billed but worthless, and
      // caching it would replay the same rejection on every resume.
      expect(result.batches.at(-1)?.state).toBe("pending");
    },
  );

  test("a rejected response is asked again instead of replayed", async () => {
    const context = setup({
      invalidEvidence: { batchId: "batch-0001", kind: "span" },
    });
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const first = await context.batching.analyze(manifest);
    expect(first.state).toBe("failed");
    // The detail names the offending cue, which the kind alone cannot.
    expect(first.failure?.detail).toContain("episode-1:001");

    const submissions = context.provider.submissions.length;
    const retrievals = context.provider.retrievals.length;
    const second = await context.batching.analyze(manifest);
    // The old shape retrieved the same invalid output and re-failed on it,
    // then demanded a duplicate-charge decision once retention expired.
    expect(context.provider.submissions.length).toBe(submissions + 1);
    expect(context.provider.retrievals.length).toBe(retrievals);
    expect(second.possibleDuplicateCharge).toBe(false);
  });

  test("rejects incompatible resume metadata", async () => {
    const context = setup();
    const manifest = await context.batching.createManifest(batchingCues, 3);
    await context.store.open(manifest);
    const incompatible: AnalysisManifest = {
      ...manifest,
      analyzerVersion: "a-different-analyzer",
    };
    const result = await context.batching.analyze(incompatible);
    expect(result.state).toBe("failed");
    expect(result.failure?.kind).toBe("incompatibleResumeMetadata");
  });

  test("cancellation is typed and leaves a resumable uncertain checkpoint", async () => {
    const context = setup();
    const controller = new AbortController();
    controller.abort();
    const result = await context.batching.analyze(
      await context.batching.createManifest(batchingCues, 3),
      { signal: controller.signal },
    );
    expect(result.state).toBe("paused");
    expect(result.failure?.kind).toBe("cancelled");
    expect(result.batches[0]?.state).toBe("uncertain");
  });

  test("maxBatches pauses cleanly and resumes without repaying", async () => {
    const context = setup();
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const first = await context.batching.analyze(manifest, { maxBatches: 2 });
    expect(first.state).toBe("paused");
    expect(first.failure).toBeNull();
    expect(first.possibleDuplicateCharge).toBe(false);
    expect(first.batches.filter((batch) => batch.state === "completed")).toHaveLength(
      2,
    );
    const resumed = await context.batching.analyze(manifest);
    expect(resumed.state).toBe("complete");
    expect(resumed.batches.filter((batch) => batch.state === "completed")).toHaveLength(
      4,
    );
    const reference = setup();
    const complete = await reference.batching.analyze(
      await reference.batching.createManifest(batchingCues, 3),
    );
    expect(resumed.merged).toEqual(complete.merged);
  });

  test("maxBatches covering every batch completes instead of pausing", async () => {
    const context = setup();
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const result = await context.batching.analyze(manifest, { maxBatches: 4 });
    expect(result.state).toBe("complete");
    expect(result.batches.filter((batch) => batch.state === "completed")).toHaveLength(
      4,
    );
  });

  test("non-positive maxBatches means no limit", async () => {
    const context = setup();
    const manifest = await context.batching.createManifest(batchingCues, 3);
    const result = await context.batching.analyze(manifest, { maxBatches: 0 });
    expect(result.state).toBe("complete");
  });
});
