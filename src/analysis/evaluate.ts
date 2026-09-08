import type {
  Certainty,
  FixtureToken,
  JapaneseCueFixture,
} from "../../tests/fixtures/japanese/schema.ts";
import type { AnalyzedText, JapaneseAnalyzer } from "./contracts.ts";

export type Metric = Readonly<{ numerator: number; denominator: number }>;

export type AnalyzerEvaluation = Readonly<{
  analyzer: string;
  fixtures: number;
  successfulFixtures: number;
  normalization: Metric;
  spanReconstruction: Metric;
  targetLemma: Metric;
  targetReading: Metric;
  targetPartOfSpeech: Metric;
  targetCombined: Metric;
  targetConjugation: Metric;
  perFixture: readonly Readonly<{
    id: string;
    success: boolean;
    failures: readonly string[];
  }>[];
}>;

const metric = (): { numerator: number; denominator: number } => ({
  numerator: 0,
  denominator: 0,
});

const certain = <Value>(field: Certainty<Value>): Value | undefined =>
  field.kind === "certain" ? field.value : undefined;

const targetResult = (analysis: AnalyzedText, target: FixtureToken) =>
  analysis.tokens.find(
    (token) =>
      token.span.start === target.span.start && token.span.end === target.span.end,
  );

export const evaluateAnalyzer = async (
  analyzer: JapaneseAnalyzer,
  fixtures: readonly JapaneseCueFixture[],
): Promise<AnalyzerEvaluation> => {
  const normalization = metric();
  const spanReconstruction = metric();
  const targetLemma = metric();
  const targetReading = metric();
  const targetPartOfSpeech = metric();
  const targetCombined = metric();
  const targetConjugation = metric();
  let successfulFixtures = 0;

  const perFixture = [];
  for (const fixture of fixtures) {
    const failures: string[] = [];
    const result = await analyzer.analyze(fixture.id, fixture.rawText);
    if (!result.ok) {
      perFixture.push({
        id: fixture.id,
        success: false,
        failures: [result.error.kind],
      });
      continue;
    }
    successfulFixtures += 1;
    normalization.denominator += 1;
    if (result.value.normalizedText === fixture.expectedNormalized) {
      normalization.numerator += 1;
    } else {
      failures.push("normalization");
    }

    for (const token of result.value.tokens) {
      spanReconstruction.denominator += 1;
      if (
        result.value.normalizedText.slice(token.span.start, token.span.end) ===
        token.surface
      ) {
        spanReconstruction.numerator += 1;
      } else {
        failures.push("spanReconstruction");
      }
    }

    const target =
      fixture.targetTokenIndex === null
        ? undefined
        : fixture.tokens[fixture.targetTokenIndex];
    if (target !== undefined && !target.flags.includes("ambiguous-target")) {
      const observed = targetResult(result.value, target);
      const expectedLemma = certain<string>(target.lemma);
      const expectedReading = certain<string | null>(target.reading);
      const expectedPos = certain<string>(target.partOfSpeech);
      const expectedConjugation = certain<string | null>(target.conjugation);
      const comparisons = [
        [targetLemma, "targetLemma", observed?.lemma === expectedLemma],
        [targetReading, "targetReading", observed?.reading === expectedReading],
        [
          targetPartOfSpeech,
          "targetPartOfSpeech",
          observed?.broadPartOfSpeech === expectedPos,
        ],
        [
          targetConjugation,
          "targetConjugation",
          observed?.conjugation === expectedConjugation,
        ],
      ] as const;
      for (const [score, name, passed] of comparisons) {
        score.denominator += 1;
        if (passed) score.numerator += 1;
        else failures.push(name);
      }
      targetCombined.denominator += 1;
      if (comparisons.slice(0, 3).every((comparison) => comparison[2])) {
        targetCombined.numerator += 1;
      }
    }
    perFixture.push({ id: fixture.id, success: failures.length === 0, failures });
  }

  return {
    analyzer: analyzer.name,
    fixtures: fixtures.length,
    successfulFixtures,
    normalization,
    spanReconstruction,
    targetLemma,
    targetReading,
    targetPartOfSpeech,
    targetCombined,
    targetConjugation,
    perFixture,
  };
};
