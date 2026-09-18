import { ok } from "../result.ts";
import type { ReadingProvider } from "./reading.ts";

/**
 * A reading provider for tests and the browser journey.
 *
 * It writes the shortest sentence that can be valid: the beat's own word, or
 * the first word the learner knows when the beat asks for none, followed by
 * the copula. That is not a retelling of anything, which is the point — the
 * journey is checking the plumbing and the i+1 rule, not the prose.
 */
export const createDeterministicReadingProvider = (): ReadingProvider => ({
  write: async (request) => {
    const target = request.target;
    if (target !== null) {
      return ok({
        japanese: `${target.lemma}だ。`,
        english: `It is ${target.meaning}.`,
        segments: [
          { written: target.lemma, reading: target.reading },
          { written: "だ。", reading: "だ。" },
        ],
      });
    }
    const first = request.knowledge.vocabulary[0];
    if (first === undefined) {
      return ok({
        japanese: "そうだ。",
        english: "So it is.",
        segments: [{ written: "そうだ。", reading: "そうだ。" }],
      });
    }
    return ok({
      japanese: `${first.lemma}だ。`,
      english: `It is ${first.meaning}.`,
      segments: [
        { written: first.lemma, reading: first.reading },
        { written: "だ。", reading: "だ。" },
      ],
    });
  },
});
