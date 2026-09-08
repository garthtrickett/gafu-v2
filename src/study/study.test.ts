import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mutableClock,
  permit,
  sequentialIds,
  testPermitVerifier,
  testSeed,
} from "../../tests/support/study.ts";
import type { CreateCard, Study, StudyDependencies } from "./contracts.ts";
import { asCardId } from "./contracts.ts";
import { openStudy, unavailableKaishiSeed } from "./study.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const grammar: CreateCard = {
  type: "grammar",
  content: {
    canonicalForm: "〜てしまう",
    meaning: "completion or regret",
    formation: "て-form + しまう",
    usageNotes: "often contracts to ちゃう",
  },
};

const vocabulary: CreateCard = {
  type: "vocabulary",
  content: {
    lemma: "開く",
    reading: "あく",
    partOfSpeech: "intransitive verb",
    meaning: "to open",
    usageNotes: "used for something becoming open",
  },
};

const openTestStudy = (
  overrides: Partial<StudyDependencies> = {},
): { study: Study; clock: ReturnType<typeof mutableClock> } => {
  const clock = mutableClock("2026-09-08T10:00:00.000Z");
  const opened = openStudy({
    databasePath: ":memory:",
    clock: clock.now,
    nextId: sequentialIds(),
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
    ...overrides,
  });
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  return { study: opened.value, clock };
};

const create = (study: Study, input: CreateCard) => {
  const result = study.createCard(input);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

describe("Study Cards and knowledge", () => {
  test("creates each canonical Card once without conflating vocabulary senses", () => {
    const { study } = openTestStudy();
    const first = create(study, vocabulary);
    const retry = create(study, {
      ...vocabulary,
      content: {
        ...vocabulary.content,
        reading: "アク",
        meaning: "To open.",
        usageNotes: "different display copy",
      },
    });
    const otherSense = create(study, {
      type: "vocabulary",
      content: {
        lemma: "開く",
        reading: "ひらく",
        partOfSpeech: "transitive verb",
        meaning: "to open an event",
        usageNotes: "",
      },
    });
    const grammarCard = create(study, grammar);

    expect(first.outcome).toBe("created");
    expect(retry).toMatchObject({ outcome: "existing", card: { id: first.card.id } });
    expect(otherSense.card.id).not.toBe(first.card.id);
    expect(grammarCard.card.type).toBe("grammar");
    expect(study.listCards()).toMatchObject({ ok: true, value: { length: 3 } });
    study.close();
  });

  test("keeps baseline words out of the Card bank and preserves corrections", () => {
    const { study } = openTestStudy();
    const initial = study.knowledgeSnapshot();
    expect(initial).toMatchObject({
      ok: true,
      value: {
        baseline: { availability: "available", enabledCount: 2 },
        vocabulary: { length: 2 },
      },
    });
    expect(study.listCards()).toEqual({ ok: true, value: [] });
    expect(study.setBaselineWordEnabled("inu", false)).toMatchObject({
      ok: true,
      value: {
        baseline: {
          enabledCount: 1,
          entries: [
            { key: "inu", enabled: false },
            { key: "neko", enabled: true },
          ],
        },
      },
    });
    expect(study.setBaselineWordEnabled("inu", true)).toMatchObject({
      ok: true,
      value: { baseline: { enabledCount: 2 } },
    });
    study.close();
  });

  test("makes known and suspended transitions reversible without losing schedule", () => {
    const { study } = openTestStudy();
    const card = create(study, vocabulary).card;
    expect(study.setCardState({ cardId: card.id, action: "markKnown" })).toMatchObject({
      ok: true,
      value: { state: "known", supportReadyAt: expect.any(String) },
    });
    expect(study.knowledgeSnapshot()).toMatchObject({
      ok: true,
      value: { vocabulary: { length: 3 } },
    });
    expect(study.setCardState({ cardId: card.id, action: "suspend" })).toMatchObject({
      ok: true,
      value: { state: "suspended", supportReadyAt: expect.any(String) },
    });
    expect(study.setCardState({ cardId: card.id, action: "restore" })).toMatchObject({
      ok: true,
      value: { state: "known" },
    });
    expect(
      study.setCardState({ cardId: card.id, action: "markNotKnown" }),
    ).toMatchObject({
      ok: true,
      value: { state: "staged", supportReadyAt: null },
    });
    expect(study.setCardState({ cardId: card.id, action: "restore" })).toEqual({
      ok: false,
      error: {
        kind: "invalidStateTransition",
        state: "staged",
        action: "restore",
      },
    });
    study.close();
  });

  test("updates display content without replacing identity or state", () => {
    const { study } = openTestStudy();
    const card = create(study, vocabulary).card;
    const updated = study.updateCard(card.id, {
      ...vocabulary.content,
      meaning: "to become open",
      usageNotes: "corrected usage note",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: {
        id: card.id,
        state: "staged",
        content: {
          meaning: "to become open",
          usageNotes: "corrected usage note",
        },
      },
    });
    expect(study.listCards({ search: "corrected" })).toMatchObject({
      ok: true,
      value: { length: 1 },
    });
    expect(
      study.createCard({
        ...vocabulary,
        content: { ...vocabulary.content, meaning: "to become open" },
      }),
    ).toMatchObject({
      ok: true,
      value: { outcome: "existing", card: { id: card.id } },
    });
    expect(study.createCard(vocabulary)).toMatchObject({
      ok: true,
      value: { outcome: "existing", card: { id: card.id } },
    });
    study.close();
  });

  test("rejects a correction whose identity already belongs to another Card", () => {
    const { study } = openTestStudy();
    const opening = create(study, vocabulary).card;
    const event = create(study, {
      type: "vocabulary",
      content: {
        lemma: "開く",
        reading: "ひらく",
        partOfSpeech: "transitive verb",
        meaning: "to open an event",
        usageNotes: "",
      },
    }).card;
    expect(study.updateCard(opening.id, event.content)).toEqual({
      ok: false,
      error: { kind: "identityConflict", existingCardId: event.id },
    });
    expect(study.listCards({ search: "becoming open" })).toMatchObject({
      ok: true,
      value: { length: 1, 0: { id: opening.id } },
    });
    study.close();
  });

  test("rolls back the whole Card when a later insert fails", () => {
    let id = "shared-id";
    const { study } = openTestStudy({ nextId: () => id });
    create(study, vocabulary);
    const failed = study.createCard(grammar);
    expect(failed).toMatchObject({ ok: false, error: { kind: "writeFailed" } });
    expect(study.listCards()).toMatchObject({ ok: true, value: { length: 1 } });
    id = "second-id";
    expect(study.createCard(grammar)).toMatchObject({
      ok: true,
      value: { outcome: "created", card: { id: "second-id" } },
    });
    study.close();
  });
});

describe("Study admission and review", () => {
  test("shares one daily admission limit across both Card types", () => {
    const { study } = openTestStudy();
    create(study, vocabulary);
    create(study, grammar);
    expect(study.setPreferences({ newCardsPerDay: 1 })).toMatchObject({
      ok: true,
      value: { newCardsPerDay: 1 },
    });
    const first = study.studyQueue();
    const repeated = study.studyQueue();
    expect(first).toMatchObject({
      ok: true,
      value: { admittedToday: 1, newlyAdmitted: 1, due: { length: 1 }, stagedCount: 1 },
    });
    expect(repeated).toMatchObject({
      ok: true,
      value: { admittedToday: 1, newlyAdmitted: 0, due: { length: 1 }, stagedCount: 1 },
    });
    study.close();
  });

  test("changes the limit prospectively without rewriting admission", () => {
    const { study, clock } = openTestStudy();
    create(study, vocabulary);
    create(study, grammar);
    study.setPreferences({ newCardsPerDay: 1 });
    expect(study.studyQueue()).toMatchObject({ ok: true, value: { admittedToday: 1 } });
    study.setPreferences({ newCardsPerDay: 0 });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { admittedToday: 1, newlyAdmitted: 0, stagedCount: 1 },
    });
    clock.set("2026-09-09T10:00:00.000Z");
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { admittedToday: 0, newlyAdmitted: 0, stagedCount: 1 },
    });
    study.setPreferences({ newCardsPerDay: 1 });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { admittedToday: 1, newlyAdmitted: 1, stagedCount: 0 },
    });
    study.close();
  });

  test("does not reset today's allowance when the learner changes time zone", () => {
    const { study } = openTestStudy();
    create(study, vocabulary);
    create(study, grammar);
    study.setPreferences({ newCardsPerDay: 1, timeZone: "UTC" });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { localDay: "2026-09-08", admittedToday: 1 },
    });
    study.setPreferences({ timeZone: "Pacific/Honolulu" });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: {
        localDay: "2026-09-08",
        admittedToday: 1,
        newlyAdmitted: 0,
        stagedCount: 1,
      },
    });
    study.close();
  });

  test("shares the database-backed allowance across two Study instances", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-admission-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "study.sqlite");
    const clock = mutableClock("2026-09-08T10:00:00.000Z");
    const dependencies = {
      databasePath: path,
      clock: clock.now,
      permitVerifier: testPermitVerifier,
      knownWordSeed: testSeed,
    };
    const first = openStudy({ ...dependencies, nextId: sequentialIds() });
    const second = openStudy({ ...dependencies, nextId: sequentialIds() });
    if (!first.ok || !second.ok) throw new Error("failed to open shared test database");
    create(first.value, vocabulary);
    create(first.value, grammar);
    first.value.setPreferences({ newCardsPerDay: 1 });
    expect(first.value.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 1 },
    });
    expect(second.value.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 0, admittedToday: 1, stagedCount: 1 },
    });
    first.value.close();
    second.value.close();
  });

  test("records FSRS reviews, rejects permit replay, and earns delayed support", () => {
    const { study, clock } = openTestStudy();
    const card = create(study, vocabulary).card;
    study.setPreferences({ newCardsPerDay: 1, timeZone: "Australia/Sydney" });
    const queue = study.studyQueue();
    if (!queue.ok) throw new Error(JSON.stringify(queue.error));
    const firstPermit = permit("permit-1", card.id, clock.now());
    const first = study.answer({ cardId: card.id, grade: "good", permit: firstPermit });
    expect(first).toMatchObject({
      ok: true,
      value: { card: { reviewCount: 1, supportReadyAt: null } },
    });
    expect(
      study.answer({ cardId: card.id, grade: "good", permit: firstPermit }),
    ).toEqual({
      ok: false,
      error: { kind: "presentationAlreadyUsed" },
    });

    clock.set("2026-09-09T07:00:00.000Z");
    const second = study.answer({
      cardId: card.id,
      grade: "good",
      permit: permit("permit-2", card.id, clock.now()),
    });
    expect(second).toMatchObject({
      ok: true,
      value: { card: { reviewCount: 2, supportReadyAt: expect.any(String) } },
    });
    expect(study.knowledgeSnapshot()).toMatchObject({
      ok: true,
      value: { vocabulary: { length: 3 } },
    });
    study.close();
  });

  test("rejects wrong-card and expired permits without a review", () => {
    const { study, clock } = openTestStudy();
    const card = create(study, vocabulary).card;
    study.setPreferences({ newCardsPerDay: 1 });
    study.studyQueue();
    expect(
      study.answer({
        cardId: card.id,
        grade: "good",
        permit: permit("wrong", asCardId("someone-else"), clock.now()),
      }),
    ).toEqual({ ok: false, error: { kind: "presentationForWrongCard" } });
    expect(
      study.answer({
        cardId: card.id,
        grade: "good",
        permit: permit("old", card.id, new Date("2026-09-08T09:00:00.000Z")),
      }),
    ).toEqual({ ok: false, error: { kind: "presentationExpired" } });
    expect(study.listCards()).toMatchObject({
      ok: true,
      value: [{ reviewCount: 0 }],
    });
    study.close();
  });
});

describe("Study persistence and recovery", () => {
  test("reopens with the same Cards, settings, state, and schedules", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-study-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "study.sqlite");
    const clock = mutableClock("2026-09-08T10:00:00.000Z");
    const dependencies = {
      databasePath: path,
      clock: clock.now,
      permitVerifier: testPermitVerifier,
      knownWordSeed: testSeed,
    };
    const first = openStudy({ ...dependencies, nextId: sequentialIds() });
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const card = create(first.value, vocabulary).card;
    first.value.setPreferences({ newCardsPerDay: 1, timeZone: "Asia/Tokyo" });
    first.value.studyQueue();
    first.value.answer({
      cardId: card.id,
      grade: "hard",
      permit: permit("persisted-permit", card.id, clock.now()),
    });
    first.value.close();

    const reopened = openStudy({ ...dependencies, nextId: sequentialIds() });
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.error));
    expect(reopened.value.preferences()).toEqual({
      ok: true,
      value: { newCardsPerDay: 1, timeZone: "Asia/Tokyo" },
    });
    expect(reopened.value.listCards()).toMatchObject({
      ok: true,
      value: [
        { id: card.id, state: "active", reviewCount: 1, dueAt: expect.any(String) },
      ],
    });
    expect(reopened.value.studyQueue()).toMatchObject({
      ok: true,
      value: { admittedToday: 1, newlyAdmitted: 0 },
    });
    reopened.value.close();
  });

  test("exports a consistent, openable SQLite backup", () => {
    const { study } = openTestStudy();
    create(study, vocabulary);
    create(study, grammar);
    const backup = study.exportBackup();
    expect(backup.ok).toBe(true);
    if (backup.ok) {
      const restored = Database.deserialize(backup.value.bytes, { strict: true });
      const cards = restored.query("SELECT count(*) AS count FROM card").get() as {
        count: number;
      };
      const migrations = restored
        .query("SELECT max(version) AS version FROM schema_migration")
        .get() as { version: number };
      expect(cards.count).toBe(2);
      expect(migrations.version).toBe(backup.value.schemaVersion);
      restored.close();
    }
    study.close();
  });

  test("reports the unavailable production baseline instead of pretending it is seeded", () => {
    const { study } = openTestStudy({ knownWordSeed: unavailableKaishiSeed });
    expect(study.knowledgeSnapshot()).toMatchObject({
      ok: true,
      value: {
        vocabulary: { length: 0 },
        baseline: { id: "kaishi-1.5k", availability: "unavailable", enabledCount: 0 },
      },
    });
    study.close();
  });

  test("rejects a database written by a newer schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-newer-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "study.sqlite");
    const database = new Database(path, { strict: true, create: true });
    database.exec(
      "CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    database
      .query("INSERT INTO schema_migration(version, applied_at) VALUES (999, ?)")
      .run(new Date().toISOString());
    database.close();
    expect(
      openStudy({
        databasePath: path,
        clock: () => new Date("2026-09-08T10:00:00.000Z"),
        nextId: sequentialIds(),
        permitVerifier: testPermitVerifier,
        knownWordSeed: testSeed,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "unsupportedSchema", found: 999, supported: 2 },
    });
  });

  test("does not record a failed migration as applied", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-migration-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "study.sqlite");
    const database = new Database(path, { strict: true, create: true });
    database.exec(
      `CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
       CREATE TABLE card(conflicting_column TEXT);`,
    );
    database.close();
    expect(
      openStudy({
        databasePath: path,
        clock: () => new Date("2026-09-08T10:00:00.000Z"),
        nextId: sequentialIds(),
        permitVerifier: testPermitVerifier,
        knownWordSeed: testSeed,
      }),
    ).toMatchObject({ ok: false, error: { kind: "migrationFailed" } });
    const inspection = new Database(path, { strict: true });
    const count = inspection
      .query("SELECT count(*) AS count FROM schema_migration")
      .get() as { count: number };
    expect(count.count).toBe(0);
    inspection.close();
  });
});
