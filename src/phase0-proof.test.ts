import { describe, expect, test } from "bun:test";
import { createKuromojiAnalyzer } from "./analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "./analysis/loaders.ts";
import { runPhase0Proof } from "./phase0-proof.ts";
import { err } from "./result.ts";

describe("integrated Phase 0 proof", () => {
  test("composes analysis, subtraction, complete batching, and validation", async () => {
    const analyzer = createKuromojiAnalyzer(() =>
      loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
    );
    const result = await runPhase0Proof(analyzer);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.analyzedCues).toBe(4);
    expect(result.value.batches).toBe(4);
    expect(result.value.finalBatchTargetFound).toBe(true);
    expect(result.value.validMaterialAccepted).toBe(true);
    expect(result.value.invalidMaterial).toHaveLength(3);
    expect(
      result.value.invalidMaterial.flatMap((fixture) => fixture.reasons),
    ).toContain("readingReconstructionMismatch");
    expect(
      result.value.invalidMaterial.flatMap((fixture) => fixture.reasons),
    ).toContain("unknownVocabulary");
    expect(
      result.value.invalidMaterial.flatMap((fixture) => fixture.reasons),
    ).toContain("unknownGrammar");
  }, 20_000);

  test("does not convert analyzer degradation into a partial success", async () => {
    const result = await runPhase0Proof({
      name: "injected-failure",
      analyze: async (cueId) =>
        err({ kind: "degraded", cueId, cause: "injected degradation" }),
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "analysisFailed",
        cueId: "diagnostic:episode-1:001",
        detail: "injected degradation",
      },
    });
  });
});
