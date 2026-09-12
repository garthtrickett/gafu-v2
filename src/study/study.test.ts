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
import type {
  CreateCard,
  KnownWordSeed,
  Study,
  StudyDependencies,
} from "./contracts.ts";
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
    grammarTargetSupported: () => true,
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

describe("a Grammar Card must name a form material can be generated for", () => {
  test("an undeclared form is refused where it is created, not where it is studied", () => {
    // The generator rejects an undeclared form too, but by then the Card is
    // stored and the session that reaches it fails -- one unstudiable Card
    // stops the whole queue.
    const { study } = openTestStudy({
      grammarTargetSupported: (canonicalForm) =>
        canonicalForm === "\u301c\u3066\u3057\u307e\u3046",
    });
    const refused = study.createCard({
      type: "grammar",
      content: {
        canonicalForm: "\u5143\u3082\u5b50\u3082\u306a\u3044",
        meaning: "to defeat the purpose",
        formation: "\u5143 \u3082 \u5b50 \u3082 \u306a\u3044",
        usageNotes: "",
      },
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: "invalidCard", field: "canonicalForm" },
    });
    if (!refused.ok && "detail" in refused.error) {
      expect(refused.error.detail).toContain("\u5143\u3082\u5b50\u3082\u306a\u3044");
    }
    expect(study.listCards()).toMatchObject({ ok: true, value: [] });
  });

  test("a declared form is created as before", () => {
    const { study } = openTestStudy({
      grammarTargetSupported: (canonicalForm) =>
        canonicalForm === "\u301c\u3066\u3057\u307e\u3046",
    });
    expect(
      study.createCard({
        type: "grammar",
        content: {
          canonicalForm: "\u301c\u3066\u3057\u307e\u3046",
          meaning: "to do something regrettably",
          formation: "\u3066-form + \u3057\u307e\u3046",
          usageNotes: "",
        },
      }),
    ).toMatchObject({ ok: true, value: { outcome: "created" } });
  });

  test("a Vocabulary Card is unaffected", () => {
    const { study } = openTestStudy({ grammarTargetSupported: () => false });
    expect(study.createCard(vocabulary)).toMatchObject({
      ok: true,
      value: { outcome: "created" },
    });
  });
});

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

  test("removes obsolete baseline entries on a seed upgrade and keeps corrections", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-seed-upgrade-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "study.sqlite");
    const firstSeed: KnownWordSeed = {
      id: "fixture-seed",
      version: "v1",
      availability: "available",
      entries: [
        {
          key: "cat",
          lemma: "猫",
          reading: "ねこ",
          meaning: "cat",
          partOfSpeech: "noun",
        },
        {
          key: "dog",
          lemma: "犬",
          reading: "いぬ",
          meaning: "dog",
          partOfSpeech: "noun",
        },
      ],
    };
    const dependencies = {
      databasePath,
      clock: () => new Date("2026-09-08T10:00:00.000Z"),
      nextId: sequentialIds(),
      permitVerifier: testPermitVerifier,
      grammarTargetSupported: () => true,
    };
    const first = openStudy({ ...dependencies, knownWordSeed: firstSeed });
    if (!first.ok) throw new Error(first.error.kind);
    first.value.setBaselineWordEnabled("cat", false);
    first.value.close();
    const second = openStudy({
      ...dependencies,
      knownWordSeed: {
        ...firstSeed,
        version: "v2",
        entries: [firstSeed.entries[0] as KnownWordSeed["entries"][number]],
      },
    });
    if (!second.ok) throw new Error(second.error.kind);
    expect(second.value.knowledgeSnapshot()).toMatchObject({
      ok: true,
      value: {
        baseline: {
          enabledCount: 0,
          entries: [{ key: "cat", enabled: false }],
        },
      },
    });
    second.value.close();
  });

  test("rejects capture sense claims that do not describe the Card", () => {
    const { study } = openTestStudy();
    expect(
      study.captureVocabulary({
        operationKey: "mismatched-capture",
        card: {
          type: "vocabulary",
          content: {
            lemma: "猫",
            reading: "ねこ",
            partOfSpeech: "noun",
            meaning: "cat",
            usageNotes: "",
          },
        },
        identityClaim: {
          authority: "gafu-capture-v1",
          claimKey: `vocabulary:${JSON.stringify(["犬", "いぬ", "noun", "dog:1"])}`,
        },
        evidence: {
          sourceKey: "episode",
          cueKey: "cue",
          selectedSurface: "猫",
          span: { start: 0, end: 1 },
        },
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidCapture" } });
    expect(study.listCards()).toEqual({ ok: true, value: [] });
    study.close();
  });

  test("does not attach an old source sense to corrected lexical content", () => {
    const { study } = openTestStudy();
    const captured = study.captureVocabulary({
      operationKey: "capture-cat",
      card: {
        type: "vocabulary",
        content: {
          lemma: "猫",
          reading: "ねこ",
          partOfSpeech: "noun",
          meaning: "cat",
          usageNotes: "",
        },
      },
      identityClaim: {
        authority: "gafu-capture-v1",
        claimKey: `vocabulary:${JSON.stringify(["猫", "ねこ", "noun", "cat:1"])}`,
      },
      evidence: {
        sourceKey: "episode",
        cueKey: "cue",
        selectedSurface: "猫",
        span: { start: 0, end: 1 },
      },
    });
    if (!captured.ok) throw new Error(captured.error.kind);
    study.setCardState({ cardId: captured.value.card.id, action: "markSupportReady" });
    expect(
      study.updateCard(captured.value.card.id, {
        lemma: "犬",
        reading: "いぬ",
        partOfSpeech: "noun",
        meaning: "dog",
        usageNotes: "corrected identity display",
      }),
    ).toMatchObject({ ok: true });
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) throw new Error(knowledge.error.kind);
    expect(
      knowledge.value.vocabulary.find(
        (entry) => entry.key === `card:${captured.value.card.id}`,
      ),
    ).toMatchObject({ lemma: "犬", senseIds: [] });
    study.close();
  });

  test("makes support-ready and suspended transitions reversible without losing schedule", () => {
    const { study } = openTestStudy();
    const card = create(study, vocabulary).card;
    expect(
      study.setCardState({ cardId: card.id, action: "markSupportReady" }),
    ).toMatchObject({
      ok: true,
      value: { state: "staged", supportReadyAt: expect.any(String) },
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
      value: { state: "staged" },
    });
    expect(
      study.setCardState({ cardId: card.id, action: "markSupportReady" }),
    ).toMatchObject({
      ok: true,
      value: { state: "staged", supportReadyAt: expect.any(String) },
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
      grammarTargetSupported: () => true,
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

  test("records FSRS reviews, answers a replayed grade once, refuses a changed one, and earns delayed support", () => {
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
    // The outbox may resend the same grade after an ambiguous failure: the
    // answer is the one already given, and nothing is recorded twice.
    const replayed = study.answer({
      cardId: card.id,
      grade: "good",
      permit: firstPermit,
    });
    expect(replayed).toMatchObject({ ok: true, value: { card: { reviewCount: 1 } } });
    if (first.ok && replayed.ok) {
      expect(replayed.value.reviewedAt).toBe(first.value.reviewedAt);
      expect(replayed.value.nextDueAt).toBe(first.value.nextDueAt);
    }
    // A different grade on the spent permit is not a replay.
    expect(
      study.answer({ cardId: card.id, grade: "again", permit: firstPermit }),
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
        // Issued thirteen hours ago: past the twelve-hour lifetime.
        permit: permit(
          "old",
          card.id,
          new Date(clock.now().getTime() - 13 * 60 * 60 * 1_000),
        ),
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
      grammarTargetSupported: () => true,
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
        grammarTargetSupported: () => true,
      }),
    ).toEqual({
      ok: false,
      error: { kind: "unsupportedSchema", found: 999, supported: 6 },
    });
  });

  test("upgrades a Phase 2 database without stranding staged Cards", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-migration-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "study.sqlite");
    const dependencies = {
      databasePath: path,
      clock: () => new Date("2026-09-08T10:00:00.000Z"),
      nextId: sequentialIds(),
      permitVerifier: testPermitVerifier,
      knownWordSeed: testSeed,
      grammarTargetSupported: () => true,
    };
    const current = openStudy(dependencies);
    if (!current.ok) throw new Error(current.error.kind);
    expect(
      current.value.createCard({
        type: "grammar",
        content: {
          canonicalForm: "〜ながら",
          meaning: "while",
          formation: "verb stem + ながら",
          usageNotes: "",
        },
      }).ok,
    ).toBe(true);
    current.value.close();
    const database = new Database(path, { strict: true });
    database.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE legacy_quarantine;
      DROP TABLE legacy_import_item;
      DROP TABLE legacy_import;
      DROP TABLE capture_operation;
      DROP TABLE subtitle_capture_evidence;
      DROP TABLE plan_start_operation;
      DROP TABLE preparation_plan_evidence;
      DROP TABLE preparation_plan_member;
      DROP TABLE preparation_plan;
      DROP TABLE staging_source;
      ALTER TABLE review_event DROP COLUMN presentation_id;
      DELETE FROM schema_migration WHERE version >= 3;
    `);
    database.close();

    const upgraded = openStudy({ ...dependencies, nextId: sequentialIds() });
    if (!upgraded.ok) throw new Error(upgraded.error.kind);
    expect(upgraded.value.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 1, stagedCount: 0 },
    });
    upgraded.value.close();
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
        grammarTargetSupported: () => true,
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

describe("graduating known Cards into rotation", () => {
  const grammarCard = (canonicalForm: string): CreateCard => ({
    type: "grammar",
    content: {
      canonicalForm,
      meaning: `m ${canonicalForm}`,
      formation: "f",
      usageNotes: "",
    },
  });

  test("spreads first reviews across the window, skips unsupported forms, and answers like any mature Card", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "gafu-grad-")), "gafu.sqlite");
    // Creation refuses an unsupported form, so support is withdrawn after
    // the Card exists: a detector change between import and graduation.
    let supported = true;
    const { study, clock } = openTestStudy({
      databasePath,
      grammarTargetSupported: (form) => supported || form !== "〜unsupported",
    });
    study.setPreferences({ newCardsPerDay: 20, timeZone: "Australia/Sydney" });
    const forms = ["〜A", "〜B", "〜C", "〜D", "〜E", "〜F", "〜unsupported"];
    const ids = forms.map((form) => create(study, grammarCard(form)).card.id);
    // A V1 dismissal: known, never admitted, no schedule.
    const raw = new Database(databasePath);
    raw.exec("UPDATE card_progress SET state = 'known', known_return_state = 'staged'");
    raw.close();
    supported = false;
    expect(study.status()).toMatchObject({
      ok: true,
      value: { knownCount: 7, activeCount: 0 },
    });

    const planned = study.graduateKnown({ spreadDays: 3, dryRun: true });
    if (!planned.ok) throw new Error(JSON.stringify(planned.error));
    expect(planned.value.graduated).toHaveLength(6);
    expect(planned.value.skipped.map((item) => item.title)).toEqual(["〜unsupported"]);
    expect(planned.value.skipped[0]?.cardId).toBe(ids[6]);
    expect(planned.value.skipped[0]?.reason).toBe("unsupportedGrammarTarget");
    // Six Cards over three days: two a day, from tomorrow, nothing written yet.
    expect(planned.value.graduated.map((item) => item.intervalDays)).toEqual([
      1, 1, 2, 2, 3, 3,
    ]);
    expect(planned.value.perDay.map((day) => day.count)).toEqual([2, 2, 2]);
    expect(study.status()).toMatchObject({
      ok: true,
      value: { knownCount: 7, activeCount: 0 },
    });

    const applied = study.graduateKnown({ spreadDays: 3, dryRun: false });
    if (!applied.ok) throw new Error(JSON.stringify(applied.error));
    expect(study.status()).toMatchObject({
      ok: true,
      value: { knownCount: 1, activeCount: 6 },
    });
    const listed = study.listCards();
    if (!listed.ok) throw new Error("list");
    const graduatedCards = listed.value.filter((card) => card.state === "active");
    expect(graduatedCards.every((card) => card.schedulePhase === "review")).toBe(true);
    expect(graduatedCards.every((card) => card.admittedAt !== null)).toBe(true);
    // Nothing is due today, and today's allowance is untouched.
    const queue = study.studyQueue();
    expect(queue).toMatchObject({ ok: true, value: { due: [], admittedToday: 0 } });

    // Two days on, exactly the first two waves are due; a graduated Card
    // answers through FSRS like any mature Card and moves further out.
    clock.set(
      new Date(clock.now().getTime() + 2 * 24 * 60 * 60 * 1_000 + 60_000).toISOString(),
    );
    const later = study.studyQueue();
    if (!later.ok) throw new Error("queue");
    expect(later.value.due).toHaveLength(4);
    const first = later.value.due[0];
    if (first === undefined) throw new Error("no due card");
    const answered = study.answer({
      cardId: first.card.id,
      grade: "good",
      permit: permit("grad-permit", first.card.id, clock.now()),
    });
    expect(answered).toMatchObject({ ok: true, value: { card: { reviewCount: 1 } } });
    if (answered.ok) {
      expect(new Date(answered.value.nextDueAt).getTime()).toBeGreaterThan(
        clock.now().getTime() + 24 * 60 * 60 * 1_000,
      );
    }
    study.close();
  });
});
