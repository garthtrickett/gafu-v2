import { describe, expect, test } from "bun:test";
import { holdoutFixtures } from "../../tests/fixtures/japanese/corpus.ts";
import {
  declaredGrammarDetector,
  declaredGrammarForms,
  supportsGrammarTarget,
} from "./declared-grammar.ts";

test("the declared detector covers every frozen grammar construction", () => {
  expect(new Set(declaredGrammarForms).size).toBe(315);
  for (const fixture of holdoutFixtures) {
    const observed = declaredGrammarDetector
      .detect(fixture.expectedNormalized)
      .map((evidence) => evidence.canonicalForm);
    for (const expected of fixture.grammar) {
      expect(observed, `${fixture.id}:${expected.construction}`).toContain(
        expected.construction,
      );
    }
  }
});

test("morphologically ambiguous spans retain both distinct grammar identities", () => {
  const detected = declaredGrammarDetector.detect("これはされる。");
  expect(detected.map((evidence) => evidence.canonicalForm)).toContain("受身形");
  expect(detected.map((evidence) => evidence.canonicalForm)).toContain("可能形");
});

describe("which Grammar Cards material can be generated for", () => {
  test("accepts a declared construction however it is written", () => {
    // The declared forms are written for a reader: some carry the placeholder
    // tilde, some a parenthetical sense, some list alternates. All of these
    // name the same construction as the declared `\u301c\u3066\u3057\u307e\u3046\uff08\u7e2e\u7d04\uff09`.
    for (const form of [
      "\u301c\u3066\u3057\u307e\u3046",
      "\u3066\u3057\u307e\u3046",
      "\u301c\u3066\u3057\u307e\u3046\uff08\u7e2e\u7d04\uff09",
      "\u3061\u3083\u3046",
    ]) {
      expect(supportsGrammarTarget(form)).toBe(true);
    }
  });

  test("accepts the bare conjugation forms", () => {
    for (const form of [
      "\u53ef\u80fd\u5f62",
      "\u53d7\u8eab\u5f62",
      "\u4f7f\u5f79\u5f62",
    ]) {
      expect(supportsGrammarTarget(form)).toBe(true);
    }
  });

  test("accepts a declared construction written at another character width", () => {
    // The V1 migration created these with an ASCII tilde and halfwidth
    // brackets; the declared forms use the fullwidth pair. They are the same
    // constructions, and a literal comparison left four Cards in the deck
    // that would have stopped the session that reached them.
    for (const form of [
      "Verb[\u305b\u308b\u30fb\u3055\u305b\u308b]",
      "~\u3066\u3082~\u306a\u304f\u3066\u3082",
      "\u3059\u3053\u3057\u3082~\u306a\u3044",
      "\u3068\u304b~\u3068\u304b",
    ]) {
      expect(supportsGrammarTarget(form)).toBe(true);
    }
  });

  test("refuses a construction that was never declared", () => {
    // Idioms and patterns outside the declared set. Accepting one stores a
    // Card that cannot be taught, and the session that reaches it fails.
    for (const form of [
      "\u9593\u304c\u60aa\u3044",
      "\u5143\u3082\u5b50\u3082\u306a\u3044",
      "\u301c\u304b\u3089\u306b\u306f",
      "\u301c\u3066\u3053\u305d",
      "\u79c1\u3068\u3057\u305f\u3053\u3068\u304c",
      "\u6211\u306a\u304c\u3089",
    ]) {
      expect(supportsGrammarTarget(form)).toBe(false);
    }
  });

  test("refuses an empty or punctuation-only form", () => {
    for (const form of ["", "   ", "\u301c", "\uff08\uff09"]) {
      expect(supportsGrammarTarget(form)).toBe(false);
    }
  });
});
