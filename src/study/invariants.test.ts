import { describe, expect, test } from "bun:test";
import {
  mutableClock,
  sequentialIds,
  testPermitVerifier,
  testSeed,
} from "../../tests/support/study.ts";
import type { CreateCard } from "./contracts.ts";
import { canonicalizeCard } from "./identity.ts";
import { newSchedule, scheduleAnswer } from "./scheduler.ts";
import { openStudy } from "./study.ts";

describe("Phase 1 bounded property invariants", () => {
  test("canonical grammar claims ignore every supported whitespace variant", () => {
    const expected = canonicalizeCard({
      type: "grammar",
      content: {
        canonicalForm: "〜 て しまう",
        meaning: "completion",
        formation: "て-form + しまう",
        usageNotes: "",
      },
    });
    if (!expected.ok) throw new Error("control Card was invalid");
    const separators = [" ", "  ", "\t", "\n", "　", "　 "];
    for (const left of separators) {
      for (const right of separators) {
        const candidate = canonicalizeCard({
          type: "grammar",
          content: {
            canonicalForm: `〜${left}て${right}しまう`,
            meaning: "completion",
            formation: "て-form + しまう",
            usageNotes: "",
          },
        });
        expect(candidate.ok && candidate.value.claimKey).toBe(expected.value.claimKey);
      }
    }
  });

  test("FSRS transitions stay finite and never schedule into the past", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    let schedule = newSchedule(now);
    const grades = ["again", "hard", "good", "easy"] as const;
    for (let index = 0; index < 160; index += 1) {
      const next = scheduleAnswer(
        schedule,
        grades[index % grades.length] ?? "good",
        now,
      );
      expect(next.ok).toBe(true);
      if (!next.ok) break;
      expect(Number.isFinite(next.value.stability)).toBe(true);
      expect(Number.isFinite(next.value.difficulty)).toBe(true);
      expect(new Date(next.value.dueAt).getTime()).toBeGreaterThanOrEqual(
        now.getTime(),
      );
      expect(next.value.reps).toBe(schedule.reps + 1);
      schedule = next.value;
      now = new Date(
        Math.max(now.getTime() + 60_000, new Date(schedule.dueAt).getTime()),
      );
    }
  });

  test("daily admission equals the allowance across a bounded range", () => {
    for (let limit = 0; limit <= 10; limit += 1) {
      const clock = mutableClock("2026-09-08T10:00:00.000Z");
      const opened = openStudy({
        databasePath: ":memory:",
        clock: clock.now,
        nextId: sequentialIds(),
        permitVerifier: testPermitVerifier,
        knownWordSeed: testSeed,
      });
      if (!opened.ok) throw new Error(JSON.stringify(opened.error));
      const study = opened.value;
      for (let index = 0; index < 12; index += 1) {
        const input: CreateCard = {
          type: "vocabulary",
          content: {
            lemma: `語${index}`,
            reading: `ご${index}`,
            partOfSpeech: "noun",
            meaning: `synthetic sense ${index}`,
            usageNotes: "",
          },
        };
        const created = study.createCard(input);
        expect(created.ok).toBe(true);
      }
      study.setPreferences({ newCardsPerDay: limit });
      const queue = study.studyQueue();
      expect(queue).toMatchObject({
        ok: true,
        value: {
          admittedToday: limit,
          newlyAdmitted: limit,
          due: { length: limit },
          stagedCount: 12 - limit,
        },
      });
      study.close();
    }
  });
});
