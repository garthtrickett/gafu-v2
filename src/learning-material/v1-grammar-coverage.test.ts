import { expect, test } from "bun:test";
import { v1GrammarInventory } from "../../tests/fixtures/japanese/v1-grammar-inventory.ts";
import { declaredGrammarDetector, declaredGrammarForms } from "./declared-grammar.ts";

test("every migrated V1 grammar card has a detector entry under its exact name", () => {
  expect(v1GrammarInventory).toHaveLength(296);
  const declared = new Set(declaredGrammarForms);
  const missing = v1GrammarInventory.filter((name) => !declared.has(name));
  expect(missing).toEqual([]);
});

test("overlapping constructions retain every identity (keep-all overlap policy)", () => {
  // 〜ても inside 〜てもいい: both fire, so a sentence using 〜てもいい requires
  // the learner to know both. New patterns must preserve this property rather
  // than shadowing shorter constructions with longer ones.
  const detected = declaredGrammarDetector
    .detect("外で食べてもいい。")
    .map((evidence) => evidence.canonicalForm);
  expect(detected).toContain("〜てもいい");
  expect(detected).toContain("〜ても");
});

test("full-width tilde names match their ASCII-normalized surfaces", () => {
  // NFKC maps ～ (U+FF5E) to ~ (U+007E) while 〜 (U+301C) is unchanged, so a
  // pattern registered under a ～-style V1 name must fire on ~-surfaces.
  const detected = declaredGrammarDetector
    .detect("学生~んです。".normalize("NFKC"))
    .map((evidence) => evidence.canonicalForm);
  expect(detected).toContain("～んです");
});
