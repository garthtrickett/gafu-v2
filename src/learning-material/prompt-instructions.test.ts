import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
  "allowedSupportingGrammar lists",
  "Do not pad",
  // A sentence that hands over the target is not a review.
  "more than one word should still fit the gap",
  "Where mode is teach",
  // Rules that predate this and must survive it.
  "must not be able to guess the target",
  "are English prose",
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

test("the prompt version moves when the ask changes", () => {
  // A generation completed under an older ask is not re-checked, so banked
  // sentences only make way for the new instruction if the version differs.
  const server = readFileSync("src/study/server.ts", "utf8");
  expect(server).toContain('promptVersion: "study-v8"');
});
