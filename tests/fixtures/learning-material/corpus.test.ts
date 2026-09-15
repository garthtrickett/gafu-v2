import { expect, test } from "bun:test";
import {
  adversarialManifest,
  grammarBases,
  invalidFaults,
  vocabularyBases,
} from "./corpus.ts";

test("the learning-material adversarial manifest is frozen and balanced", () => {
  expect(vocabularyBases).toHaveLength(40);
  expect(grammarBases).toHaveLength(40);
  expect(invalidFaults).toHaveLength(15);
  expect(adversarialManifest.validVocabulary).toHaveLength(40);
  expect(adversarialManifest.validGrammar).toHaveLength(40);
  expect(adversarialManifest.invalidVocabulary).toHaveLength(600);
  expect(adversarialManifest.invalidGrammar).toHaveLength(600);
  expect(
    new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(adversarialManifest))
      .digest("hex"),
  ).toBe("443c8787d5130348f4633e58ea3fccf5cce5062472056b06b169b8f687eb16f0");
});
