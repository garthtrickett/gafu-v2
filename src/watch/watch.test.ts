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
import type { JapaneseAnalyzer } from "../analysis/contracts.ts";
import { err, ok } from "../result.ts";
import { openStudy } from "../study/study.ts";
import { createWatch } from "./watch.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const analyzer: JapaneseAnalyzer = {
  name: "capture-fixture",
  analyze: async (cueId, rawText) =>
    ok({
      cueId,
      rawText,
      normalizedText: rawText,
      normalization: "nfkc-v1",
      spanUnit: "utf16-code-unit",
      rawBoundaryByNormalizedCodeUnit: Array.from(
        { length: rawText.length + 1 },
        (_, index) => index,
      ),
      tokens: [
        {
          surface: "食べた",
          lemma: "食べる",
          reading: "タベル",
          partOfSpeech: ["動詞"],
          broadPartOfSpeech: "verb",
          conjugation: "past",
          span: {
            start: 0,
            end: 3,
            unit: "utf16-code-unit",
            normalization: "nfkc-v1",
          },
          dictionaryFormFound: true,
          senseCandidates: [],
        },
        {
          surface: "猫",
          lemma: "猫",
          reading: "ネコ",
          partOfSpeech: ["名詞"],
          broadPartOfSpeech: "noun",
          conjugation: null,
          span: {
            start: 3,
            end: 4,
            unit: "utf16-code-unit",
            normalization: "nfkc-v1",
          },
          dictionaryFormFound: true,
          senseCandidates: [],
        },
      ],
    }),
};

const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-watch-"));
  directories.push(directory);
  const databasePath = join(directory, "study.sqlite");
  const clock = mutableClock("2026-09-08T08:00:00.000Z");
  const ids = sequentialIds();
  const study = openStudy({
    databasePath,
    clock: clock.now,
    nextId: ids,
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
  });
  if (!study.ok) throw new Error(study.error.kind);
  const watch = createWatch({
    analyzer,
    clock: clock.now,
    nextToken: ids,
    captureVocabulary: study.value.captureVocabulary,
    pendingTtlMs: 10 * 60 * 1_000,
    maximumPending: 4,
  });
  return { study: study.value, watch, clock, databasePath };
};

const resolve = (
  watch: ReturnType<typeof setup>["watch"],
  selectedSpan = { start: 0, end: 3 },
) =>
  watch.resolve({
    sourceVersion: "watch-source-v1",
    episodeKey: "episode-one",
    cueKey: "cue-one",
    cueStartMs: 1_000,
    cueEndMs: 2_000,
    cueText: "食べた猫",
    selectedSurface: "食べた猫".slice(selectedSpan.start, selectedSpan.end),
    selectedSpan,
  });

describe("Watch capture", () => {
  test("resolves an inflection and atomically creates one staged Vocabulary Card", async () => {
    const context = setup();
    const resolution = await resolve(context.watch);
    if (!resolution.ok) throw new Error(resolution.error.kind);
    expect(resolution.value.candidates).toMatchObject([
      { lemma: "食べる", reading: "タベル", partOfSpeech: "verb" },
    ]);
    const committed = context.watch.commit({
      token: resolution.value.token,
      candidateKey: resolution.value.candidates[0]?.key ?? "",
      meaning: "to eat",
      senseId: resolution.value.candidates[0]?.suggestedSenseId ?? "",
      operationKey: "capture-one",
    });
    expect(committed).toMatchObject({ ok: true, value: { outcome: "created" } });
    expect(context.study.listCards()).toMatchObject({
      ok: true,
      value: [{ type: "vocabulary", state: "staged", content: { lemma: "食べる" } }],
    });
    expect(context.study.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 1 },
    });
    context.study.close();
  });

  test("requires an explicit candidate and expires without writing", async () => {
    const context = setup();
    const resolution = await resolve(context.watch, { start: 0, end: 4 });
    if (!resolution.ok) throw new Error(resolution.error.kind);
    expect(resolution.value.candidates).toHaveLength(2);
    expect(
      context.watch.commit({
        token: resolution.value.token,
        candidateKey: "not-a-candidate",
        meaning: "x",
        senseId: "x",
        operationKey: "bad-choice",
      }),
    ).toEqual({ ok: false, error: { kind: "captureCandidateMissing" } });
    context.clock.set("2026-09-08T08:11:00.000Z");
    expect(
      context.watch.commit({
        token: resolution.value.token,
        candidateKey: resolution.value.candidates[0]?.key ?? "",
        meaning: "to eat",
        senseId: "local:eat",
        operationKey: "expired",
      }),
    ).toEqual({ ok: false, error: { kind: "pendingCaptureExpired" } });
    expect(context.study.listCards()).toEqual({ ok: true, value: [] });
    context.study.close();
  });

  test("deduplicates Card and cue evidence across operation retries", async () => {
    const context = setup();
    const first = await resolve(context.watch);
    if (!first.ok) throw new Error(first.error.kind);
    const candidate = first.value.candidates[0];
    if (candidate === undefined) throw new Error("candidate missing");
    const command = {
      token: first.value.token,
      candidateKey: candidate.key,
      meaning: "to eat",
      senseId: candidate.suggestedSenseId,
      operationKey: "same-operation",
    };
    const committed = context.watch.commit(command);
    expect(committed).toMatchObject({
      ok: true,
      value: { outcome: "created", evidenceAdded: true },
    });
    expect(context.watch.commit(command)).toEqual(committed);
    expect(
      context.watch.commit({ ...command, meaning: "a changed retry" }),
    ).toMatchObject({ ok: false, error: { kind: "invalidCaptureIdentity" } });
    const database = new Database(context.databasePath, { readonly: true });
    expect(
      database.query("SELECT count(*) AS count FROM subtitle_capture_evidence").get(),
    ).toEqual({ count: 1 });
    expect(database.query("SELECT count(*) AS count FROM card").get()).toEqual({
      count: 1,
    });
    database.close();
    context.study.close();
  });

  test("converts thrown analyzer and token dependencies into typed failures", async () => {
    const context = setup();
    const analyzerFailure = createWatch({
      analyzer: {
        name: "throwing-analyzer",
        analyze: async () => {
          throw new Error("adapter failed");
        },
      },
      clock: context.clock.now,
      nextToken: () => "unused",
      captureVocabulary: context.study.captureVocabulary,
      pendingTtlMs: 60_000,
      maximumPending: 4,
    });
    expect(await resolve(analyzerFailure)).toEqual({
      ok: false,
      error: { kind: "analyzerUnavailable" },
    });
    const tokenFailure = createWatch({
      analyzer,
      clock: context.clock.now,
      nextToken: () => {
        throw new Error("entropy failed");
      },
      captureVocabulary: context.study.captureVocabulary,
      pendingTtlMs: 60_000,
      maximumPending: 4,
    });
    expect(await resolve(tokenFailure)).toEqual({
      ok: false,
      error: { kind: "tokenFailed" },
    });
    context.study.close();
  });

  test("preserves the complete Study failure across the Watch boundary", async () => {
    const watch = createWatch({
      analyzer,
      clock: () => new Date("2026-09-08T08:00:00.000Z"),
      nextToken: () => "capture-token",
      captureVocabulary: () =>
        err({ kind: "identityConflict", existingCardId: "existing-card" }),
      pendingTtlMs: 60_000,
      maximumPending: 4,
    });
    const resolution = await resolve(watch);
    if (!resolution.ok) throw new Error(resolution.error.kind);
    const candidate = resolution.value.candidates[0];
    if (candidate === undefined) throw new Error("candidate missing");
    expect(
      watch.commit({
        token: resolution.value.token,
        candidateKey: candidate.key,
        meaning: "to eat",
        senseId: candidate.suggestedSenseId,
        operationKey: "failed-capture",
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "studyFailure",
        failure: { kind: "identityConflict", existingCardId: "existing-card" },
      },
    });
  });
});
