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

const removePreparationMigration = (db: Database) => {
  for (const table of [
    "review_batch_claim",
    "review_batch_attempt",
    "review_preparation_control",
    "material_speech_job",
  ])
    db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE validated_presentation DROP COLUMN context_json;
 ALTER TABLE presentation_permit DROP COLUMN context_json;
 ALTER TABLE review_batch DROP COLUMN origin;
 ALTER TABLE review_batch DROP COLUMN blocked_reason;
 ALTER TABLE review_batch DROP COLUMN retry_at;
 ALTER TABLE review_batch_job DROP COLUMN phase;
 ALTER TABLE review_batch_job DROP COLUMN owner_token;
 ALTER TABLE review_batch_job DROP COLUMN response_json;
 ALTER TABLE review_batch_job DROP COLUMN provider_identity;`);
};

const later = [
  "presentation_audio",
  "speech_daily_usage",
  "review_batch_job",
  "review_batch",
  "review_batch_cooldown",
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
  removePreparationMigration(database);
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
  removePreparationMigration(reset);
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

test("unshown bare reviews are removed while history and first exposures remain", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-grammar-fallback-"));
  directories.push(directory);
  const databasePath = join(directory, "material.sqlite");
  open(databasePath).close();
  const raw = new Database(databasePath);
  const banked = (
    id: string,
    targetKind: string,
    mode: "teach" | "review",
    shownAt: string | null,
  ) => {
    raw
      .query(
        `INSERT INTO validated_presentation(
         id, card_id, mode, payload_json, normalized_japanese, exact_signature,
         near_signature, generated_at, shown_at, provider, model, prompt_version,
         validation_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-19T00:00:00.000Z', ?,
         'word-card', '-', '-', 'v')`,
      )
      .run(id, id, mode, JSON.stringify({ targetKind }), id, id, id, shownAt);
  };
  banked("grammar-reserve", "grammar", "review", null);
  banked("grammar-history", "grammar", "review", "2026-09-19T01:00:00.000Z");
  banked("vocabulary-review-reserve", "vocabulary", "review", null);
  banked(
    "vocabulary-review-history",
    "vocabulary",
    "review",
    "2026-09-19T01:00:00.000Z",
  );
  banked("vocabulary-teach-reserve", "vocabulary", "teach", null);
  removePreparationMigration(raw);
  raw.query("DELETE FROM learning_material_migration WHERE version >= 9").run();
  raw.close();

  open(databasePath).close();
  const check = new Database(databasePath, { readonly: true });
  const left = (
    check.query("SELECT id FROM validated_presentation").all() as { id: string }[]
  ).map((row) => row.id);
  check.close();
  expect(left.sort()).toEqual(
    ["grammar-history", "vocabulary-review-history", "vocabulary-teach-reserve"].sort(),
  );
});

test("upgrading pauses recent failed Cards, but not Cards prepared afterward", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-batch-cooldown-"));
  directories.push(directory);
  const databasePath = join(directory, "material.sqlite");
  open(databasePath).close();
  const raw = new Database(databasePath);
  const add = raw.query(
    `INSERT INTO review_batch_item(batch_id, seq, card_id, input_json, status, updated_at)
     VALUES (?, ?, ?, '{}', ?, ?)`,
  );
  add.run("one", 0, "still-failed", "failed", "2026-09-12T08:00:00.000Z");
  add.run("two", 0, "recovered", "failed", "2026-09-12T08:00:00.000Z");
  add.run("three", 0, "recovered", "ready", "2026-09-12T08:30:00.000Z");
  add.run("four", 0, "old-failure", "failed", "2026-09-10T08:00:00.000Z");
  removePreparationMigration(raw);
  raw.query("DELETE FROM learning_material_migration WHERE version >= 10").run();
  raw.exec("DROP TABLE review_batch_cooldown");
  raw.close();

  const upgraded = open(databasePath);
  const blocked = upgraded.backgroundRetryBlockedCards();
  expect(blocked.ok && [...blocked.value].join(",")).toBe("still-failed");
  upgraded.close();
});

test("pre-v7 orphan work remains claimed and identified provider jobs survive upgrade", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-legacy-work-"));
  directories.push(directory);
  const path = join(directory, "material.sqlite");
  open(path).close();
  const raw = new Database(path);
  removePreparationMigration(raw);
  raw.exec("DELETE FROM learning_material_migration WHERE version=12");
  const add = raw.query(
    "INSERT INTO review_batch_item(batch_id,seq,card_id,input_json,status,updated_at) VALUES (?,0,?,'{}','pending','2026-09-12T08:59:00.000Z')",
  );
  add.run("lost-id", "card-lost");
  add.run("known-id", "card-known");
  raw
    .query(
      "INSERT INTO review_batch_job(batch_id,job_id,dispatched_at) VALUES ('known-id','response-to-retrieve','2026-09-12T08:59:00.000Z')",
    )
    .run();
  raw.close();
  const upgraded = open(path);
  try {
    expect(upgraded.pendingReviewBatch()).toMatchObject({ ok: true });
    await upgraded.advanceReviewBatch("lost-id");
    await upgraded.advanceReviewBatch("known-id");
    expect(upgraded.preparationState()).toMatchObject({
      ok: true,
      value: { uncertainCardIds: { length: 2 }, uncertainBatches: { length: 2 } },
    });
    const check = new Database(path, { readonly: true });
    expect(
      check
        .query("SELECT job_id FROM review_batch_job WHERE batch_id='known-id'")
        .get(),
    ).toEqual({ job_id: "response-to-retrieve" });
    expect(check.query("SELECT * FROM review_batch").all()).toHaveLength(2);
    check.close();
  } finally {
    upgraded.close();
  }
});
