import { describe, expect, test } from "bun:test";
import { createKuromojiAnalyzer } from "./kuromoji-analyzer.ts";
import { mapNormalizedBoundariesToRaw } from "./normalization.ts";

describe("Japanese analysis boundary", () => {
  test("dictionary failure yields no trusted fallback tokens", async () => {
    const analyzer = createKuromojiAnalyzer(async () => {
      throw new Error("dictionary missing");
    });

    const result = await analyzer.analyze("cue-1", "猫がいる。");

    expect(result).toEqual({
      ok: false,
      error: { kind: "analyzerUnavailable", cause: "dictionary missing" },
    });
  });

  test("maps normalized boundaries back to raw UTF-16 boundaries", () => {
    expect(mapNormalizedBoundariesToRaw("ﾐﾅ🎵", "ミナ🎵")).toEqual([0, 1, 2, 3, 4]);
  });
});
