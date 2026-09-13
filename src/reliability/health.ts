import { Database } from "bun:sqlite";
import { inspectBackup } from "../recovery/backup.ts";
import type { RecoveryFailure } from "../recovery/contracts.ts";
import { err, ok, type Result } from "../result.ts";

export type HealthReport = Readonly<{
  status: "healthy" | "attention";
  studySchemaVersion: number;
  preparationSchemaVersion: number;
  integrity: "ok";
  foreignKeys: "ok";
  cards: Readonly<{
    grammar: number;
    vocabulary: number;
    staged: number;
    active: number;
    suspended: number;
  }>;
  preparation: Readonly<{
    subtitleSets: number;
    pendingRuns: number;
    failedRuns: number;
    uncertainBatches: number;
  }>;
  providerKeyConfigured: boolean;
}>;

export type HealthFailure =
  | { readonly kind: "databaseUnhealthy"; readonly failure: RecoveryFailure }
  | { readonly kind: "healthReadFailed" };

type CountRow = { key: string; count: number };

const grouped = (database: Database, sql: string): ReadonlyMap<string, number> =>
  new Map((database.query(sql).all() as CountRow[]).map((row) => [row.key, row.count]));

const count = (database: Database, sql: string): number =>
  (database.query(sql).get() as { count: number }).count;

export const inspectHealth = (
  databasePath: string,
  providerKeyConfigured: boolean,
): Result<HealthReport, HealthFailure> => {
  const inspection = inspectBackup(databasePath);
  if (!inspection.ok) {
    return err({ kind: "databaseUnhealthy", failure: inspection.error });
  }
  let database: Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, strict: true });
    const types = grouped(
      database,
      "SELECT type AS key, count(*) AS count FROM card GROUP BY type",
    );
    const states = grouped(
      database,
      "SELECT state AS key, count(*) AS count FROM card_progress GROUP BY state",
    );
    const pendingRuns = count(
      database,
      "SELECT count(*) AS count FROM preparation_run WHERE state IN ('pending', 'running', 'paused')",
    );
    const failedRuns = count(
      database,
      "SELECT count(*) AS count FROM preparation_run WHERE state = 'failed'",
    );
    const uncertainBatches = count(
      database,
      "SELECT count(*) AS count FROM preparation_batch WHERE state = 'uncertain'",
    );
    return ok({
      status:
        failedRuns > 0 || uncertainBatches > 0 || pendingRuns > 0
          ? "attention"
          : "healthy",
      studySchemaVersion: inspection.value.studySchemaVersion,
      preparationSchemaVersion: inspection.value.preparationSchemaVersion,
      integrity: inspection.value.integrity,
      foreignKeys: inspection.value.foreignKeys,
      cards: {
        grammar: types.get("grammar") ?? 0,
        vocabulary: types.get("vocabulary") ?? 0,
        staged: states.get("staged") ?? 0,
        active: states.get("active") ?? 0,
        suspended: states.get("suspended") ?? 0,
      },
      preparation: {
        subtitleSets: inspection.value.subtitleSetCount,
        pendingRuns,
        failedRuns,
        uncertainBatches,
      },
      providerKeyConfigured,
    });
  } catch {
    return err({ kind: "healthReadFailed" });
  } finally {
    database?.close();
  }
};
