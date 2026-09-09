import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v1Snapshot } from "../../tests/fixtures/migration/v1.ts";
import type { LogRecord } from "../log.ts";
import { acquireDatabaseLock } from "../recovery/database-lock.ts";
import { err } from "../result.ts";
import { asCardId } from "../study/contracts.ts";
import { openStudy, unavailableKaishiSeed } from "../study/study.ts";
import { createV1Migration, initializeMigrationDestination } from "./v1-migration.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const setup = (
  nextId: () => string = (() => {
    let value = 0;
    return () => `imported-card-${++value}`;
  })(),
) => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-import-"));
  directories.push(directory);
  const destination = join(directory, "study.sqlite");
  const clock = () => new Date("2026-09-08T12:00:00.000Z");
  const migration = createV1Migration({
    clock,
    nextId,
    initializeDestination: (path) =>
      initializeMigrationDestination(path, clock, nextId),
  });
  return { destination, migration };
};

describe("V1 migration", () => {
  test("dry-runs without creating a destination and accounts for every row", () => {
    const context = setup();
    const report = context.migration.inspect(v1Snapshot(), context.destination);
    expect(report).toMatchObject({
      ok: true,
      value: {
        applied: false,
        destinationSchemaVersion: null,
        counts: { input: 6, mapped: 3, merged: 0, skipped: 0, quarantined: 3 },
        preferences: { applied: false, reason: "ready" },
      },
    });
    expect(existsSync(context.destination)).toBe(false);
  });

  test("rejects an invalid apply before creating or migrating a destination", () => {
    const context = setup();
    expect(
      context.migration.apply({
        importKey: "invalid-source",
        snapshotBytes: new TextEncoder().encode("not JSON"),
        destinationPath: context.destination,
      }),
    ).toMatchObject({ ok: false, error: { kind: "snapshotInvalid" } });
    expect(existsSync(context.destination)).toBe(false);
  });

  test("does not inspect or mutate a destination owned by the running server", () => {
    const context = setup();
    const lock = acquireDatabaseLock(context.destination);
    if (!lock.ok) throw new Error(lock.error);
    expect(
      context.migration.apply({
        importKey: "locked-destination",
        snapshotBytes: v1Snapshot(),
        destinationPath: context.destination,
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "destinationUnreadable",
        detail: "Destination database is in use or could not be locked.",
      },
    });
    expect(existsSync(context.destination)).toBe(false);
    lock.value.release();
  });

  test("skips progress attached to an inactive catalogue point", () => {
    const context = setup();
    const snapshot = JSON.parse(new TextDecoder().decode(v1Snapshot())) as {
      sync: {
        knowledgePoints: Record<string, unknown>[];
        srsUpdates: Record<string, unknown>[];
      };
    };
    snapshot.sync.knowledgePoints = [
      { ...(snapshot.sync.knowledgePoints[0] ?? {}), catalogue_status: "retired" },
    ];
    snapshot.sync.srsUpdates = [snapshot.sync.srsUpdates[0] ?? {}];
    expect(
      context.migration.inspect(
        new TextEncoder().encode(JSON.stringify(snapshot)),
        context.destination,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        counts: { input: 1, skipped: 1, quarantined: 0 },
        items: [{ disposition: "skipped", reason: "cataloguePointInactive" }],
      },
    });
  });

  test("applies once, retains honest states, and records no invented reviews", () => {
    const context = setup();
    const applied = context.migration.apply({
      importKey: "learner-cutover",
      snapshotBytes: v1Snapshot(),
      destinationPath: context.destination,
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        applied: true,
        replayed: false,
        counts: { input: 6, mapped: 3, quarantined: 3 },
        preferences: {
          newCardsPerDay: 7,
          timeZone: "Australia/Sydney",
          applied: true,
        },
      },
    });
    const database = new Database(context.destination, { readonly: true });
    expect(
      database
        .query("SELECT state, count(*) AS count FROM card_progress GROUP BY state")
        .all(),
    ).toEqual([
      { state: "active", count: 1 },
      { state: "known", count: 1 },
      { state: "staged", count: 1 },
      { state: "suspended", count: 1 },
    ]);
    expect(database.query("SELECT count(*) AS count FROM review_event").get()).toEqual({
      count: 0,
    });
    expect(
      database
        .query("SELECT scheduler_version FROM schedule ORDER BY scheduler_version")
        .all(),
    ).toEqual([
      { scheduler_version: "v1-fsrs-lite-import-v1" },
      { scheduler_version: "v1-fsrs-lite-import-v1" },
    ]);
    expect(
      database.query("SELECT count(*) AS count FROM legacy_quarantine").get(),
    ).toEqual({
      count: 3,
    });
    expect(
      database
        .query(
          `SELECT support_ready_at, known_return_state FROM card_progress p
           JOIN card c ON c.id = p.card_id
           WHERE p.state = 'known'`,
        )
        .get(),
    ).toEqual({
      support_ready_at: "2026-09-01T10:00:00.000Z",
      known_return_state: "active",
    });
    database.close();

    expect(
      context.migration.apply({
        importKey: "learner-cutover",
        snapshotBytes: v1Snapshot(),
        destinationPath: context.destination,
      }),
    ).toMatchObject({ ok: true, value: { replayed: true } });
    const preferences = new Database(context.destination);
    preferences
      .query("UPDATE study_preferences SET new_cards_per_day = 23 WHERE singleton = 1")
      .run();
    preferences.close();
    expect(
      context.migration.apply({
        importKey: "same-source-new-key",
        snapshotBytes: v1Snapshot(),
        destinationPath: context.destination,
      }),
    ).toMatchObject({ ok: true, value: { replayed: true } });
    const preservedPreferences = new Database(context.destination, { readonly: true });
    expect(
      preservedPreferences
        .query("SELECT new_cards_per_day FROM study_preferences WHERE singleton = 1")
        .get(),
    ).toEqual({ new_cards_per_day: 23 });
    expect(
      preservedPreferences.query("SELECT count(*) AS count FROM legacy_import").get(),
    ).toEqual({ count: 1 });
    preservedPreferences.close();
    const changed = v1Snapshot({ capturedAt: "2026-09-08T12:00:01.000Z" });
    expect(
      context.migration.apply({
        importKey: "learner-cutover",
        snapshotBytes: changed,
        destinationPath: context.destination,
      }),
    ).toEqual({ ok: false, error: { kind: "importConflict" } });
  });

  test("rolls back the complete apply when Card insertion fails", () => {
    const context = setup(() => "duplicate-card-id");
    expect(
      context.migration.apply({
        importKey: "rollback",
        snapshotBytes: v1Snapshot(),
        destinationPath: context.destination,
      }),
    ).toMatchObject({ ok: false, error: { kind: "applyFailed" } });
    const database = new Database(context.destination, { readonly: true });
    expect(database.query("SELECT count(*) AS count FROM card").get()).toEqual({
      count: 0,
    });
    expect(database.query("SELECT count(*) AS count FROM legacy_import").get()).toEqual(
      {
        count: 0,
      },
    );
    database.close();
  });

  test("preserves a stronger suspended V2 state and redacts operational logs", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-existing-import-"));
    directories.push(directory);
    const destination = join(directory, "study.sqlite");
    const clock = () => new Date("2026-09-08T12:00:00.000Z");
    let id = 0;
    const nextId = () => `existing-${++id}`;
    const opened = openStudy({
      databasePath: destination,
      clock,
      nextId,
      permitVerifier: {
        verify: () => err({ kind: "presentationInvalid", detail: "not used" }),
      },
      knownWordSeed: unavailableKaishiSeed,
    });
    if (!opened.ok) throw new Error(opened.error.kind);
    const created = opened.value.createCard({
      type: "grammar",
      content: {
        canonicalForm: "〜ながら",
        meaning: "while doing",
        formation: "verb stem + ながら",
        usageNotes: "V2-authored content",
      },
    });
    if (!created.ok) throw new Error(created.error.kind);
    expect(
      opened.value.setCardState({
        cardId: asCardId(created.value.card.id),
        action: "suspend",
      }),
    ).toMatchObject({ ok: true, value: { state: "suspended" } });
    opened.value.close();
    const records: LogRecord[] = [];
    const migration = createV1Migration({
      clock,
      nextId,
      initializeDestination: (path) =>
        initializeMigrationDestination(path, clock, nextId),
      logger: { write: (_level, record) => records.push(record) },
    });
    expect(
      migration.apply({
        importKey: "private-import-key",
        snapshotBytes: v1Snapshot(),
        destinationPath: destination,
      }),
    ).toMatchObject({ ok: true, value: { counts: { merged: 1 } } });
    const database = new Database(destination, { readonly: true });
    expect(
      database
        .query("SELECT state FROM card_progress WHERE card_id = ?")
        .get(created.value.card.id),
    ).toEqual({ state: "suspended" });
    database.close();
    const logged = JSON.stringify(records);
    for (const privateValue of [
      "private-import-key",
      "grammar-known",
      "〜ながら",
      "泳ぐ",
      "Australia/Sydney",
    ]) {
      expect(logged).not.toContain(privateValue);
    }
  });

  test("keeps known progress reversible when V1 has no usable schedule", () => {
    const context = setup();
    const snapshot = JSON.parse(new TextDecoder().decode(v1Snapshot())) as {
      sync: {
        knowledgePoints: Record<string, unknown>[];
        srsUpdates: Record<string, unknown>[];
      };
    };
    snapshot.sync.knowledgePoints = [snapshot.sync.knowledgePoints[0] ?? {}];
    snapshot.sync.srsUpdates = [
      { ...(snapshot.sync.srsUpdates[0] ?? {}), nextReview: null },
    ];
    const applied = context.migration.apply({
      importKey: "known-without-schedule",
      snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot)),
      destinationPath: context.destination,
    });
    expect(applied).toMatchObject({ ok: true });
    const database = new Database(context.destination, { readonly: true });
    expect(
      database
        .query("SELECT state, known_return_state, support_ready_at FROM card_progress")
        .get(),
    ).toEqual({
      state: "known",
      known_return_state: "staged",
      support_ready_at: "2026-09-01T10:00:00.000Z",
    });
    expect(database.query("SELECT count(*) AS count FROM schedule").get()).toEqual({
      count: 0,
    });
    database.close();
  });
});
