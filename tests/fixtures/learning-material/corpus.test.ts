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
  ).toBe("9f29b0c88ab01f9882807496c062267de6e56358df1f15b29ff209d0c24c9e40");
});
