import { expect, test } from "bun:test";
import {
  mutableClock,
  permit,
  sequentialIds,
  testPermitVerifier,
  testSeed,
} from "../../tests/support/study.ts";
import { GRADUATE_AFTER_CORRECT } from "./contracts.ts";
import { STUCK_AFTER_FAILURES } from "./session-split.ts";
import { openStudy } from "./study.ts";

const open = () => {
  const clock = mutableClock("2026-09-20T01:00:00.000Z");
  const opened = openStudy({
    databasePath: ":memory:",
    clock: clock.now,
    nextId: sequentialIds(),
    permitVerifier: testPermitVerifier,
    knownWordSeed: testSeed,
    grammarTargetSupported: () => true,
  });
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  return { study: opened.value, clock };
};

const newCard = (study: ReturnType<typeof open>["study"]) => {
  const created = study.createCard({
    type: "vocabulary",
    content: {
      lemma: "応援する",
      reading: "おうえんする",
      partOfSpeech: "verb",
      meaning: "to cheer for",
      usageNotes: "",
    },
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  study.setPreferences({ newCardsPerDay: 5 });
  study.studyQueue();
  return created.value.card;
};

const answer = (
  study: ReturnType<typeof open>["study"],
  clock: ReturnType<typeof open>["clock"],
  cardId: string,
  grade: "good" | "again",
  token: string,
) => {
  const given = study.answer({
    cardId: cardId as never,
    grade,
    permit: permit(token, cardId as never, clock.now()),
  });
  if (!given.ok) throw new Error(JSON.stringify(given.error));
  return given.value;
};

const stageOf = (study: ReturnType<typeof open>["study"], cardId: string) => {
  const listed = study.listCards();
  if (!listed.ok) throw new Error("list");
  return listed.value.find((card) => card.id === cardId)?.stage;
};

test("a new Card is met as a word and graduates on three right in a row", () => {
  const { study, clock } = open();
  const card = newCard(study);
  expect(stageOf(study, card.id)).toBe("word");

  // Two right answers earn support readiness, and that alone is not enough:
  // a sentence may only lean on a word the learner has handled in a sentence.
  for (let index = 0; index < GRADUATE_AFTER_CORRECT - 1; index += 1) {
    clock.set(`2026-09-2${index + 1}T01:00:00.000Z`);
    answer(study, clock, card.id, "good", `ok-${index}`);
    expect(stageOf(study, card.id)).toBe("word");
  }
  expect(study.knowledgeSnapshot()).toMatchObject({
    ok: true,
    value: { vocabulary: { length: 2 } },
  });

  clock.set("2026-09-25T01:00:00.000Z");
  answer(study, clock, card.id, "good", "ok-last");
  expect(stageOf(study, card.id)).toBe("sentence");
  expect(study.knowledgeSnapshot()).toMatchObject({
    ok: true,
    value: { vocabulary: { length: 3 } },
  });
});

test("an Again breaks the run, so graduating means three without a miss", () => {
  const { study, clock } = open();
  const card = newCard(study);
  clock.set("2026-09-21T01:00:00.000Z");
  answer(study, clock, card.id, "good", "a");
  clock.set("2026-09-22T01:00:00.000Z");
  answer(study, clock, card.id, "again", "b");
  clock.set("2026-09-23T01:00:00.000Z");
  answer(study, clock, card.id, "good", "c");
  clock.set("2026-09-24T01:00:00.000Z");
  answer(study, clock, card.id, "good", "d");
  expect(stageOf(study, card.id)).toBe("word");
});

test("a sentence Card missed until it is stuck goes back to being a word", () => {
  const { study, clock } = open();
  const card = newCard(study);
  const graduated = study.setCardState({ cardId: card.id, action: "graduate" });
  if (!graduated.ok) throw new Error("graduate");
  expect(stageOf(study, card.id)).toBe("sentence");

  for (let index = 0; index < STUCK_AFTER_FAILURES; index += 1) {
    clock.set(`2026-09-2${index + 1}T01:00:00.000Z`);
    answer(study, clock, card.id, "again", `miss-${index}`);
  }
  // Back to a bare pair rather than suspended: the word is still being
  // learned, it is the sentence that was not helping.
  expect(stageOf(study, card.id)).toBe("word");
  expect(study.knowledgeSnapshot()).toMatchObject({
    ok: true,
    value: { vocabulary: { length: 2 } },
  });
});

test("saying a word is known sends it straight to sentences", () => {
  const { study } = open();
  const card = newCard(study);
  const marked = study.setCardState({ cardId: card.id, action: "markSupportReady" });
  if (!marked.ok) throw new Error("mark");
  expect(stageOf(study, card.id)).toBe("sentence");
  expect(study.knowledgeSnapshot()).toMatchObject({
    ok: true,
    value: { vocabulary: { length: 3 } },
  });
});
