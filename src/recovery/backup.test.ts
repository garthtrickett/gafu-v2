import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredGrammarDetector } from "../learning-material/declared-grammar.ts";
import {
  MATERIAL_SCHEMA_VERSION,
  openLearningMaterial,
} from "../learning-material/learning-material.ts";
import { createDeterministicMaterialProvider } from "../learning-material/scripted-provider.ts";
import { createDeterministicPreparationProvider } from "../preparation/deterministic-provider.ts";
import { createSubtitleImportInspector } from "../preparation/import.ts";
import { phase3ImportPolicy } from "../preparation/import-contracts.ts";
import {
  openPreparation,
  PREPARATION_SCHEMA_VERSION,
} from "../preparation/preparation.ts";
import { err, ok } from "../result.ts";
import type { KnownWordSeed } from "../study/contracts.ts";
import { openStudy, unavailableKaishiSeed } from "../study/study.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import { createBackupRecovery, inspectBackup } from "./backup.ts";
import { acquireDatabaseLock } from "./database-lock.ts";

const now = new Date("2026-09-08T12:00:00.000Z");

const completeBackup = (
  databasePath: string,
  cardId: string,
  knownWordSeed: KnownWordSeed = unavailableKaishiSeed,
): Uint8Array => {
  const study = openStudy({
    databasePath,
    clock: () => now,
    nextId: () => cardId,
    permitVerifier: {
      verify: () => err({ kind: "presentationInvalid", detail: "not used" }),
    },
    knownWordSeed,
    grammarTargetSupported: () => true,
  });
  if (!study.ok) throw new Error(study.error.kind);
  const card = study.value.createCard({
    type: "vocabulary",
    content: {
      lemma: "猫",
      reading: "ねこ",
      meaning: "cat",
      partOfSpeech: "noun",
      usageNotes: "",
    },
  });
  if (!card.ok) throw new Error(card.error.kind);
  const preparation = openPreparation({
    databasePath,
    clock: () => now,
    nextId: () => "set-one",
    nextToken: () => "token-one",
    importPolicy: phase3ImportPolicy,
    inspector: createSubtitleImportInspector(phase3ImportPolicy),
    analyzer: {
      name: "recovery-fixture",
      analyze: async () => err({ kind: "analyzerUnavailable", cause: "not used" }),
    },
    grammar: declaredGrammarDetector,
    provider: createDeterministicPreparationProvider(),
    providerConfigured: async () => true,
    batchSize: 20,
  });
  if (!preparation.ok) throw new Error(preparation.error.kind);
  preparation.value.close();
  const material = openLearningMaterial({
    databasePath,
    clock: () => now,
    nextId: () => "material-one",
    nextToken: () => "permit-one",
    provider: createDeterministicMaterialProvider(),
    keyCustody: createProviderKeyCustody({ verify: async () => ok(undefined) }),
    validate: async ({ value }) => ok(value as never),
    inspectionEnabled: false,
  });
  if (!material.ok) throw new Error(material.error.kind);
  material.value.close();
  const backup = study.value.exportBackup();
  study.value.close();
  if (!backup.ok) throw new Error(backup.error.kind);
  return backup.value.bytes;
};

describe("backup recovery", () => {
  test("inspects and restores a complete Study and Preparation database", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-recovery-"));
    try {
      const source = join(directory, "source.sqlite");
      const destination = join(directory, "destination.sqlite");
      writeFileSync(
        source,
        completeBackup(join(directory, "working.sqlite"), "card-a"),
      );
      writeFileSync(
        destination,
        completeBackup(join(directory, "old-working.sqlite"), "card-old"),
      );
      const inspected = inspectBackup(source);
      expect(inspected).toMatchObject({
        ok: true,
        value: {
          studySchemaVersion: 6,
          preparationSchemaVersion: PREPARATION_SCHEMA_VERSION,
          cardCount: 1,
          integrity: "ok",
          foreignKeys: "ok",
        },
      });
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "receipt",
      });
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: destination,
          confirmation: null,
        }),
      ).toEqual({ ok: false, error: { kind: "confirmationRequired" } });
      const restored = recovery.restore({
        sourcePath: source,
        destinationPath: destination,
        confirmation: "replace",
      });
      expect(restored).toMatchObject({
        ok: true,
        value: { inspection: { cardCount: 1 } },
      });
      if (!restored.ok) throw new Error(restored.error.kind);
      expect(restored.value.safetyCopyPath).not.toBeNull();
      expect(inspectBackup(destination)).toEqual(inspected);
      expect(inspectBackup(restored.value.safetyCopyPath ?? "")).toMatchObject({
        ok: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("restores into a clean destination without creating a safety copy", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-clean-recovery-"));
    try {
      const source = join(directory, "source.sqlite");
      const destination = join(directory, "new", "gafu.sqlite");
      writeFileSync(
        source,
        completeBackup(join(directory, "working.sqlite"), "card-a"),
      );
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "clean",
      });
      const restored = recovery.restore({
        sourcePath: source,
        destinationPath: destination,
        confirmation: "replace",
      });
      expect(restored).toMatchObject({
        ok: true,
        value: { safetyCopyPath: null },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("post-restore verification is read-only and preserves the seed ledger", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-readonly-recovery-"));
    try {
      const seed: KnownWordSeed = {
        id: "kaishi",
        version: "fixture-v1",
        availability: "available",
        entries: [
          {
            key: "cat",
            lemma: "猫",
            reading: "ねこ",
            meaning: "cat",
            partOfSpeech: "noun",
          },
        ],
      };
      const source = join(directory, "source.sqlite");
      const destination = join(directory, "destination.sqlite");
      writeFileSync(
        source,
        completeBackup(join(directory, "working.sqlite"), "card-a", seed),
      );
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "readonly",
      });
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toMatchObject({ ok: true });
      const database = new Database(destination, { readonly: true });
      expect(
        database
          .query("SELECT version, availability FROM seed_ledger WHERE seed_id = ?")
          .get("kaishi"),
      ).toEqual({ version: "fixture-v1", availability: "available" });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("leaves destination bytes untouched for corrupt and newer backups", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-rejected-recovery-"));
    try {
      const destination = join(directory, "destination.sqlite");
      writeFileSync(
        destination,
        completeBackup(join(directory, "working.sqlite"), "card-a"),
      );
      const before = readFileSync(destination);
      const corrupt = join(directory, "corrupt.sqlite");
      writeFileSync(corrupt, "not sqlite");
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "rejected",
      });
      expect(
        recovery.restore({
          sourcePath: corrupt,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toEqual({ ok: false, error: { kind: "invalidSqlite" } });
      expect(readFileSync(destination)).toEqual(before);

      const newer = join(directory, "newer.sqlite");
      writeFileSync(newer, before);
      const database = new Database(newer);
      database
        .query("INSERT INTO schema_migration(version, applied_at) VALUES (999, ?)")
        .run(now.toISOString());
      database.close();
      expect(
        recovery.restore({
          sourcePath: newer,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toMatchObject({
        ok: false,
        error: { kind: "unsupportedStudySchema", found: 999 },
      });
      expect(readFileSync(destination)).toEqual(before);

      const newerMaterial = join(directory, "newer-material.sqlite");
      writeFileSync(newerMaterial, before);
      const materialDatabase = new Database(newerMaterial);
      materialDatabase
        .query(
          "INSERT INTO learning_material_migration(version, applied_at) VALUES (999, ?)",
        )
        .run(now.toISOString());
      materialDatabase.close();
      expect(inspectBackup(newerMaterial)).toMatchObject({
        ok: false,
        error: { kind: "unsupportedLearningMaterialSchema", found: 999 },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a database that claims current migrations but lacks required tables", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-schema-recovery-"));
    try {
      const source = join(directory, "incomplete.sqlite");
      const database = new Database(source);
      for (const [table, version] of [
        ["schema_migration", 6],
        ["preparation_migration", PREPARATION_SCHEMA_VERSION],
        ["learning_material_migration", MATERIAL_SCHEMA_VERSION],
      ] as const) {
        database.exec(
          `CREATE TABLE ${table}(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
        );
        for (let current = 1; current <= version; current += 1) {
          database
            .query(`INSERT INTO ${table}(version, applied_at) VALUES (?, ?)`)
            .run(current, now.toISOString());
        }
      }
      database.close();
      expect(inspectBackup(source)).toEqual({
        ok: false,
        error: { kind: "invalidSqlite" },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects aliases, symlinks, live sidecars, and temporary-copy collisions", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-path-recovery-"));
    try {
      const source = join(directory, "source.sqlite");
      const destination = join(directory, "destination.sqlite");
      writeFileSync(
        source,
        completeBackup(join(directory, "working.sqlite"), "card-a"),
      );
      writeFileSync(
        destination,
        completeBackup(join(directory, "old-working.sqlite"), "card-old"),
      );
      const before = readFileSync(destination);
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "collision",
      });
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: source,
          confirmation: "replace",
        }),
      ).toEqual({ ok: false, error: { kind: "sameFile" } });
      const link = join(directory, "source-link.sqlite");
      symlinkSync(source, link);
      expect(inspectBackup(link)).toEqual({
        ok: false,
        error: { kind: "pathIsSymlink", role: "source" },
      });
      writeFileSync(`${destination}-wal`, "live marker");
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toEqual({ ok: false, error: { kind: "destinationInUse" } });
      rmSync(`${destination}-wal`);
      const lock = acquireDatabaseLock(destination);
      if (!lock.ok) throw new Error(lock.error);
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toEqual({ ok: false, error: { kind: "destinationInUse" } });
      lock.value.release();
      const temporary = join(directory, ".destination.sqlite.restore-collision.tmp");
      writeFileSync(temporary, "collision");
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toEqual({ ok: false, error: { kind: "copyFailed", operation: "temporary" } });
      expect(readFileSync(destination)).toEqual(before);
      expect(readFileSync(temporary).toString()).toBe("collision");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("reports a post-replacement failure with a usable safety copy", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-post-recovery-"));
    try {
      const source = join(directory, "source.sqlite");
      const destination = join(directory, "destination.sqlite");
      writeFileSync(
        source,
        completeBackup(join(directory, "working.sqlite"), "card-a"),
      );
      writeFileSync(
        destination,
        completeBackup(join(directory, "old-working.sqlite"), "card-old"),
      );
      const before = readFileSync(destination);
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "post-failure",
        postRestoreVerify: () => false,
      });
      const result = recovery.restore({
        sourcePath: source,
        destinationPath: destination,
        confirmation: "replace",
      });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "postRestoreFailed" },
      });
      if (result.ok || result.error.kind !== "postRestoreFailed") {
        throw new Error("expected a post-restore failure");
      }
      expect(result.error.safetyCopyPath).not.toBeNull();
      expect(inspectBackup(result.error.safetyCopyPath ?? "")).toMatchObject({
        ok: true,
      });
      expect(readFileSync(destination)).toEqual(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("removes a failed restore from a previously clean destination", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-clean-rollback-"));
    try {
      const source = join(directory, "source.sqlite");
      const destination = join(directory, "destination.sqlite");
      writeFileSync(
        source,
        completeBackup(join(directory, "working.sqlite"), "card-a"),
      );
      const recovery = createBackupRecovery({
        clock: () => now,
        nextToken: () => "clean-post-failure",
        postRestoreVerify: () => false,
      });
      expect(
        recovery.restore({
          sourcePath: source,
          destinationPath: destination,
          confirmation: "replace",
        }),
      ).toEqual({
        ok: false,
        error: { kind: "postRestoreFailed", safetyCopyPath: null },
      });
      expect(() => readFileSync(destination)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
