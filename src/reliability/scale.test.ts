import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V1_SNAPSHOT_VERSION } from "../migration/contracts.ts";
import { createV1Migration } from "../migration/v1-migration.ts";
import { err, ok } from "../result.ts";
import { openStudy, unavailableKaishiSeed } from "../study/study.ts";
import { activeWatchCues, parseWatchSrt } from "../watch/subtitles.ts";

const ROWS = 5_000;
const CUES = 10_000;
const CEILING_MS = 5_000;

const duration = async <Value>(operation: () => Value | Promise<Value>) => {
  const started = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - started };
};

const largeSnapshot = (): Uint8Array => {
  const knowledgePoints = Array.from({ length: ROWS }, (_, index) => ({
    id: `vocabulary-${index}`,
    kind: "vocabulary",
    canonical_key: `vocabulary:語${index}`,
    catalogue_status: "active",
    lemma: `語${index}`,
    reading: `ご${index}`,
    part_of_speech: "noun",
    sense_key: `sense-${index}`,
    meaning: `fixture meaning ${index}`,
  }));
  const srsUpdates = Array.from({ length: ROWS }, (_, index) => ({
    knowledgePointId: `vocabulary-${index}`,
    repetitions: 0,
    intervalDays: 0,
    nextReview: "2026-09-08T00:00:00.000Z",
    difficulty: 5,
    stability: 0,
    lastReviewedAt: null,
    participationStatus: "active",
    learningState: "introduced",
    introducedAt: null,
  }));
  return new TextEncoder().encode(
    JSON.stringify({
      contractVersion: V1_SNAPSHOT_VERSION,
      capturedAt: "2026-09-08T00:00:00.000Z",
      sourceOrigin: "http://127.0.0.1:3005",
      sync: {
        knowledgePoints,
        grammarPoints: [],
        srsUpdates,
        userPreference: { dailyNewRuleLimit: 15, learnerTimeZone: "UTC" },
      },
    }),
  );
};

const stamp = (milliseconds: number): string => {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1_000) % 60;
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
};

describe("Phase 6 release scale", () => {
  test("reconciles 5,000 V1 progress rows within the CI-safe ceiling", async () => {
    const migration = createV1Migration({
      clock: () => new Date("2026-09-08T00:00:00.000Z"),
      nextId: () => "unused",
      initializeDestination: () => ok(undefined),
    });
    const measured = await duration(() =>
      migration.inspect(largeSnapshot(), "/definitely/missing/gafu-v2.sqlite"),
    );
    expect(measured.value).toMatchObject({
      ok: true,
      value: { counts: { input: ROWS, mapped: ROWS } },
    });
    expect(measured.elapsedMs).toBeLessThan(CEILING_MS);
  });

  test("lists and summarizes 5,000 Cards within the CI-safe ceiling", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-card-scale-"));
    try {
      const databasePath = join(directory, "study.sqlite");
      const initial = openStudy({
        databasePath,
        clock: () => new Date("2026-09-08T00:00:00.000Z"),
        nextId: () => "unused",
        permitVerifier: {
          verify: () => err({ kind: "presentationInvalid", detail: "not used" }),
        },
        knownWordSeed: unavailableKaishiSeed,
        grammarTargetSupported: () => true,
      });
      if (!initial.ok) throw new Error(initial.error.kind);
      initial.value.close();
      const database = new Database(databasePath, { strict: true });
      const insert = database.transaction(() => {
        const card = database.query(
          `INSERT INTO card(id, type, content_json, searchable_text, staged_at, staging_priority)
           VALUES (?, 'vocabulary', ?, ?, '2026-09-08T00:00:00.000Z', 0)`,
        );
        const claim = database.query(
          `INSERT INTO identity_claim(authority, claim_key, card_id)
           VALUES ('vocabulary-v1', ?, ?)`,
        );
        const progress = database.query(
          "INSERT INTO card_progress(card_id, state, support_ready_at) VALUES (?, 'active', ?)",
        );
        for (let index = 0; index < ROWS; index += 1) {
          const id = `scale-card-${index}`;
          const content = {
            lemma: `語${index}`,
            reading: `ご${index}`,
            meaning: `meaning ${index}`,
            partOfSpeech: "noun",
            usageNotes: "",
          };
          card.run(id, JSON.stringify(content), `${content.lemma} ${content.reading}`);
          claim.run(`語${index}:ご${index}:noun:meaning ${index}`, id);
          progress.run(id, "2026-09-08T00:00:00.000Z");
        }
      });
      insert.immediate();
      database.close();
      const opened = openStudy({
        databasePath,
        clock: () => new Date("2026-09-08T00:00:00.000Z"),
        nextId: () => "unused",
        permitVerifier: {
          verify: () => err({ kind: "presentationInvalid", detail: "not used" }),
        },
        knownWordSeed: unavailableKaishiSeed,
        grammarTargetSupported: () => true,
      });
      if (!opened.ok) throw new Error(opened.error.kind);
      const listed = await duration(() => opened.value.listCards());
      const status = await duration(() => opened.value.status());
      expect(listed.value).toMatchObject({ ok: true, value: { length: ROWS } });
      expect(status.value).toMatchObject({ ok: true, value: { activeCount: ROWS } });
      expect(listed.elapsedMs).toBeLessThan(CEILING_MS);
      expect(status.elapsedMs).toBeLessThan(CEILING_MS);
      opened.value.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("parses and activates a 10,000-cue SRT within the CI-safe ceiling", async () => {
    const source = Array.from({ length: CUES }, (_, index) => {
      const start = index * 1_000;
      return `${index + 1}\n${stamp(start)} --> ${stamp(start + 900)}\n日本語 ${index}\n`;
    }).join("\n");
    const parsed = await duration(() =>
      parseWatchSrt(new TextEncoder().encode(source)),
    );
    expect(parsed.value).toMatchObject({ ok: true, value: { cues: { length: CUES } } });
    if (!parsed.value.ok) throw new Error(parsed.value.error.kind);
    const track = parsed.value.value;
    const activated = await duration(() => activeWatchCues(track.cues, 5_000_100));
    expect(activated.value).toHaveLength(1);
    expect(parsed.elapsedMs).toBeLessThan(CEILING_MS);
    expect(activated.elapsedMs).toBeLessThan(CEILING_MS);
  });
});
