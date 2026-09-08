import { describe, expect, test } from "bun:test";
import {
  freshHoldoutFixtures,
  invalidatedFreshHoldoutIds,
  selectionHoldoutFixtures,
} from "./retest-corpus.ts";
import { fixtureSchemaErrors } from "./schema.ts";

const frozenDigest = "5843099d91b038c2620c714014bbe5f254ac8975e6cf7d66b8ed88db6c55bc9a";
const frozenSelectionDigest =
  "e9e06228048df65cd8b8eebd41adf48b3773db3b5645169f8c313432255d8b78";

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

  test("replaces only the invalidated target annotations", () => {
    expect(invalidatedFreshHoldoutIds).toEqual(["fresh-13-1", "fresh-13-2"]);
    expect(selectionHoldoutFixtures).toHaveLength(40);
    expect(
      selectionHoldoutFixtures.some((fixture) => fixture.id === "fresh-13-1"),
    ).toBe(false);
    expect(
      selectionHoldoutFixtures.filter((fixture) =>
        fixture.riskSlices.includes("replacement"),
      ),
    ).toHaveLength(2);
    expect(
      new Bun.CryptoHasher("sha256")
        .update(JSON.stringify(selectionHoldoutFixtures))
        .digest("hex"),
    ).toBe(frozenSelectionDigest);
  });
});
