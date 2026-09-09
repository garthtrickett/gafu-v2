import { expect, test } from "bun:test";
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
import type { CreateCard } from "./contracts.ts";
import { openStudy } from "./study.ts";

test("Phase 1 exit journey preserves one schedule per Card across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-phase1-exit-"));
  const databasePath = join(directory, "study.sqlite");
  const clock = mutableClock("2026-09-08T08:00:00.000Z");
  const shared = {
    databasePath,
    clock: clock.now,
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
  };
  try {
    const opened = openStudy({ ...shared, nextId: sequentialIds() });
    if (!opened.ok) throw new Error(JSON.stringify(opened.error));
    const study = opened.value;
    const vocabulary: CreateCard = {
      type: "vocabulary",
      content: {
        lemma: "間に合う",
        reading: "まにあう",
        partOfSpeech: "verb",
        meaning: "to be in time",
        usageNotes: "",
      },
    };
    const grammar: CreateCard = {
      type: "grammar",
      content: {
        canonicalForm: "〜うちに",
        meaning: "while; before a state changes",
        formation: "plain form + うちに",
        usageNotes: "",
      },
    };
    const vocabularyCard = study.createCard(vocabulary);
    const vocabularyDuplicate = study.createCard(vocabulary);
    const grammarCard = study.createCard(grammar);
    if (!vocabularyCard.ok || !grammarCard.ok) throw new Error("Card creation failed");
    expect(vocabularyDuplicate).toMatchObject({
      ok: true,
      value: { outcome: "existing", card: { id: vocabularyCard.value.card.id } },
    });
    expect(study.listCards()).toMatchObject({ ok: true, value: { length: 2 } });
    expect(study.knowledgeSnapshot()).toMatchObject({
      ok: true,
      value: { vocabulary: { length: 2 }, baseline: { enabledCount: 2 } },
    });

    study.setPreferences({ newCardsPerDay: 1, timeZone: "Asia/Tokyo" });
    const firstQueue = study.studyQueue();
    expect(firstQueue).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 1, admittedToday: 1, stagedCount: 1 },
    });
    const target = firstQueue.ok ? firstQueue.value.due[0]?.card : undefined;
    if (target === undefined) throw new Error("No admitted Card was due");
    expect(
      study.answer({
        cardId: target.id,
        grade: "good",
        permit: permit("exit-1", target.id, clock.now()),
      }),
    ).toMatchObject({ ok: true, value: { card: { reviewCount: 1 } } });

    clock.set("2026-09-09T05:00:00.000Z");
    expect(
      study.answer({
        cardId: target.id,
        grade: "good",
        permit: permit("exit-2", target.id, clock.now()),
      }),
    ).toMatchObject({
      ok: true,
      value: { card: { reviewCount: 2, supportReadyAt: expect.any(String) } },
    });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 1, admittedToday: 1, stagedCount: 0 },
    });
    const beforeRestart = study.listCards();
    const backup = study.exportBackup();
    expect(backup).toMatchObject({ ok: true, value: { schemaVersion: 6 } });
    study.close();

    const reopened = openStudy({ ...shared, nextId: sequentialIds() });
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.error));
    expect(reopened.value.listCards()).toEqual(beforeRestart);
    expect(reopened.value.preferences()).toEqual({
      ok: true,
      value: { newCardsPerDay: 1, timeZone: "Asia/Tokyo" },
    });
    expect(reopened.value.knowledgeSnapshot()).toMatchObject({
      ok: true,
      value: { vocabulary: { length: 3 } },
    });
    reopened.value.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
