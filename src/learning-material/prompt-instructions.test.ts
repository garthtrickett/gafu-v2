import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PLAIN_AFTER_CORRECT } from "../study/contracts.ts";

/**
 * The single-Card and whole-batch prompts are separate strings that must say
 * the same things. Editing one and not the other is the obvious failure, and
 * inserting into one of them twice is the less obvious one — both happened
 * while this instruction was being written.
 */
const source = readFileSync("src/learning-material/openai-provider.ts", "utf8");

const SHARED = [
  // The Japanese is a remark, not a dictionary example. Without this the
  // model wrote the shortest thing that passed: 友達を応援する。
  "the Japanese is what they say to them",
  "is a dictionary example however politely it is phrased",
  "the particles and the words it normally goes with",
  // Measured, not guessed: してる fails the target match and 〜てる reads as
  // a word the learner does not have, so natural must not mean contracted.
  "a spoken contraction such as してる",
  "every construction in the sentence",
  "never empty where the writing has kanji",
  "including the sentence-final 。",
  "Do not pad",
  // How much of the target's work the rest of the sentence does is the one
  // thing that changes with the learner, and it changes in both prompts.
  "depends on target.consecutiveCorrect",
  "the sentence must give the target away",
  "targetという plus a near-synonym",
  "if a faithful translation sounds awkward",
  "several different words should still fit the gap",
  "either hands the word over or it does not",
  // Rules that predate this and must survive it.
  "must not be able to guess the target",
  "are English prose",
  "without the helper verbs that follow it",
  "falls inside",
];

test("both prompts carry every shared rule, once each", () => {
  for (const rule of SHARED) {
    expect({ rule, count: source.split(rule).length - 1 }).toEqual({
      rule,
      count: 2,
    });
  }
});

test("both prompts turn the support off at the number the code holds", () => {
  // The boundary is written into the prompt as a numeral and nowhere else,
  // so moving the constant without moving the prose would leave the code
  // saying one thing and the model doing another.
  for (const phrase of [
    `under ${PLAIN_AFTER_CORRECT}`,
    `Under ${PLAIN_AFTER_CORRECT},`,
    `At ${PLAIN_AFTER_CORRECT} or more`,
  ]) {
    expect({ phrase, count: source.split(phrase).length - 1 }).toEqual({
      phrase,
      count: 2,
    });
  }
});

test("the prompt version moves when the ask changes", () => {
  // The stored version records which instructions produced each candidate.
  // Existing reserves remain until served; this only changes new generations.
  const server = readFileSync("src/study/server.ts", "utf8");
  expect(server).toContain('promptVersion: "study-v13"');
});

/**
 * The prompt asks for the readings; the provider is what makes asking count.
 * A reading of "" passes every other check — the written fields still spell
 * the sentence, and an absent reading cannot be misplaced — so a model told
 * "the written fields must reconstruct japanese" satisfied it with one
 * segment carrying the whole sentence and no reading at all. Twenty-four
 * sentences reached the learner with no ruby over any of them.
 */
test("a candidate with no reading over its kanji is not accepted", () => {
  const source = readFileSync("src/learning-material/openai-provider.ts", "utf8");
  // Both paths a candidate can arrive by: one Card at a time, and the batch.
  expect(source.split("carriesReadings").length - 1).toBeGreaterThanOrEqual(3);
  expect(source).toContain("left the readings empty over kanji");
});
