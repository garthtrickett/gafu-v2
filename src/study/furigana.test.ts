import { describe, expect, test } from "bun:test";
import { alignFurigana, splitFurigana } from "./furigana.ts";

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

const aligned = (written: string, reading: string): string =>
  alignFurigana(written, reading)
    .map((piece) =>
      piece.reading === null ? piece.text : `[${piece.text}:${piece.reading}]`,
    )
    .join("");

describe("aligning a reading to a written phrase", () => {
  test("kana and punctuation at either edge stay as writing", () => {
    expect(aligned("噂だけでなく、", "うわさだけでなく、")).toBe(
      "[噂:うわさ]だけでなく、",
    );
    expect(aligned("も広がる。", "もひろがる。")).toBe("も[広:ひろ]がる。");
    expect(aligned("評判", "ひょうばん")).toBe("[評判:ひょうばん]");
  });

  test("kana between kanji runs is matched, so each run carries only its own reading", () => {
    expect(aligned("食べ放題", "たべほうだい")).toBe("[食:た]べ[放題:ほうだい]");
    expect(aligned("消しゴム", "けしごむ")).toBe("[消:け]しゴム");
    expect(aligned("引っ越し", "ひっこし")).toBe("[引:ひ]っ[越:こ]し");
  });

  test("katakana in the writing matches its hiragana reading, and the shown reading is the original", () => {
    expect(aligned("コーヒー", "こーひー")).toBe("コーヒー");
    expect(aligned("食べ放題", "タベホウダイ")).toBe("[食:タ]べ[放題:ホウダイ]");
  });

  test("a reading the writing cannot explain falls back to trimming the edges", () => {
    // Reading has no る: no literal match, so the old behaviour applies.
    expect(aligned("広がる", "ひろい")).toBe("[広がる:ひろい]");
    expect(aligned("広い", "い")).toBe("広い");
  });

  test("the written form is always recoverable", () => {
    for (const [written, reading] of [
      ["噂だけでなく、", "うわさだけでなく、"],
      ["食べ放題", "たべほうだい"],
      ["コーヒー", "こーひー"],
      ["広がる", "ひろい"],
      ["人々", "ひとびと"],
    ] as const) {
      expect(
        alignFurigana(written, reading)
          .map((piece) => piece.text)
          .join(""),
      ).toBe(written);
    }
  });
});
