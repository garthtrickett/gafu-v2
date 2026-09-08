import { describe, expect, test } from "bun:test";
import {
  type LegacyCharacterization,
  legacyCharacterizationCases,
} from "./legacy-characterization.ts";

describe("legacy failure characterization", () => {
  test("keeps one explicit V2 boundary for every named V1 failure", () => {
    const expectedKinds: LegacyCharacterization["kind"][] = [
      "catalogue-only-grammar",
      "degraded-token-success",
      "non-bmp-offset-drift",
      "normalization-span-drift",
      "partial-target-match",
      "reading-reconstruction-mismatch",
      "sense-blind-identity",
      "silent-batch-omission",
    ];
    expect(legacyCharacterizationCases.map((item) => item.kind).sort()).toEqual(
      expectedKinds.sort(),
    );
    expect(new Set(legacyCharacterizationCases.map((item) => item.id)).size).toBe(
      legacyCharacterizationCases.length,
    );
    for (const item of legacyCharacterizationCases) {
      expect(item.legacyBehavior.length).toBeGreaterThan(20);
      expect(item.v2Requirement.length).toBeGreaterThan(20);
    }
  });
});
