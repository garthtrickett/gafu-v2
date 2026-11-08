import { expect, test } from "bun:test";
import {
  mutableClock,
  sequentialIds,
  testPermitVerifier,
  testSeed,
} from "../../tests/support/study.ts";
import { openStudy } from "./study.ts";

const setup = () => {
  const clock = mutableClock("2026-11-08T10:00:00Z");
  const result = openStudy({
    databasePath: ":memory:",
    clock: clock.now,
    nextId: sequentialIds(),
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
    grammarTargetSupported: () => true,
  });
  if (!result.ok) throw new Error(result.error.kind);
  return { study: result.value, clock };
};
test("preparation snapshot is read-only across rollover and preserves the shared admission quota", () => {
  const { study, clock } = setup();
  try {
    study.setPreferences({ newCardsPerDay: 2 });
    for (let i = 0; i < 5; i++)
      expect(
        study.createCard({
          type: "grammar",
          content: {
            canonicalForm: `test-${i}`,
            meaning: "test",
            formation: "test",
            usageNotes: "",
          },
        }).ok,
      ).toBe(true);
    expect(study.duePreparationSnapshot()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 0, stagedCount: 5, due: [] },
    });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 2, stagedCount: 3 },
    });
    clock.set("2026-11-09T10:00:00Z");
    for (let i = 0; i < 3; i++)
      expect(study.duePreparationSnapshot()).toMatchObject({
        ok: true,
        value: { newlyAdmitted: 0, stagedCount: 3 },
      });
    expect(study.studyQueue()).toMatchObject({
      ok: true,
      value: { newlyAdmitted: 2, stagedCount: 1 },
    });
  } finally {
    study.close();
  }
});
test("server preparation requires an explicit mode and legacy settings cannot accidentally downgrade it", () => {
  const { study } = setup();
  try {
    expect(study.preferences()).toMatchObject({
      ok: true,
      value: { automaticPreparation: "whileOpen" },
    });
    expect(study.setPreferences({ automaticPreparation: "server" })).toMatchObject({
      ok: true,
      value: { automaticPreparation: "server", prepareInBackground: true },
    });
    expect(study.setPreferences({ prepareInBackground: true })).toMatchObject({
      ok: true,
      value: { automaticPreparation: "server" },
    });
    expect(
      study.setPreferences({
        automaticPreparation: "server",
        prepareInBackground: false,
      }).ok,
    ).toBe(false);
    expect(study.setPreferences({ prepareInBackground: false })).toMatchObject({
      ok: true,
      value: { automaticPreparation: "off" },
    });
    expect(study.setPreferences({ prepareInBackground: true })).toMatchObject({
      ok: true,
      value: { automaticPreparation: "whileOpen" },
    });
  } finally {
    study.close();
  }
});
