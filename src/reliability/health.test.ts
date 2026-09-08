import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredGrammarDetector } from "../learning-material/declared-grammar.ts";
import { createDeterministicPreparationProvider } from "../preparation/deterministic-provider.ts";
import { createSubtitleImportInspector } from "../preparation/import.ts";
import { phase3ImportPolicy } from "../preparation/import-contracts.ts";
import { openPreparation } from "../preparation/preparation.ts";
import { err } from "../result.ts";
import { openStudy, unavailableKaishiSeed } from "../study/study.ts";
import { inspectHealth } from "./health.ts";

test("health reports only operational counts and flags unfinished preparation", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-health-"));
  try {
    const path = join(directory, "gafu.sqlite");
    const study = openStudy({
      databasePath: path,
      clock: () => new Date("2026-09-08T13:00:00.000Z"),
      nextId: () => "private-card-id",
      permitVerifier: {
        verify: () => err({ kind: "presentationInvalid", detail: "not used" }),
      },
      knownWordSeed: unavailableKaishiSeed,
    });
    if (!study.ok) throw new Error(study.error.kind);
    const created = study.value.createCard({
      type: "vocabulary",
      content: {
        lemma: "秘密語",
        reading: "ひみつご",
        meaning: "private fixture meaning",
        partOfSpeech: "noun",
        usageNotes: "private notes",
      },
    });
    if (!created.ok) throw new Error(created.error.kind);
    const preparation = openPreparation({
      databasePath: path,
      clock: () => new Date("2026-09-08T13:00:00.000Z"),
      nextId: () => "set-id",
      nextToken: () => "pending-token",
      importPolicy: phase3ImportPolicy,
      inspector: createSubtitleImportInspector(phase3ImportPolicy),
      analyzer: {
        name: "health-fixture",
        analyze: async () => err({ kind: "analyzerUnavailable", cause: "not used" }),
      },
      grammar: declaredGrammarDetector,
      provider: createDeterministicPreparationProvider(),
      providerConfigured: () => false,
      batchSize: 20,
    });
    if (!preparation.ok) throw new Error(preparation.error.kind);
    preparation.value.close();
    study.value.close();
    const database = new Database(path);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    database.close();

    const report = inspectHealth(path, false);
    expect(report).toMatchObject({
      ok: true,
      value: {
        status: "healthy",
        cards: { vocabulary: 1, grammar: 0, staged: 1 },
        providerKeyConfigured: false,
      },
    });
    expect(JSON.stringify(report)).not.toContain("秘密語");
    expect(JSON.stringify(report)).not.toContain("private fixture meaning");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("health failure", () => {
  test("returns a typed unhealthy result for a missing database", () => {
    expect(inspectHealth("/definitely/missing/gafu.sqlite", false)).toMatchObject({
      ok: false,
      error: {
        kind: "databaseUnhealthy",
        failure: { kind: "sourceMissing" },
      },
    });
  });
});
