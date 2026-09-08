import { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  type Stats,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { declaredGrammarDetector } from "../learning-material/declared-grammar.ts";
import { createDeterministicPreparationProvider } from "../preparation/deterministic-provider.ts";
import { createSubtitleImportInspector } from "../preparation/import.ts";
import { phase3ImportPolicy } from "../preparation/import-contracts.ts";
import {
  openPreparation,
  PREPARATION_SCHEMA_VERSION,
} from "../preparation/preparation.ts";
import { err, ok, type Result } from "../result.ts";
import { STUDY_SCHEMA_VERSION } from "../study/migrations.ts";
import { openStudy, unavailableKaishiSeed } from "../study/study.ts";
import type {
  BackupInspection,
  BackupRecovery,
  RecoveryFailure,
  RestoreReceipt,
} from "./contracts.ts";
import { MAXIMUM_BACKUP_BYTES } from "./contracts.ts";

export type BackupRecoveryDependencies = Readonly<{
  clock: () => Date;
  nextToken: () => string;
  postRestoreVerify?: (path: string) => boolean;
}>;

const SQLITE_HEADER = "SQLite format 3\0";

const validFile = (
  path: string,
  role: "source" | "destination",
): Result<Stats, RecoveryFailure> => {
  if (path.trim() === "" || path === ":memory:") {
    return err({ kind: "invalidPath", role });
  }
  if (!existsSync(path)) {
    return role === "source"
      ? err({ kind: "sourceMissing" })
      : err({ kind: "invalidPath", role });
  }
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return err({ kind: "pathIsSymlink", role });
    if (!stat.isFile()) return err({ kind: "invalidPath", role });
    return ok(stat);
  } catch {
    return err({ kind: "invalidPath", role });
  }
};

const schemaVersion = (database: Database, table: string): number | null => {
  const exists = database
    .query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { present: number } | null;
  if (exists === null) return null;
  const row = database
    .query(`SELECT coalesce(max(version), 0) AS version FROM ${table}`)
    .get() as { version: number };
  return row.version;
};

const tableCount = (database: Database, table: string): number => {
  const exists = database
    .query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { present: number } | null;
  if (exists === null) return 0;
  return (
    database.query(`SELECT count(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
};

const hasSqliteHeader = (path: string): boolean => {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const header = Buffer.alloc(SQLITE_HEADER.length);
    return (
      readSync(descriptor, header, 0, header.byteLength, 0) === header.byteLength &&
      header.toString("binary") === SQLITE_HEADER
    );
  } catch {
    return false;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
};

export const inspectBackup = (
  sourcePath: string,
): Result<BackupInspection, RecoveryFailure> => {
  const file = validFile(sourcePath, "source");
  if (!file.ok) return file;
  if (file.value.size > MAXIMUM_BACKUP_BYTES) {
    return err({ kind: "sourceTooLarge", maximumBytes: MAXIMUM_BACKUP_BYTES });
  }
  if (file.value.size < 100 || !hasSqliteHeader(sourcePath)) {
    return err({ kind: "invalidSqlite" });
  }
  let database: Database | null = null;
  try {
    database = new Database(sourcePath, { readonly: true, strict: true });
    const integrity = database.query("PRAGMA integrity_check").all() as {
      integrity_check: string;
    }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      return err({ kind: "integrityFailed" });
    }
    const foreignKeys = database.query("PRAGMA foreign_key_check").all();
    if (foreignKeys.length > 0) {
      return err({ kind: "foreignKeyFailed", violations: foreignKeys.length });
    }
    const study = schemaVersion(database, "schema_migration");
    if (study !== STUDY_SCHEMA_VERSION) {
      return err({
        kind: "unsupportedStudySchema",
        found: study,
        supported: STUDY_SCHEMA_VERSION,
      });
    }
    const preparation = schemaVersion(database, "preparation_migration");
    if (preparation !== PREPARATION_SCHEMA_VERSION) {
      return err({
        kind: "unsupportedPreparationSchema",
        found: preparation,
        supported: PREPARATION_SCHEMA_VERSION,
      });
    }
    return ok({
      byteSize: file.value.size,
      studySchemaVersion: study,
      preparationSchemaVersion: preparation,
      cardCount: tableCount(database, "card"),
      subtitleSetCount: tableCount(database, "subtitle_set"),
      integrity: "ok",
      foreignKeys: "ok",
    });
  } catch {
    return err({ kind: "invalidSqlite" });
  } finally {
    database?.close();
  }
};

const safeToken = (value: string): string =>
  value.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64) || "operation";

const stopped = (destinationPath: string): boolean =>
  !existsSync(`${destinationPath}-wal`) && !existsSync(`${destinationPath}-shm`);

const reopened = (path: string, now: Date): boolean => {
  const study = openStudy({
    databasePath: path,
    clock: () => new Date(now.getTime()),
    nextId: () => "recovery-validation-id",
    permitVerifier: {
      verify: () =>
        err({
          kind: "presentationInvalid",
          detail: "Recovery validation cannot verify a presentation.",
        }),
    },
    knownWordSeed: unavailableKaishiSeed,
  });
  if (!study.ok) return false;
  const preparation = openPreparation({
    databasePath: path,
    clock: () => new Date(now.getTime()),
    nextId: () => "recovery-validation-id",
    nextToken: () => "recovery-validation-token",
    importPolicy: phase3ImportPolicy,
    inspector: createSubtitleImportInspector(phase3ImportPolicy),
    analyzer: {
      name: "recovery-validation",
      analyze: async () =>
        err({ kind: "analyzerUnavailable", cause: "Recovery does not analyze." }),
    },
    grammar: declaredGrammarDetector,
    provider: createDeterministicPreparationProvider(),
    providerConfigured: () => false,
    batchSize: 20,
  });
  if (!preparation.ok) {
    study.value.close();
    return false;
  }
  preparation.value.close();
  study.value.close();
  return true;
};

const removeTemporary = (path: string): void => {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    // The primary typed failure remains authoritative; an orphaned temp is harmless.
  }
};

export const createBackupRecovery = (
  dependencies: BackupRecoveryDependencies,
): BackupRecovery => ({
  inspect: inspectBackup,
  restore: (command): Result<RestoreReceipt, RecoveryFailure> => {
    if (command.confirmation !== "replace") {
      return err({ kind: "confirmationRequired" });
    }
    const source = validFile(command.sourcePath, "source");
    if (!source.ok) return source;
    if (
      command.destinationPath.trim() === "" ||
      command.destinationPath === ":memory:"
    ) {
      return err({ kind: "invalidPath", role: "destination" });
    }
    const destinationExists = existsSync(command.destinationPath);
    const destination = destinationExists
      ? validFile(command.destinationPath, "destination")
      : null;
    if (destination !== null && !destination.ok) return destination;
    if (
      resolve(command.sourcePath) === resolve(command.destinationPath) ||
      (destination?.ok === true &&
        source.value.dev === destination.value.dev &&
        source.value.ino === destination.value.ino)
    ) {
      return err({ kind: "sameFile" });
    }
    if (!stopped(command.destinationPath)) return err({ kind: "destinationInUse" });
    const inspection = inspectBackup(command.sourcePath);
    if (!inspection.ok) return inspection;
    let now: Date;
    try {
      now = dependencies.clock();
    } catch {
      return err({ kind: "clockFailed" });
    }
    if (!Number.isFinite(now.getTime())) return err({ kind: "clockFailed" });
    const destinationDirectory = dirname(resolve(command.destinationPath));
    try {
      mkdirSync(destinationDirectory, { recursive: true });
    } catch {
      return err({ kind: "copyFailed", operation: "temporary" });
    }
    let token: string;
    try {
      token = safeToken(dependencies.nextToken());
    } catch {
      return err({ kind: "copyFailed", operation: "temporary" });
    }
    const temporaryPath = `${destinationDirectory}/.${basename(command.destinationPath)}.restore-${token}.tmp`;
    const stamp = now.toISOString().replace(/[:.]/gu, "-");
    const safetyCopyPath = destinationExists
      ? `${command.destinationPath}.pre-restore-${stamp}-${token}.sqlite`
      : null;
    if (existsSync(temporaryPath)) {
      return err({ kind: "copyFailed", operation: "temporary" });
    }
    try {
      copyFileSync(command.sourcePath, temporaryPath, constants.COPYFILE_EXCL);
      chmodSync(temporaryPath, 0o600);
    } catch {
      removeTemporary(temporaryPath);
      return err({ kind: "copyFailed", operation: "temporary" });
    }
    const copied = inspectBackup(temporaryPath);
    if (!copied.ok) {
      removeTemporary(temporaryPath);
      return copied;
    }
    if (safetyCopyPath !== null) {
      try {
        copyFileSync(command.destinationPath, safetyCopyPath, constants.COPYFILE_EXCL);
        chmodSync(safetyCopyPath, 0o600);
      } catch {
        removeTemporary(temporaryPath);
        return err({ kind: "copyFailed", operation: "safety" });
      }
    }
    try {
      renameSync(temporaryPath, command.destinationPath);
    } catch {
      removeTemporary(temporaryPath);
      return err({ kind: "replacementFailed", safetyCopyPath });
    }
    const finalInspection = inspectBackup(command.destinationPath);
    const verify =
      dependencies.postRestoreVerify ?? ((path: string) => reopened(path, now));
    let verified = false;
    try {
      verified = finalInspection.ok && verify(command.destinationPath);
    } catch {
      verified = false;
    }
    if (!finalInspection.ok || !verified) {
      return err({ kind: "postRestoreFailed", safetyCopyPath });
    }
    return ok({
      inspection: finalInspection.value,
      restoredAt: now.toISOString(),
      safetyCopyPath,
    });
  },
});
