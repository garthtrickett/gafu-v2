import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutableClock, sequentialIds } from "../../tests/support/study.ts";
import { ok } from "../result.ts";
import { createProviderKeyCustody } from "../topology/provider-key-custody.ts";
import type { GeneratedMaterial } from "./generated-contracts.ts";
import { MATERIAL_SCHEMA_VERSION, openLearningMaterial } from "./learning-material.ts";
import { createDeterministicMaterialProvider } from "./scripted-provider.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const open = (databasePath: string) => {
  const clock = mutableClock("2026-09-12T09:00:00.000Z");
  const material = openLearningMaterial({
    databasePath,
    clock: clock.now,
    nextId: sequentialIds(),
    nextToken: sequentialIds(),
    provider: createDeterministicMaterialProvider(),
    keyCustody: createProviderKeyCustody(
      { verify: async () => ok(undefined) },
      "sk-test",
    ),
    validate: async ({ value }) => ok(value as GeneratedMaterial),
    inspectionEnabled: false,
  });
  if (!material.ok) throw new Error(material.error.kind);
  return material.value;
};

const tables = (databasePath: string): Set<string> => {
  const database = new Database(databasePath);
  const rows = database
    .query("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  database.close();
  return new Set(rows.map((row) => row.name));
};

const later = ["presentation_audio", "speech_daily_usage", "review_batch_job"];

test("a database already at version 2 still receives every later step", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-migrate-"));
  directories.push(directory);
  const databasePath = join(directory, "gafu.sqlite");
  open(databasePath).close();
  expect(MATERIAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  for (const name of later) expect(tables(databasePath).has(name)).toBe(true);

  // Roll the file back to what production looked like before today: the
  // version-2 tables only, and a migration history that ends at 2.
  const database = new Database(databasePath);
  for (const name of later) database.exec(`DROP TABLE ${name}`);
  database.exec("DELETE FROM learning_material_migration WHERE version > 2");
  database.close();
  for (const name of later) expect(tables(databasePath).has(name)).toBe(false);

  // Reopening is the upgrade. Every later table is back, and the history is
  // contiguous through the current version.
  open(databasePath).close();
  for (const name of later) expect(tables(databasePath).has(name)).toBe(true);
  const history = new Database(databasePath);
  const versions = (
    history
      .query("SELECT version FROM learning_material_migration ORDER BY version")
      .all() as {
      version: number;
    }[]
  ).map((row) => row.version);
  history.close();
  expect(versions).toEqual(
    Array.from({ length: MATERIAL_SCHEMA_VERSION }, (_, index) => index + 1),
  );
});
