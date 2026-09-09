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

  test("retries tokenizer loading after a transient failure", async () => {
    let attempts = 0;
    const analyzer = createKuromojiAnalyzer(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary read failure");
      return {
        tokenize: () => [
          {
            word_id: 1,
            word_type: "KNOWN",
            word_position: 1,
            surface_form: "猫",
            pos: "名詞",
            pos_detail_1: "一般",
            pos_detail_2: "*",
            pos_detail_3: "*",
            conjugated_type: "*",
            conjugated_form: "*",
            basic_form: "猫",
            reading: "ネコ",
            pronunciation: "ネコ",
          },
        ],
      } as never;
    });

    expect((await analyzer.analyze("cue-1", "猫")).ok).toBe(false);
    expect((await analyzer.analyze("cue-1", "猫")).ok).toBe(true);
    expect(attempts).toBe(2);
  });

  test("maps normalized boundaries back to raw UTF-16 boundaries", () => {
    expect(mapNormalizedBoundariesToRaw("ﾐﾅ🎵", "ミナ🎵")).toEqual([0, 1, 2, 3, 4]);
  });
});
