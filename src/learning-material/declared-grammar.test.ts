import { expect, test } from "bun:test";
import { holdoutFixtures } from "../../tests/fixtures/japanese/corpus.ts";
import { declaredGrammarDetector, declaredGrammarForms } from "./declared-grammar.ts";

test("the declared detector covers every frozen grammar construction", () => {
  expect(new Set(declaredGrammarForms).size).toBe(22);
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
