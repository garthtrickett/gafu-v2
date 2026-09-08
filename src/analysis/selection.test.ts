import { describe, expect, test } from "bun:test";
import { holdoutFixtures } from "../../tests/fixtures/japanese/corpus.ts";
import { selectionHoldoutFixtures } from "../../tests/fixtures/japanese/retest-corpus.ts";
import type { FixtureToken } from "../../tests/fixtures/japanese/schema.ts";
import type { BroadPartOfSpeech } from "./contracts.ts";
import { evaluateAnalyzer } from "./evaluate.ts";
import {
  classifyKnownVocabulary,
  type KnownVocabularyEntry,
} from "./known-vocabulary.ts";
import { createKuromojiAnalyzer } from "./kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "./loaders.ts";

const dictionaryPath = "node_modules/@faanau/kuromoji/dict";

const certain = <Value>(
  field:
    | { readonly kind: "certain"; readonly value: Value }
    | { readonly kind: "ambiguous" },
): Value | undefined => (field.kind === "certain" ? field.value : undefined);

const safeClosedClassEntry = (token: FixtureToken): KnownVocabularyEntry | null => {
  const partOfSpeech = certain<BroadPartOfSpeech>(token.partOfSpeech);
  if (
    token.knownBehavior !== "known" ||
    partOfSpeech === undefined ||
    !["particle", "auxiliary", "copula"].includes(partOfSpeech)
  ) {
    return null;
  }
  const lemma = certain<string>(token.lemma);
  const reading = certain<string | null>(token.reading);
  return lemma === undefined || reading === undefined
    ? null
    : { lemma, reading, partOfSpeech, scope: { kind: "allSenses" } };
};

describe("selected Japanese analyzer", () => {
  test("passes the replacement holdout thresholds", async () => {
    const analyzer = createKuromojiAnalyzer(() =>
      loadKuromojiFromDirectory(dictionaryPath),
    );
    const result = await evaluateAnalyzer(analyzer, selectionHoldoutFixtures);

    expect(result.normalization).toEqual({ numerator: 40, denominator: 40 });
    expect(result.spanReconstruction).toEqual({
      numerator: 411,
      denominator: 411,
    });
    expect(result.targetCombined).toEqual({ numerator: 40, denominator: 40 });
    expect(result.targetLemma).toEqual({ numerator: 40, denominator: 40 });
    expect(result.targetReading).toEqual({ numerator: 40, denominator: 40 });
    expect(result.targetPartOfSpeech).toEqual({
      numerator: 40,
      denominator: 40,
    });
  }, 15_000);

  test("is deterministic across ten complete warm runs", async () => {
    const analyzer = createKuromojiAnalyzer(() =>
      loadKuromojiFromDirectory(dictionaryPath),
    );
    const outputs: string[] = [];
    for (let run = 0; run < 10; run += 1) {
      const analyses = [];
      for (const fixture of selectionHoldoutFixtures) {
        analyses.push(await analyzer.analyze(fixture.id, fixture.rawText));
      }
      outputs.push(JSON.stringify(analyses));
    }
    expect(new Set(outputs).size).toBe(1);
  }, 20_000);

  test("has zero false-known exclusions under the conservative sense policy", async () => {
    const analyzer = createKuromojiAnalyzer(() =>
      loadKuromojiFromDirectory(dictionaryPath),
    );
    const bank = holdoutFixtures
      .flatMap((fixture) => fixture.tokens)
      .map(safeClosedClassEntry)
      .filter((entry): entry is KnownVocabularyEntry => entry !== null);
    let atRisk = 0;
    let falseKnown = 0;

    for (const fixture of holdoutFixtures) {
      const result = await analyzer.analyze(fixture.id, fixture.rawText);
      expect(result.ok, fixture.id).toBe(true);
      if (!result.ok) continue;
      const classified = classifyKnownVocabulary(result.value, bank);
      for (const expected of fixture.tokens) {
        if (
          expected.knownBehavior !== "unknown" &&
          expected.knownBehavior !== "ambiguous"
        ) {
          continue;
        }
        atRisk += 1;
        const observed = classified.find(
          (item) =>
            item.token.span.start === expected.span.start &&
            item.token.span.end === expected.span.end,
        );
        if (observed?.status === "known") falseKnown += 1;
      }
    }

    expect(atRisk).toBe(26);
    expect(falseKnown).toBe(0);
  }, 15_000);
});
