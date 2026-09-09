import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildZip,
  episodeOne,
  episodeTwo,
} from "../../tests/fixtures/preparation/subtitles.ts";
import {
  mutableClock,
  sequentialIds,
  testPermitVerifier,
  testSeed,
} from "../../tests/support/study.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { declaredGrammarDetector } from "../learning-material/declared-grammar.ts";
import { err } from "../result.ts";
import { openStudy } from "../study/study.ts";
import type { BatchProvider } from "./batching-contracts.ts";
import { createDeterministicPreparationProvider } from "./deterministic-provider.ts";
import { createSubtitleImportInspector } from "./import.ts";
import {
  asSubtitleSetId,
  type ImportInput,
  phase3ImportPolicy,
} from "./import-contracts.ts";
import { openPreparation } from "./preparation.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);

type TestProvider = BatchProvider & { readonly submissions: string[] };

const setup = (providerOverride?: TestProvider) => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-preparation-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  const clock = mutableClock("2026-09-08T00:00:00.000Z");
  const ids = sequentialIds();
  const provider = providerOverride ?? createDeterministicPreparationProvider();
  const study = openStudy({
    databasePath,
    clock: clock.now,
    nextId: ids,
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
  });
  if (!study.ok) throw new Error(study.error.kind);
  const open = () =>
    openPreparation({
      databasePath,
      clock: clock.now,
      nextId: ids,
      nextToken: ids,
      importPolicy: phase3ImportPolicy,
      inspector: createSubtitleImportInspector(phase3ImportPolicy),
      analyzer,
      grammar: declaredGrammarDetector,
      provider,
      providerConfigured: () => true,
      batchSize: 1,
    });
  const preparation = open();
  if (!preparation.ok) throw new Error(preparation.error.kind);
  return {
    databasePath,
    clock,
    ids,
    provider,
    study: study.value,
    preparation: preparation.value,
    open,
  };
};

const direct: ImportInput = {
  mode: "direct",
  files: [
    { name: "show-01.srt", bytes: encode(episodeOne) },
    { name: "show-02.srt", bytes: encode(episodeTwo) },
  ],
};

const archive: ImportInput = {
  mode: "zip",
  archive: {
    name: "show.zip",
    bytes: buildZip([
      { name: "show-01.srt", text: episodeOne },
      { name: "show-02.srt", text: episodeTwo },
    ]),
  },
};

const commit = async (
  preparation: ReturnType<typeof setup>["preparation"],
  input: ImportInput,
  operationKey: string,
) => {
  const report = await preparation.inspectImport(input);
  if (!report.ok) throw new Error(report.error.kind);
  const result = preparation.commitImport({
    pendingImportToken: report.value.pendingImportToken,
    operationKey,
    title: "Shirokuma fixture",
    episodes: report.value.entries.flatMap((entry) =>
      entry.outcome === "accepted"
        ? [{ entryId: entry.entryId, title: entry.inferredTitle }]
        : [],
    ),
  });
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
};

const analyze = async (context: ReturnType<typeof setup>, subtitleSetId: string) => {
  const study = context.study.preparationSnapshot();
  if (!study.ok) throw new Error(study.error.kind);
  const preflight = await context.preparation.preflight(
    asSubtitleSetId(subtitleSetId),
    study.value,
  );
  if (!preflight.ok) throw new Error(preflight.error.kind);
  const result = await context.preparation.analyze({
    preflightToken: preflight.value.token,
  });
  if (!result.ok) throw new Error(result.error.kind);
  return { preflight: preflight.value, result: result.value };
};

const studyRows = (databasePath: string): Record<string, readonly unknown[]> => {
  const database = new Database(databasePath, { readonly: true });
  try {
    return Object.fromEntries(
      [
        "card",
        "identity_claim",
        "card_progress",
        "schedule",
        "admission_event",
        "review_event",
      ].map((table) => [
        table,
        database.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
  } finally {
    database.close();
  }
};

describe("Preparation deep module", () => {
  test("commits idempotently and persists source order across reopen", async () => {
    const context = setup();
    const set = await commit(context.preparation, direct, "import-one");
    const report = await context.preparation.inspectImport(direct);
    if (!report.ok) throw new Error(report.error.kind);
    const duplicateCommit = context.preparation.commitImport({
      pendingImportToken: report.value.pendingImportToken,
      operationKey: "import-one",
      title: "ignored after a lost response",
      episodes: [],
    });
    expect(duplicateCommit.ok && duplicateCommit.value.id).toBe(set.id);
    context.preparation.close();
    const reopened = context.open();
    if (!reopened.ok) throw new Error(reopened.error.kind);
    const loaded = reopened.value.getSubtitleSet(set.id);
    expect(loaded.ok && loaded.value.episodes.map((episode) => episode.title)).toEqual([
      "show-01",
      "show-02",
    ]);
    reopened.value.close();
    context.study.close();
  }, 15_000);

  test("builds a complete gap, subtracts known words, and aggregates evidence", async () => {
    const context = setup();
    const existing = context.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "行く",
        reading: "いく",
        partOfSpeech: "verb",
        meaning: "fixture meaning for 行く",
        usageNotes: "",
      },
    });
    expect(existing.ok).toBe(true);
    const known = context.study.createCard({
      type: "vocabulary",
      content: {
        lemma: "料理",
        reading: "りょうり",
        partOfSpeech: "noun",
        meaning: "fixture meaning for 料理",
        usageNotes: "",
      },
    });
    if (!known.ok) throw new Error(known.error.kind);
    expect(
      context.study.setCardState({ cardId: known.value.card.id, action: "markKnown" })
        .ok,
    ).toBe(true);
    const set = await commit(context.preparation, direct, "import-gap");
    const analyzed = await analyze(context, set.id);
    expect(analyzed.result.state).toBe("complete");
    expect(analyzed.preflight.estimatedRequests).toBe(4);
    expect(context.provider.submissions).toHaveLength(4);
    expect(analyzed.result.completedBatches).toBe(analyzed.preflight.estimatedRequests);
    expect(analyzed.result.usage.inputTokens).toBe(40);
    expect(analyzed.result.counts.known).toBeGreaterThan(0);
    expect(analyzed.result.counts.existing).toBeGreaterThan(0);
    expect(analyzed.result.counts.gap).toBeGreaterThan(0);
    const cafe = analyzed.result.findings.find((item) => item.lemma === "カフェ");
    expect(cafe?.occurrenceCount).toBe(2);
    expect(cafe?.episodeCount).toBe(2);
    expect(cafe?.classification).toBe("required");

    const repeated = await analyze(context, set.id);
    expect(repeated.result.state).toBe("complete");
    expect(context.provider.submissions).toHaveLength(4);
    context.preparation.close();
    context.study.close();
  }, 15_000);

  test("subtracts a baseline word by lexical identity despite a different gloss", async () => {
    const context = setup();
    const input: ImportInput = {
      mode: "direct",
      files: [
        {
          name: "dog.srt",
          bytes: encode(`1\n00:00:01,000 --> 00:00:03,000\n犬が食べている。\n`),
        },
      ],
    };
    const set = await commit(context.preparation, input, "baseline-lexical");
    const analyzed = await analyze(context, set.id);
    expect(analyzed.result.findings.find((item) => item.lemma === "犬")).toMatchObject({
      relation: "known",
      meaning: "domestic dog",
    });
    context.preparation.close();
    context.study.close();
  }, 15_000);

  test("matches a captured Card by stable sense identity after its display gloss changes", async () => {
    const context = setup();
    const captured = context.study.captureVocabulary({
      operationKey: "capture-panda",
      card: {
        type: "vocabulary",
        content: {
          lemma: "パンダ",
          reading: "パンダ",
          partOfSpeech: "noun",
          meaning: "a black-and-white bear",
          usageNotes: "A deliberately different display gloss.",
        },
      },
      identityClaim: {
        authority: "gafu-capture-v1",
        claimKey: `vocabulary:${JSON.stringify([
          "パンダ",
          "ぱんだ",
          "noun",
          "fixture:パンダ:ぱんだ:1",
        ])}`,
      },
      evidence: {
        sourceKey: "episode:panda",
        cueKey: "cue:panda:1",
        selectedSurface: "パンダ",
        span: { start: 0, end: 3 },
      },
    });
    expect(captured.ok).toBe(true);
    const set = await commit(context.preparation, direct, "captured-identity");
    const analyzed = await analyze(context, set.id);
    expect(
      analyzed.result.findings.find((item) => item.lemma === "パンダ"),
    ).toMatchObject({
      relation: "existing",
      existingCardId: captured.ok ? captured.value.card.id : null,
      meaning: "fixture meaning for パンダ",
    });
    context.preparation.close();
    context.study.close();
  }, 15_000);

  test("direct and ZIP imports produce equivalent findings", async () => {
    const context = setup();
    const directSet = await commit(context.preparation, direct, "direct");
    const zipSet = await commit(context.preparation, archive, "zip");
    const directResult = await analyze(context, directSet.id);
    const zipResult = await analyze(context, zipSet.id);
    const summarize = (items: typeof directResult.result.findings) =>
      items.map((item) => ({
        key: item.key,
        type: item.type,
        canonicalKey: item.canonicalKey,
        relation: item.relation,
        occurrenceCount: item.occurrenceCount,
        episodeCount: item.episodeCount,
        priority: item.priority,
      }));
    expect(summarize(zipResult.result.findings)).toEqual(
      summarize(directResult.result.findings),
    );
    context.preparation.close();
    context.study.close();
  }, 15_000);

  test("resumes an uncertain paid batch from SQLite without resubmitting it", async () => {
    const base = createDeterministicPreparationProvider();
    let interruptOnce = true;
    const provider: TestProvider = {
      identity: base.identity,
      submissions: base.submissions,
      submit: async (batch, key, signal) => {
        const submitted = await base.submit(batch, key, signal);
        if (interruptOnce && submitted.ok) {
          interruptOnce = false;
          return err({ kind: "timeout", detail: "response was lost" });
        }
        return submitted;
      },
      retrieve: base.retrieve,
    };
    const context = setup(provider);
    const set = await commit(context.preparation, direct, "resume");
    const study = context.study.preparationSnapshot();
    if (!study.ok) throw new Error(study.error.kind);
    const firstPreflight = await context.preparation.preflight(set.id, study.value);
    if (!firstPreflight.ok) throw new Error(firstPreflight.error.kind);
    const interrupted = await context.preparation.analyze({
      preflightToken: firstPreflight.value.token,
    });
    expect(interrupted.ok && interrupted.value.state).toBe("paused");
    expect(interrupted.ok && interrupted.value.possibleDuplicateCharge).toBe(true);
    expect(provider.submissions).toHaveLength(1);

    context.preparation.close();
    const reopened = context.open();
    if (!reopened.ok) throw new Error(reopened.error.kind);
    const resumePreflight = await reopened.value.preflight(set.id, study.value);
    if (!resumePreflight.ok) throw new Error(resumePreflight.error.kind);
    const resumed = await reopened.value.analyze({
      preflightToken: resumePreflight.value.token,
    });
    expect(resumed.ok && resumed.value.state).toBe("complete");
    expect(provider.submissions).toHaveLength(resumePreflight.value.estimatedRequests);
    reopened.value.close();
    context.study.close();
  }, 15_000);

  test("invalid complete evidence is discarded so a fresh preflight can retry", async () => {
    const base = createDeterministicPreparationProvider();
    let corrupt = true;
    const provider: TestProvider = {
      identity: base.identity,
      submissions: base.submissions,
      submit: async (batch, key, signal) => {
        const result = await base.submit(batch, key, signal);
        return result.ok && corrupt
          ? { ...result, value: { ...result.value, candidates: [] } }
          : result;
      },
      retrieve: base.retrieve,
    };
    const context = setup(provider);
    const set = await commit(context.preparation, direct, "invalid-retry");
    const study = context.study.preparationSnapshot();
    if (!study.ok) throw new Error(study.error.kind);
    const first = await context.preparation.preflight(set.id, study.value);
    if (!first.ok) throw new Error(first.error.kind);
    const failed = await context.preparation.analyze({
      preflightToken: first.value.token,
    });
    expect(failed.ok && failed.value.state).toBe("failed");
    expect(
      await context.preparation.analyze({ preflightToken: first.value.token }),
    ).toEqual({ ok: false, error: { kind: "stalePreflight" } });

    corrupt = false;
    const retry = await context.preparation.preflight(set.id, study.value);
    if (!retry.ok) throw new Error(retry.error.kind);
    expect(retry.value.completedRequests).toBe(0);
    const completed = await context.preparation.analyze({
      preflightToken: retry.value.token,
    });
    expect(completed.ok && completed.value.state).toBe("complete");
    context.preparation.close();
    context.study.close();
  }, 15_000);

  test("corrections persist and deletion cannot remove Study Cards", async () => {
    const context = setup();
    const card = context.study.createCard({
      type: "grammar",
      content: {
        canonicalForm: "〜てもいい",
        meaning: "may",
        formation: "て-form + もいい",
        usageNotes: "",
      },
    });
    if (!card.ok) throw new Error(card.error.kind);
    const studyBefore = studyRows(context.databasePath);
    const set = await commit(context.preparation, direct, "correct-delete");
    const analyzed = await analyze(context, set.id);
    const target = analyzed.result.findings.find((item) => item.relation === "missing");
    if (target === undefined) throw new Error("fixture has no missing finding");
    const corrected = context.preparation.correct({
      subtitleSetId: set.id,
      findingKey: target.key,
      classification: "incidental",
      disposition: "defer",
      knownForSet: true,
    });
    expect(corrected.ok).toBe(true);
    expect(
      corrected.ok
        ? corrected.value.findings.find((item) => item.key === target.key)
        : null,
    ).toMatchObject({
      classification: "incidental",
      disposition: "defer",
      relation: "known",
    });
    const restored = context.preparation.correct({
      subtitleSetId: set.id,
      findingKey: target.key,
      knownForSet: false,
      meaning: "corrected fixture meaning",
      senseId: "learner:corrected:1",
    });
    expect(restored.ok).toBe(true);
    expect(
      restored.ok
        ? restored.value.findings.find((item) => item.key === target.key)
        : null,
    ).toMatchObject({
      meaning: "corrected fixture meaning",
      senseId: "learner:corrected:1",
      relation: target.originalRelation,
      knownForSet: false,
    });
    expect(restored.ok && restored.value.comparisonStale).toBe(true);
    const currentStudy = context.study.preparationSnapshot();
    if (!currentStudy.ok) throw new Error(currentStudy.error.kind);
    const recomputed = context.preparation.recompare(set.id, currentStudy.value);
    expect(recomputed.ok && recomputed.value.comparisonStale).toBe(false);
    context.preparation.close();
    const reopened = context.open();
    if (!reopened.ok) throw new Error(reopened.error.kind);
    const page = reopened.value.evidence({
      subtitleSetId: set.id,
      findingKey: target.key,
      offset: 0,
      limit: 1,
    });
    expect(page.ok && page.value.total).toBeGreaterThan(0);
    expect(reopened.value.deleteSubtitleSet(set.id, "delete")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(studyRows(context.databasePath)).toEqual(studyBefore);
    const cards = context.study.listCards();
    expect(cards.ok && cards.value.some((item) => item.id === card.value.card.id)).toBe(
      true,
    );
    reopened.value.close();
    context.study.close();
  }, 15_000);
});
