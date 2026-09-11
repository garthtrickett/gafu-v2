import { describe, expect, test } from "bun:test";
import { splitFurigana } from "./furigana.ts";

const shown = (written: string, reading: string): string => {
  const { before, body, over, after } = splitFurigana(written, reading);
  return body === "" ? before : `${before}[${body}:${over}]${after}`;
};

describe("where a reading sits over a written form", () => {
  test("okurigana the reading shares is left as writing", () => {
    // Not 広い[ひろい], which prints い twice: once as writing, once above it.
    expect(shown("広い", "ひろい")).toBe("[広:ひろ]い");
    expect(shown("見極め", "みきわめ")).toBe("[見極:みきわ]め");
    expect(shown("盛り合わせ", "もりあわせ")).toBe("[盛り合:もりあ]わせ");
  });

  test("a shared kana prefix is left as writing too", () => {
    expect(shown("お客", "おきゃく")).toBe("お[客:きゃく]");
  });

  test("a form that is all kanji takes the whole reading", () => {
    expect(shown("肩幅", "かたはば")).toBe("[肩幅:かたはば]");
  });

  test("kana needs no reading over it", () => {
    // が over が is noise that only pushes the line apart.
    expect(shown("が", "が")).toBe("が");
    expect(shown("かなり", "かなり")).toBe("かなり");
    expect(shown("。", "。")).toBe("。");
  });

  test("a missing or unhelpful reading shows the writing alone", () => {
    expect(shown("肩幅", "")).toBe("肩幅");
    expect(shown("肩幅", "肩幅")).toBe("肩幅");
  });

  test("trimming never consumes the form it was meant to annotate", () => {
    // Reading equal to the okurigana alone would trim to nothing to annotate.
    expect(shown("広い", "い")).toBe("広い");
  });

  test("the written form is always recoverable", () => {
    // The validator requires segments to rejoin into exactly the sentence, so
    // a split that loses a character would corrupt what the learner reads.
    for (const [written, reading] of [
      ["広い", "ひろい"],
      ["お客", "おきゃく"],
      ["肩幅", "かたはば"],
      ["が", "が"],
      ["食べ物", "たべもの"],
      ["々", "どう"],
    ] as const) {
      const { before, body, after } = splitFurigana(written, reading);
      expect(`${before}${body}${after}`).toBe(written);
    }
  });
});
