import { describe, expect, test } from "bun:test";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import type { TaleWord } from "./contracts.ts";
import { createDeterministicReadingProvider } from "./deterministic-reading.ts";
import {
  alreadyHas,
  checkBeat,
  introducedBefore,
  type ReadingDependencies,
  writeReading,
} from "./reading.ts";
import { taleById } from "./tales.ts";

const known = (
  lemma: string,
  reading: string,
  partOfSpeech: string,
): KnowledgeSnapshot["vocabulary"][number] => ({
  key: `baseline:${lemma}`,
  baselineKey: lemma,
  lemma,
  reading,
  partOfSpeech,
  meaning: lemma,
  source: "baseline",
  senseIds: [],
});

const knowledge: KnowledgeSnapshot = {
  vocabulary: [
    known("女", "おんな", "noun"),
    known("川", "かわ", "noun"),
    known("行く", "いく", "verb"),
    known("見る", "みる", "verb"),
    known("大きい", "おおきい", "adjective"),
  ],
  grammar: [],
  baseline: {
    id: "test",
    version: null,
    availability: "unavailable",
    enabledCount: 0,
    entries: [],
  },
};

const dependencies: ReadingDependencies = {
  analyzer: createKuromojiAnalyzer(() =>
    loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
  ),
  provider: {
    write: async () => ({ ok: false, error: { kind: "unused", detail: "" } }),
  },
  transparentPartOfSpeech: new Set<BroadPartOfSpeech>([
    "particle",
    "auxiliary",
    "copula",
    "symbol",
  ]),
};

const momo: TaleWord = {
  lemma: "桃",
  reading: "もも",
  partOfSpeech: "noun",
  meaning: "peach",
};

/** One segment per sentence rejoins trivially and asks for no furigana. */
const draft = (japanese: string, english: string) => ({
  japanese,
  english,
  segments: [{ written: japanese, reading: "" }],
});

describe("a sentence of a tale is i or i+1, never i+2", () => {
  test("a sentence of words the learner has needs no new word", async () => {
    const result = await checkBeat(
      dependencies,
      draft("女は川に行く。", "The woman goes to the river."),
      null,
      knowledge,
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.word).toBeNull();
  });

  test("the tale's own word is allowed, and its place is found", async () => {
    const result = await checkBeat(
      dependencies,
      draft("女は大きい桃を見る。", "The woman sees a large peach."),
      momo,
      knowledge,
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.word).toEqual(momo);
    // 女は大きい桃を見る。 — 桃 is the sixth character, so the span the
    // reader is shown is 5..6, and the page colours exactly that.
    expect(result.value.wordSpan).toMatchObject({ start: 5, end: 6 });
  });

  test("a second new word is refused and named", async () => {
    // 鬼 belongs to this tale but not to this sentence: one new word at a
    // time is the only promise the page makes.
    const result = await checkBeat(
      dependencies,
      draft("女は大きい鬼と桃を見る。", "The woman sees a large ogre and a peach."),
      momo,
      knowledge,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join(" ")).toContain("鬼");
  });

  test("a beat that skips its own word is refused", async () => {
    const result = await checkBeat(
      dependencies,
      draft("女は川に行く。", "The woman goes to the river."),
      momo,
      knowledge,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join(" ")).toContain("does not use 桃");
  });

  test("segments that do not rejoin into the sentence are refused", async () => {
    const result = await checkBeat(
      dependencies,
      {
        japanese: "女は川に行く。",
        english: "The woman goes to the river.",
        segments: [{ written: "女は", reading: "" }],
      },
      null,
      knowledge,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join(" ")).toContain("rejoin");
  });

  test("a reading that cannot be placed over its writing is refused", async () => {
    const result = await checkBeat(
      dependencies,
      {
        japanese: "女は川に行く。",
        english: "The woman goes to the river.",
        segments: [{ written: "女は川に行く。", reading: "おんなはに行く。" }],
      },
      null,
      knowledge,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join(" ")).toContain("cannot be placed");
  });
});

describe("a tale is written beat by beat", () => {
  const withProvider: ReadingDependencies = {
    ...dependencies,
    provider: createDeterministicReadingProvider(),
  };

  test("every sentence lands, in order, each with at most one new word", async () => {
    const tale = taleById("momotaro");
    if (tale === null) throw new Error("no tale");
    const result = await writeReading(
      withProvider,
      tale,
      knowledge,
      new Date("2026-09-18T00:00:00.000Z"),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.sentences).toHaveLength(tale.beats.length);
    expect(result.value.sentences.map((s) => s.index)).toEqual(
      tale.beats.map((_, index) => index),
    );
    // Each beat that declared a word produced a sentence carrying it, and
    // the page knows where to colour it.
    const withWord = result.value.sentences.filter((s) => s.word !== null);
    expect(withWord.length).toBeGreaterThan(0);
    for (const sentence of withWord) expect(sentence.wordSpan).not.toBeNull();
  });

  test("a tale word the learner already has stops being new", async () => {
    const tale = taleById("momotaro");
    if (tale === null) throw new Error("no tale");
    // 鬼 is one of this tale's declared words. Once learned, the beat that
    // introduced it is an ordinary sentence.
    const later: KnowledgeSnapshot = {
      ...knowledge,
      vocabulary: [...knowledge.vocabulary, known("鬼", "おに", "noun")],
    };
    const result = await writeReading(
      withProvider,
      tale,
      later,
      new Date("2026-09-18T00:00:00.000Z"),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.sentences.some((s) => s.word?.lemma === "鬼")).toBe(false);
  });

  test("a beat that cannot be written names itself rather than leaving a hole", async () => {
    const tale = taleById("momotaro");
    if (tale === null) throw new Error("no tale");
    const refusing: ReadingDependencies = {
      ...dependencies,
      // Always answers with a word the learner has never met.
      provider: {
        write: async () => ({
          ok: true,
          value: {
            japanese: "宇宙船だ。",
            english: "It is a spaceship.",
            segments: [
              { written: "宇宙船", reading: "うちゅうせん" },
              { written: "だ。", reading: "だ。" },
            ],
          },
        }),
      },
    };
    const result = await writeReading(
      refusing,
      tale,
      knowledge,
      new Date("2026-09-18T00:00:00.000Z"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "beatRefused", index: 0 });
  });
});

describe("a word met once is met", () => {
  test("a word an earlier beat introduced is not new again", async () => {
    // 桃太郎 says 桃 in ten sentences. If only the beat introducing it may
    // use it the tale cannot be written at all, and the reader meets the
    // word once — which is not how anyone learns one.
    const result = await checkBeat(
      dependencies,
      draft("女は桃を見る。", "The woman sees the peach."),
      null,
      knowledge,
      [momo],
    );
    expect(result).toMatchObject({ ok: true });
    // It is not this beat's word, so the page colours nothing.
    if (result.ok) expect(result.value.word).toBeNull();
  });

  test("a word no beat has introduced yet is still refused", async () => {
    const result = await checkBeat(
      dependencies,
      draft("女は桃を見る。", "The woman sees the peach."),
      null,
      knowledge,
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join(" ")).toContain("桃");
  });

  test("only the beats before this one count as introduced", () => {
    const tale = taleById("momotaro");
    if (tale === null) throw new Error("no tale");
    const first = tale.beats.findIndex((beat) => beat.word !== null);
    expect(introducedBefore(tale, first, knowledge)).toHaveLength(0);
    expect(introducedBefore(tale, first + 1, knowledge)).toHaveLength(1);
  });
});

describe("a homophone is not the same word", () => {
  test("a word sharing only a reading does not count as known", () => {
    const sentaku: TaleWord = {
      lemma: "洗濯",
      reading: "せんたく",
      partOfSpeech: "noun",
      meaning: "washing",
    };
    // 選択 (choice) is also せんたく. Matching on the reading alone would
    // tell a reader they know 洗濯 because they once learned 選択, and the
    // tale would promise one fewer new word than it delivers.
    const choice: KnowledgeSnapshot = {
      ...knowledge,
      vocabulary: [...knowledge.vocabulary, known("選択", "せんたく", "noun")],
    };
    expect(alreadyHas(sentaku, choice)).toBe(false);
    expect(
      alreadyHas(sentaku, {
        ...knowledge,
        vocabulary: [...knowledge.vocabulary, known("洗濯", "せんたく", "noun")],
      }),
    ).toBe(true);
  });

  test("a kana word still matches a known writing of it", () => {
    // Kana has no writing to disagree about: ある written 有る is the word.
    const aru: TaleWord = {
      lemma: "もも",
      reading: "もも",
      partOfSpeech: "noun",
      meaning: "peach",
    };
    expect(
      alreadyHas(aru, {
        ...knowledge,
        vocabulary: [...knowledge.vocabulary, known("桃", "もも", "noun")],
      }),
    ).toBe(true);
  });
});

describe("bound forms are grammar, not vocabulary", () => {
  test("the nominaliser の is not a word the learner must have met", async () => {
    // 名詞/非自立: kuromoji tags it a noun, but nobody learns it as one.
    // Coverage has always bucketed 非自立 and 接尾 as grammar; asking the
    // reader to have met this の as vocabulary makes ordinary sentences
    // unwritable.
    const result = await checkBeat(
      dependencies,
      draft("女が川に行くのを見る。", "She sees them go to the river."),
      null,
      knowledge,
    );
    expect(result).toMatchObject({ ok: true });
  });
});
