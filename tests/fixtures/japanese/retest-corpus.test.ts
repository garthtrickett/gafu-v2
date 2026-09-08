import { describe, expect, test } from "bun:test";
import { freshHoldoutFixtures } from "./retest-corpus.ts";
import { fixtureSchemaErrors } from "./schema.ts";

const frozenDigest = "5843099d91b038c2620c714014bbe5f254ac8975e6cf7d66b8ed88db6c55bc9a";

describe("fresh analyzer holdout", () => {
  test("is frozen and independently meets the selection coverage floor", () => {
    const tokens = freshHoldoutFixtures.flatMap((fixture) => fixture.tokens);
    const nonPunctuation = tokens.filter(
      (token) =>
        token.partOfSpeech.kind !== "certain" || token.partOfSpeech.value !== "symbol",
    );
    const grammar = freshHoldoutFixtures.flatMap((fixture) => fixture.grammar);

    expect(freshHoldoutFixtures).toHaveLength(40);
    expect(nonPunctuation.length).toBeGreaterThanOrEqual(300);
    expect(
      tokens.filter((token) => token.flags.includes("inflected-target")).length,
    ).toBeGreaterThanOrEqual(30);
    expect(grammar).toHaveLength(40);
    expect(new Set(grammar.map((item) => item.construction)).size).toBe(20);
    for (const fixture of freshHoldoutFixtures) {
      expect(fixtureSchemaErrors(fixture), fixture.id).toEqual([]);
      expect(fixture.rawText.normalize("NFKC"), fixture.id).toBe(
        fixture.expectedNormalized,
      );
    }

    expect(
      new Bun.CryptoHasher("sha256")
        .update(JSON.stringify(freshHoldoutFixtures))
        .digest("hex"),
    ).toBe(frozenDigest);
  });
});
