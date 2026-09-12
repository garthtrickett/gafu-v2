import { describe, expect, test } from "bun:test";
import {
  extractJapaneseLookupTerm,
  jishoWebUrl,
  normalizeJishoResponse,
} from "./jisho.ts";

describe("reducing a highlight to a lookup term", () => {
  test("keeps a plain Japanese word", () => {
    expect(extractJapaneseLookupTerm("放題")).toBe("放題");
  });

  test("collapses the layout whitespace a ruby selection carries", () => {
    expect(extractJapaneseLookupTerm(" 食\n べる ")).toBe("食べる");
  });

  test("strips punctuation from the edges only", () => {
    expect(extractJapaneseLookupTerm("「犬」")).toBe("犬");
    expect(extractJapaneseLookupTerm("攻める。")).toBe("攻める");
  });

  test("keeps iteration and long-vowel marks inside words", () => {
    expect(extractJapaneseLookupTerm("人々")).toBe("人々");
    expect(extractJapaneseLookupTerm("コーヒー")).toBe("コーヒー");
  });

  test("rejects a selection with no Japanese in it", () => {
    expect(extractJapaneseLookupTerm("in use")).toBeNull();
    expect(extractJapaneseLookupTerm("…")).toBeNull();
  });

  test("rejects a whole-sentence drag", () => {
    expect(
      extractJapaneseLookupTerm(
        "今日買うと得する。とても嬉しいことだと思いますね、本当に。",
      ),
    ).toBeNull();
  });
});

describe("reducing jisho.org's payload to the contract", () => {
  const payload = {
    data: [
      {
        slug: "放題",
        is_common: true,
        jlpt: ["jlpt-n2"],
        japanese: [{ word: "放題", reading: "ほうだい" }, { reading: "ほうだい" }],
        senses: [
          {
            english_definitions: ["as much as you like", " all-you-can- "],
            parts_of_speech: ["Suffix"],
            tags: ["Usually written using kana alone"],
            see_also: ["食べ放題"],
          },
          { english_definitions: [], parts_of_speech: ["Noun"] },
        ],
      },
      { slug: "no-senses", senses: [] },
      "not an entry",
    ],
  };

  test("maps the community payload onto the wire contract", () => {
    expect(normalizeJishoResponse(payload, "放題")).toEqual({
      term: "放題",
      entries: [
        {
          slug: "放題",
          isCommon: true,
          jlpt: ["jlpt-n2"],
          forms: [
            { word: "放題", reading: "ほうだい" },
            { word: null, reading: "ほうだい" },
          ],
          senses: [
            {
              englishDefinitions: ["as much as you like", "all-you-can-"],
              partsOfSpeech: ["Suffix"],
              tags: ["Usually written using kana alone"],
              seeAlso: ["食べ放題"],
            },
          ],
        },
      ],
    });
  });

  test("an unreadable or empty payload is no entries, not a failure", () => {
    expect(normalizeJishoResponse(null, "犬")).toEqual({ term: "犬", entries: [] });
    expect(normalizeJishoResponse({ data: "nope" }, "犬")).toEqual({
      term: "犬",
      entries: [],
    });
  });

  test("a missing slug falls back to the first form, then the term", () => {
    const entry = (japanese: unknown) => ({
      data: [{ japanese, senses: [{ english_definitions: ["x"] }] }],
    });
    expect(
      normalizeJishoResponse(entry([{ word: "犬" }]), "いぬ").entries[0]?.slug,
    ).toBe("犬");
    expect(normalizeJishoResponse(entry([]), "いぬ").entries[0]?.slug).toBe("いぬ");
  });

  test("bounds what one lookup can render", () => {
    const sense = { english_definitions: ["d"] };
    const many = {
      data: Array.from({ length: 10 }, () => ({
        slug: "x",
        senses: Array.from({ length: 9 }, () => sense),
      })),
    };
    const result = normalizeJishoResponse(many, "x");
    expect(result.entries).toHaveLength(6);
    expect(result.entries[0]?.senses).toHaveLength(5);
  });
});

test("the public site link encodes the term", () => {
  expect(jishoWebUrl("食べ放題")).toBe(
    "https://jisho.org/search/%E9%A3%9F%E3%81%B9%E6%94%BE%E9%A1%8C",
  );
});
