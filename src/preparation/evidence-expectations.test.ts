import { describe, expect, test } from "bun:test";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import type { AnalyzedCue } from "./batching-contracts.ts";
import {
  canonicalVocabulary,
  earnsCandidate,
  expectedAnnotations,
} from "./evidence-expectations.ts";

const token = (surface: string, broadPartOfSpeech: BroadPartOfSpeech) => ({
  surface,
  lemma: surface,
  reading: null,
  partOfSpeech: ["名詞"],
  broadPartOfSpeech,
  span: {
    start: 0,
    end: surface.length,
    unit: "utf16-code-unit" as const,
    normalization: "nfkc-v1" as const,
  },
});

describe("what a cue obliges the provider to return", () => {
  test("punctuation filed as a noun earns no candidate", () => {
    // Kuromoji files unrecognised symbol runs under 名詞/サ変接続, so these
    // arrive as nouns with a canonicalKey of punctuation plus a bare colon.
    for (const surface of ["!?", "...", "...\u266a", "-", "\u3002\u3002\u3002"]) {
      expect(earnsCandidate(token(surface, "noun"))).toBe(false);
    }
  });

  test("words keep earning one, including those without a reading", () => {
    for (const surface of ["\u732b", "\u30b0\u30ea\u30ba\u30ea\u30fc", "Wi", "24"]) {
      expect(earnsCandidate(token(surface, "noun"))).toBe(true);
    }
    // A null reading still means a trailing colon, which the model is given
    // rather than asked to derive.
    expect(canonicalVocabulary("\u30b0\u30ea\u30ba\u30ea\u30fc", null)).toBe(
      "\u30b0\u30ea\u30ba\u30ea\u30fc:",
    );
  });

  test("a non-content part of speech still earns nothing", () => {
    expect(earnsCandidate(token("\u306f", "particle"))).toBe(false);
  });

  test("expectations skip punctuation, so an answer that omits it agrees", () => {
    const cue: AnalyzedCue = {
      cueId: "cue-1",
      normalizedJapanese: "\u732b!?",
      tokens: [
        token("\u732b", "noun"),
        {
          ...token("!?", "noun"),
          span: { start: 1, end: 3, unit: "utf16-code-unit", normalization: "nfkc-v1" },
        },
      ],
      grammarEvidence: [],
    };
    const expected = expectedAnnotations([cue]);
    expect(expected.size).toBe(1);
    expect([...expected.values()]).toEqual(["\u732b:"]);
  });
});
