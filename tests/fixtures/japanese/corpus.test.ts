import { describe, expect, test } from "bun:test";
import {
  calibrationFixtures,
  holdoutFixtures,
  japaneseFixtureCorpus,
} from "./corpus.ts";
import { fixtureSchemaErrors } from "./schema.ts";

const certainValue = <Value>(
  value:
    | { readonly kind: "certain"; readonly value: Value }
    | { readonly kind: "ambiguous" },
): Value | undefined => (value.kind === "certain" ? value.value : undefined);

describe("Japanese fixture oracle", () => {
  test("meets the frozen corpus and risk-slice counts", () => {
    const heldoutTokens = holdoutFixtures.flatMap((fixture) => fixture.tokens);
    const nonPunctuation = heldoutTokens.filter(
      (token) => certainValue(token.partOfSpeech) !== "symbol",
    );
    const classifications = heldoutTokens.filter(
      (token) => token.knownBehavior === "known" || token.knownBehavior === "unknown",
    );
    const inflected = heldoutTokens.filter((token) =>
      token.flags.includes("inflected-target"),
    );
    const ambiguous = heldoutTokens.filter((token) =>
      token.flags.includes("ambiguous-target"),
    );
    const grammar = holdoutFixtures.flatMap((fixture) => fixture.grammar);

    expect(japaneseFixtureCorpus.length).toBeGreaterThanOrEqual(120);
    expect(calibrationFixtures).toHaveLength(1262);
    expect(holdoutFixtures).toHaveLength(630);
    expect(nonPunctuation.length).toBeGreaterThanOrEqual(300);
    expect(classifications.length).toBeGreaterThanOrEqual(100);
    expect(inflected.length).toBeGreaterThanOrEqual(30);
    expect(ambiguous.length).toBeGreaterThanOrEqual(20);
    expect(grammar.length).toBeGreaterThanOrEqual(40);
    expect(
      new Set(grammar.map((item) => item.construction)).size,
    ).toBeGreaterThanOrEqual(20);
  });

  test("every fixture is schema-valid and has unique identity", () => {
    expect(new Set(japaneseFixtureCorpus.map((fixture) => fixture.id)).size).toBe(
      japaneseFixtureCorpus.length,
    );
    for (const fixture of japaneseFixtureCorpus) {
      expect(fixtureSchemaErrors(fixture), fixture.id).toEqual([]);
    }
  });

  test("normalization and every annotated UTF-16 span reconstruct exactly", () => {
    for (const fixture of japaneseFixtureCorpus) {
      expect(fixture.rawText.normalize("NFKC"), fixture.id).toBe(
        fixture.expectedNormalized,
      );
      for (const token of fixture.tokens) {
        expect(
          fixture.expectedNormalized.slice(token.span.start, token.span.end),
          `${fixture.id}:${token.surface}`,
        ).toBe(token.surface);
      }
      for (const evidence of fixture.grammar) {
        for (const evidenceSpan of evidence.spans) {
          expect(evidenceSpan.start, fixture.id).toBeGreaterThanOrEqual(0);
          expect(evidenceSpan.end, fixture.id).toBeLessThanOrEqual(
            fixture.expectedNormalized.length,
          );
          expect(evidenceSpan.end, fixture.id).toBeGreaterThan(evidenceSpan.start);
        }
      }
    }
  });

  test("uncertain annotations never masquerade as one certain answer", () => {
    const uncertainTargets = holdoutFixtures.flatMap((fixture) =>
      fixture.tokens.filter((token) => token.flags.includes("ambiguous-target")),
    );
    expect(uncertainTargets).toHaveLength(25);
    for (const token of uncertainTargets) {
      const allowedCounts = [token.sense, token.lemma, token.reading]
        .filter((field) => field.kind === "ambiguous")
        .map((field) => field.allowed.length);
      expect(allowedCounts.length).toBeGreaterThanOrEqual(1);
      expect(Math.max(...allowedCounts)).toBeGreaterThanOrEqual(2);
    }
  });
});
