import type { Result } from "../result.ts";

export const MAXIMUM_BACKUP_BYTES = 128 * 1024 * 1024;

export type BackupInspection = Readonly<{
  byteSize: number;
  studySchemaVersion: number;
  preparationSchemaVersion: number;
  learningMaterialSchemaVersion: number;
  cardCount: number;
  subtitleSetCount: number;
  integrity: "ok";
  foreignKeys: "ok";
}>;

export type RestoreReceipt = Readonly<{
  inspection: BackupInspection;
  restoredAt: string;
  safetyCopyPath: string | null;
}>;

export type RecoveryFailure =
  | { readonly kind: "confirmationRequired" }
  | { readonly kind: "invalidPath"; readonly role: "source" | "destination" }
  | { readonly kind: "sourceMissing" }
  | { readonly kind: "pathIsSymlink"; readonly role: "source" | "destination" }
  | { readonly kind: "sameFile" }
  | { readonly kind: "sourceTooLarge"; readonly maximumBytes: number }
  | { readonly kind: "invalidSqlite" }
  | { readonly kind: "integrityFailed" }
  | { readonly kind: "foreignKeyFailed"; readonly violations: number }
  | {
      readonly kind: "unsupportedStudySchema";
      readonly found: number | null;
      readonly supported: number;
    }
  | {
      readonly kind: "unsupportedPreparationSchema";
      readonly found: number | null;
      readonly supported: number;
    }
  | {
      readonly kind: "unsupportedLearningMaterialSchema";
      readonly found: number | null;
      readonly supported: number;
    }
  | { readonly kind: "destinationInUse" }
  | { readonly kind: "clockFailed" }
  | { readonly kind: "copyFailed"; readonly operation: "temporary" | "safety" }
  | { readonly kind: "replacementFailed"; readonly safetyCopyPath: string | null }
  | { readonly kind: "postRestoreFailed"; readonly safetyCopyPath: string | null };

export type RestoreBackup = Readonly<{
  sourcePath: string;
  destinationPath: string;
  confirmation: "replace" | null;
}>;

export type BackupRecovery = Readonly<{
  inspect: (sourcePath: string) => Result<BackupInspection, RecoveryFailure>;
  restore: (command: RestoreBackup) => Result<RestoreReceipt, RecoveryFailure>;
}>;
