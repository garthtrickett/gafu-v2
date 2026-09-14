import { describe, expect, test } from "bun:test";
import { createKuromojiAnalyzer } from "./kuromoji-analyzer.ts";
import {
  dictionaryFormReading,
  mapNormalizedBoundariesToRaw,
} from "./normalization.ts";

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

describe("the reading of a token's dictionary form", () => {
  test.each([
    // Inflection rewrites the kana tail, and the tail is read as written.
    ["聞き出し", "ききだし", "聞き出す", "ききだす"],
    ["話し", "はなし", "話す", "はなす"],
    ["食べ", "たべ", "食べる", "たべる"],
    // A sound change lives in the tail too, so it goes with it.
    ["行っ", "いっ", "行く", "いく"],
    ["買っ", "かっ", "買う", "かう"],
    // Homographs stay apart, which reading the lemma afresh would lose.
    ["開い", "ひらい", "開く", "ひらく"],
    ["開い", "あい", "開く", "あく"],
    // An uninflected token reads as itself.
    ["鳥", "とり", "鳥", "とり"],
    // Katakana in, hiragana out: readings are phonological.
    ["モテ", "モテ", "モテる", "もてる"],
  ])("%s read %s is %s read %s", (surface, reading, lemma, expected) => {
    expect(dictionaryFormReading(surface, reading, lemma)).toBe(expected);
  });

  test.each([
    // The irregular verbs share no writing between stem and dictionary form,
    // so nothing can be swapped and a guess would be wrong.
    ["し", "し", "する"],
    // A tail that is not kana is not inflection.
    ["取り出", "とりだ", "取り出荷"],
  ])("declines to derive one for %s", (surface, reading, lemma) => {
    expect(dictionaryFormReading(surface, reading, lemma)).toBeNull();
  });
});
