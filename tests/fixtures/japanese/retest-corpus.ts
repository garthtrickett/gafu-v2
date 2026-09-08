import { type CuePiece, cue, punctuation as q, word as w } from "./builders.ts";
import type { JapaneseCueFixture } from "./schema.ts";

const n = (surface: string, reading: string) => w(surface, surface, reading, "noun");
const p = (surface: string) => w(surface, surface, surface, "particle");
const v = (surface: string, lemma: string, reading: string, conjugation: string) =>
  w(surface, lemma, reading, "verb", {
    conjugation,
    flags: ["inflected-target"],
  });
const a = (surface: string, lemma: string, reading: string, conjugation: string) =>
  w(surface, lemma, reading, "adjective", {
    conjugation,
    flags: ["inflected-target"],
  });
const x = (surface: string, lemma = surface, conjugation?: string) =>
  w(surface, lemma, surface, "auxiliary", {
    ...(conjugation === undefined ? {} : { conjugation }),
  });
const d = (surface: string) =>
  w(surface, "だ", surface, "copula", { conjugation: "基本形" });

type RetestSeed = Readonly<{
  construction: string;
  pieces: readonly CuePiece[];
  grammar: readonly [number, number];
  target: number;
}>;

const seeds: readonly RetestSeed[] = [
  {
    construction: "〜ている",
    pieces: [
      n("子供", "こども"),
      p("が"),
      n("本", "ほん"),
      p("を"),
      v("読ん", "読む", "よん", "連用タ接続"),
      p("で"),
      x("いる", "いる", "基本形"),
      q("。"),
    ],
    grammar: [4, 7],
    target: 4,
  },
  {
    construction: "〜たことがある",
    pieces: [
      n("富士山", "ふじさん"),
      p("を"),
      v("見", "見る", "み", "連用形"),
      x("た", "た", "基本形"),
      n("こと", "こと"),
      p("が"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    grammar: [2, 7],
    target: 2,
  },
  {
    construction: "〜なければならない",
    pieces: [
      n("手紙", "てがみ"),
      p("を"),
      v("書か", "書く", "かか", "未然形"),
      x("なけれ", "ない", "仮定形"),
      p("ば"),
      v("なら", "なる", "なら", "未然形"),
      x("ない", "ない", "基本形"),
      q("。"),
    ],
    grammar: [2, 7],
    target: 2,
  },
  {
    construction: "〜てもいい",
    pieces: [
      n("部屋", "へや"),
      p("に"),
      v("入っ", "入る", "はいっ", "連用タ接続"),
      p("て"),
      p("も"),
      a("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    grammar: [2, 6],
    target: 2,
  },
  {
    construction: "〜てはいけない",
    pieces: [
      n("絵", "え"),
      p("に"),
      v("触っ", "触る", "さわっ", "連用タ接続"),
      p("て"),
      p("は"),
      v("いけ", "いける", "いけ", "未然形"),
      x("ない", "ない", "基本形"),
      q("。"),
    ],
    grammar: [2, 7],
    target: 2,
  },
  {
    construction: "〜そうだ（様態）",
    pieces: [
      n("ケーキ", "けーき"),
      p("が"),
      a("おいし", "おいしい", "おいし", "語幹"),
      x("そう", "そうだ", "語幹"),
      d("だ"),
      q("。"),
    ],
    grammar: [2, 5],
    target: 2,
  },
  {
    construction: "〜かもしれない",
    pieces: [
      n("父", "ちち"),
      p("は"),
      v("帰る", "帰る", "かえる", "基本形"),
      p("かも"),
      v("しれ", "知れる", "しれ", "未然形"),
      x("ない", "ない", "基本形"),
      q("。"),
    ],
    grammar: [2, 6],
    target: 2,
  },
  {
    construction: "〜ので",
    pieces: [
      a("暑い", "暑い", "あつい", "基本形"),
      p("ので"),
      n("水", "みず"),
      p("を"),
      v("飲ん", "飲む", "のん", "連用タ接続"),
      x("だ", "だ", "基本形"),
      q("。"),
    ],
    grammar: [0, 2],
    target: 0,
  },
  {
    construction: "〜のに",
    pieces: [
      v("買っ", "買う", "かっ", "連用タ接続"),
      x("た", "た", "基本形"),
      p("のに"),
      v("使わ", "使う", "つかわ", "未然形"),
      x("ない", "ない", "基本形"),
      q("。"),
    ],
    grammar: [0, 3],
    target: 0,
  },
  {
    construction: "〜ながら",
    pieces: [
      v("笑い", "笑う", "わらい", "連用形"),
      p("ながら"),
      v("話す", "話す", "はなす", "基本形"),
      q("。"),
    ],
    grammar: [0, 2],
    target: 0,
  },
  {
    construction: "〜たり〜たりする",
    pieces: [
      v("歌っ", "歌う", "うたっ", "連用タ接続"),
      x("たり", "たり", "基本形"),
      v("踊っ", "踊る", "おどっ", "連用タ接続"),
      x("たり", "たり", "基本形"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    grammar: [0, 5],
    target: 0,
  },
  {
    construction: "〜ようになる",
    pieces: [
      n("声", "こえ"),
      p("が"),
      v("聞こえる", "聞こえる", "きこえる", "基本形"),
      n("よう", "よう"),
      p("に"),
      v("なっ", "なる", "なっ", "連用タ接続"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    grammar: [2, 7],
    target: 5,
  },
  {
    construction: "〜ことにする",
    pieces: [
      n("部屋", "へや"),
      p("を"),
      w("掃除", "掃除", "そうじ", "noun"),
      v("する", "する", "する", "基本形"),
      n("こと", "こと"),
      p("に"),
      v("し", "する", "し", "連用形"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    grammar: [2, 8],
    target: 2,
  },
  {
    construction: "〜つもりだ",
    pieces: [
      n("来年", "らいねん"),
      v("働く", "働く", "はたらく", "基本形"),
      n("つもり", "つもり"),
      d("だ"),
      q("。"),
    ],
    grammar: [1, 4],
    target: 1,
  },
  {
    construction: "〜たばかりだ",
    pieces: [
      w("さっき", "さっき", "さっき", "adverb"),
      v("始め", "始める", "はじめ", "連用形"),
      x("た", "た", "基本形"),
      p("ばかり"),
      d("だ"),
      q("。"),
    ],
    grammar: [1, 5],
    target: 1,
  },
  {
    construction: "〜てしまう（縮約）",
    pieces: [
      n("財布", "さいふ"),
      p("を"),
      v("落とし", "落とす", "おとし", "連用形"),
      x("ちゃっ", "しまう", "連用タ接続"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    grammar: [2, 5],
    target: 2,
  },
  {
    construction: "可能形",
    pieces: [
      n("日本語", "にほんご"),
      p("が"),
      v("話せる", "話す", "はなせる", "可能形"),
      q("。"),
    ],
    grammar: [2, 3],
    target: 0,
  },
  {
    construction: "受身形",
    pieces: [
      n("私", "わたし"),
      p("は"),
      n("友達", "ともだち"),
      p("に"),
      v("呼ばれ", "呼ぶ", "よばれ", "受身形"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    grammar: [4, 5],
    target: 4,
  },
  {
    construction: "使役形",
    pieces: [
      n("先生", "せんせい"),
      p("は"),
      n("子供", "こども"),
      p("を"),
      v("座らせ", "座る", "すわらせ", "使役形"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    grammar: [4, 5],
    target: 4,
  },
  {
    construction: "〜ほど〜ない",
    pieces: [
      n("湖", "みずうみ"),
      p("ほど"),
      a("穏やか", "穏やかだ", "おだやか", "語幹"),
      p("で"),
      p("は"),
      x("ない", "ない", "基本形"),
      q("。"),
    ],
    grammar: [0, 6],
    target: 2,
  },
];

export const freshHoldoutFixtures: readonly JapaneseCueFixture[] = seeds.flatMap(
  (seed, seedIndex) =>
    [0, 1].map((variant) => {
      const prefix: readonly CuePiece[] =
        variant === 0
          ? [w("2", "2", "に", "noun"), n("回", "かい"), q("、")]
          : seedIndex % 5 === 0
            ? [
                q("🎵"),
                "\n",
                w("実は", "実は", "じつは", "adverb"),
                q("、"),
                n("私", "わたし"),
                p("は"),
              ]
            : [
                w("実は", "実は", "じつは", "adverb"),
                q("、"),
                n("私", "わたし"),
                p("は"),
              ];
      const offset = prefix.filter((piece) => typeof piece !== "string").length;
      const pieces = [...prefix, ...seed.pieces];
      const expectedText = pieces
        .map((piece) => (typeof piece === "string" ? piece : piece.surface))
        .join("");
      return cue({
        id: `fresh-${String(seedIndex + 1).padStart(2, "0")}-${variant + 1}`,
        split: "holdout",
        pieces,
        construction: seed.construction,
        grammarTokenRange: [seed.grammar[0] + offset, seed.grammar[1] + offset],
        targetTokenIndex: seed.target + offset,
        rawText:
          variant === 0 && seedIndex % 4 === 0
            ? expectedText.replace("2", "２")
            : expectedText,
        riskSlices: [
          "fresh-holdout",
          "grammar",
          "inflection",
          ...(variant === 0 ? ["numbers", "counters"] : []),
          ...(variant === 0 && seedIndex % 4 === 0 ? ["normalization"] : []),
          ...(variant === 1 && seedIndex % 5 === 0
            ? ["astral", "multiline", "utf16-offset"]
            : []),
        ],
        annotationNote:
          "Fresh holdout frozen after the first candidate configuration failed.",
      });
    }),
);

export const invalidatedFreshHoldoutIds = ["fresh-13-1", "fresh-13-2"] as const;

const replacementFixtures: readonly JapaneseCueFixture[] = [
  cue({
    id: "fresh-replacement-13-1",
    split: "holdout",
    pieces: [
      n("来週", "らいしゅう"),
      p("から"),
      v("歩く", "歩く", "あるく", "基本形"),
      n("こと", "こと"),
      p("に"),
      v("し", "する", "し", "連用形"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    construction: "〜ことにする",
    grammarTokenRange: [2, 7],
    targetTokenIndex: 2,
    riskSlices: ["fresh-holdout", "grammar", "inflection", "replacement"],
    annotationNote:
      "Unseen replacement for an invalid target annotation; analyzer configuration unchanged.",
  }),
  cue({
    id: "fresh-replacement-13-2",
    split: "holdout",
    pieces: [
      q("🎵"),
      "\n",
      n("夜", "よる"),
      p("は"),
      v("読む", "読む", "よむ", "基本形"),
      n("こと", "こと"),
      p("に"),
      v("し", "する", "し", "連用形"),
      x("た", "た", "基本形"),
      q("。"),
    ],
    construction: "〜ことにする",
    grammarTokenRange: [4, 9],
    targetTokenIndex: 4,
    riskSlices: [
      "fresh-holdout",
      "grammar",
      "inflection",
      "replacement",
      "astral",
      "multiline",
      "utf16-offset",
    ],
    annotationNote:
      "Unseen replacement for an invalid target annotation; analyzer configuration unchanged.",
  }),
];

export const selectionHoldoutFixtures: readonly JapaneseCueFixture[] = [
  ...freshHoldoutFixtures.filter(
    (fixture) => !invalidatedFreshHoldoutIds.some((id) => id === fixture.id),
  ),
  ...replacementFixtures,
];
