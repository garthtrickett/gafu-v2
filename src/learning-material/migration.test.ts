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

const later = [
  "presentation_audio",
  "speech_daily_usage",
  "review_batch_job",
  "review_batch",
];

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

test("a banked sentence with no reading over its kanji is dropped, once", () => {
  // The prompt that asked only for the written fields to reconstruct the
  // sentence let a model answer with one segment and no reading, and those
  // sentences would each be served once, furigana-less, before going away.
  const directory = mkdtempSync(join(tmpdir(), "gafu-unreadable-"));
  directories.push(directory);
  const databasePath = join(directory, "material.sqlite");
  open(databasePath).close();

  const banked = (
    id: string,
    written: string,
    reading: string,
    shownAt: string | null,
  ) => {
    const raw = new Database(databasePath);
    raw
      .query(
        `INSERT INTO validated_presentation(
           id, card_id, mode, payload_json, normalized_japanese, exact_signature,
           near_signature, generated_at, shown_at, provider, model, prompt_version,
           validation_version
         ) VALUES (?, 'c', 'review', ?, ?, ?, ?, '2026-09-19T00:00:00.000Z', ?, 'p', 'm', 'v', 'w')`,
      )
      .run(
        id,
        JSON.stringify({ readingSegments: [{ written, reading }] }),
        written,
        id,
        id,
        shownAt,
      );
    raw.close();
  };
  banked("empty-over-kanji", "清潔感があります。", "", null);
  banked("kana-needs-none", "あります。", "", null);
  banked("has-its-reading", "清潔感があります。", "せいけつかんがあります。", null);
  banked("already-shown", "清潔感があります。", "", "2026-09-19T01:00:00.000Z");

  // Force the step to run again over the rows just inserted.
  const reset = new Database(databasePath);
  reset.query("DELETE FROM learning_material_migration WHERE version >= 8").run();
  reset.close();
  open(databasePath).close();

  const check = new Database(databasePath, { readonly: true });
  const left = (
    check.query("SELECT id FROM validated_presentation").all() as {
      id: string;
    }[]
  ).map((row) => row.id);
  check.close();
  expect(left.sort()).toEqual(
    ["already-shown", "has-its-reading", "kana-needs-none"].sort(),
  );
});

test("unshown bare grammar fallbacks are removed while history and words remain", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-grammar-fallback-"));
  directories.push(directory);
  const databasePath = join(directory, "material.sqlite");
  open(databasePath).close();
  const raw = new Database(databasePath);
  const banked = (id: string, targetKind: string, shownAt: string | null) => {
    raw
      .query(
        `INSERT INTO validated_presentation(
         id, card_id, mode, payload_json, normalized_japanese, exact_signature,
         near_signature, generated_at, shown_at, provider, model, prompt_version,
         validation_version
       ) VALUES (?, ?, 'review', ?, ?, ?, ?, '2026-09-19T00:00:00.000Z', ?,
         'word-card', '-', '-', 'v')`,
      )
      .run(id, id, JSON.stringify({ targetKind }), id, id, id, shownAt);
  };
  banked("grammar-reserve", "grammar", null);
  banked("grammar-history", "grammar", "2026-09-19T01:00:00.000Z");
  banked("vocabulary-reserve", "vocabulary", null);
  raw.query("DELETE FROM learning_material_migration WHERE version = 9").run();
  raw.close();

  open(databasePath).close();
  const check = new Database(databasePath, { readonly: true });
  const left = (
    check.query("SELECT id FROM validated_presentation").all() as { id: string }[]
  ).map((row) => row.id);
  check.close();
  expect(left.sort()).toEqual(["grammar-history", "vocabulary-reserve"].sort());
});
