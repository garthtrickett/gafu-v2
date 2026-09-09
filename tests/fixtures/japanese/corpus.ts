import {
  ambiguous,
  type CuePiece,
  cue,
  punctuation as q,
  unsupportedCue,
  word as w,
} from "./builders.ts";
import type { JapaneseCueFixture } from "./schema.ts";

const n = (surface: string, reading: string, known: "known" | "unknown" = "known") =>
  w(surface, surface, reading, "noun", { known });
const p = (surface: string) => w(surface, surface, surface, "particle");
const v = (
  surface: string,
  lemma: string,
  reading: string,
  conjugation: string,
  known: "known" | "unknown" = "known",
) =>
  w(surface, lemma, reading, "verb", {
    conjugation,
    known,
    flags: ["inflected-target"],
  });
const aux = (surface: string, lemma: string, reading: string, conjugation: string) =>
  w(surface, lemma, reading, "auxiliary", { conjugation });
const copula = (surface: string, conjugation: string) =>
  w(surface, "だ", surface, "copula", { conjugation });
const adj = (surface: string, lemma: string, reading: string, conjugation: string) =>
  w(surface, lemma, reading, "adjective", {
    conjugation,
    flags: ["inflected-target"],
  });
const poly = (
  surface: string,
  lemma: string,
  reading: string,
  partOfSpeech: "noun" | "verb",
  senses: readonly [string, string, ...string[]],
  conjugation?: string,
) =>
  w(surface, lemma, reading, partOfSpeech, {
    ...(conjugation === undefined ? {} : { conjugation }),
    known: "ambiguous",
    senses,
    flags: [
      "ambiguous-target",
      ...(conjugation === undefined ? [] : ["inflected-target" as const]),
    ],
  });

const morphAmbiguous = (
  surface: string,
  lemmas: readonly [string, string, ...string[]],
  readings: readonly [string, string, ...string[]],
  conjugation: string,
) => ({
  ...w(surface, lemmas[0], readings[0], "verb", {
    conjugation,
    known: "ambiguous",
    flags: ["ambiguous-target", "inflected-target"],
  }),
  lemma: ambiguous(...lemmas),
  reading: ambiguous(...readings),
});

type Pattern = Readonly<{
  construction: string;
  calibration: readonly CuePiece[];
  calibrationRange: readonly [number, number];
  holdout: readonly [
    Readonly<{
      pieces: readonly CuePiece[];
      range: readonly [number, number];
      target: number;
    }>,
    Readonly<{
      pieces: readonly CuePiece[];
      range: readonly [number, number];
      target: number;
    }>,
  ];
}>;

const patterns: readonly Pattern[] = [
  {
    construction: "〜ている",
    calibration: [
      n("鳥", "とり"),
      p("が"),
      n("空", "そら"),
      p("を"),
      v("飛ん", "飛ぶ", "とん", "連用タ接続"),
      p("で"),
      aux("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 7],
    holdout: [
      {
        pieces: [
          n("犬", "いぬ"),
          p("が"),
          n("庭", "にわ"),
          p("で"),
          v("遊ん", "遊ぶ", "あそん", "連用タ接続"),
          p("で"),
          aux("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [4, 7],
        target: 4,
      },
      {
        pieces: [
          n("電車", "でんしゃ"),
          p("を"),
          poly("待っ", "待つ", "まっ", "verb", ["wait", "await"], "連用タ接続"),
          p("て"),
          aux("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "〜たことがある",
    calibration: [
      n("大阪", "おおさか"),
      p("へ"),
      v("行っ", "行く", "いっ", "連用タ接続"),
      aux("た", "た", "た", "基本形"),
      n("こと", "こと"),
      p("が"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 7],
    holdout: [
      {
        pieces: [
          n("北海道", "ほっかいどう", "unknown"),
          p("へ"),
          v("行っ", "行く", "いっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          n("こと", "こと"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
      {
        pieces: [
          n("寿司", "すし"),
          p("を"),
          poly("作っ", "作る", "つくっ", "verb", ["make", "establish"], "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          n("こと", "こと"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
    ],
  },
  {
    construction: "〜なければならない",
    calibration: [
      n("宿題", "しゅくだい"),
      p("を"),
      v("し", "する", "し", "未然形"),
      aux("なけれ", "ない", "なけれ", "仮定形"),
      p("ば"),
      v("なら", "なる", "なら", "未然形"),
      aux("ない", "ない", "ない", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 7],
    holdout: [
      {
        pieces: [
          n("薬", "くすり"),
          p("を"),
          v("飲ま", "飲む", "のま", "未然形"),
          aux("なけれ", "ない", "なけれ", "仮定形"),
          p("ば"),
          v("なら", "なる", "なら", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
      {
        pieces: [
          n("時計", "とけい"),
          p("を"),
          poly("直さ", "直す", "なおさ", "verb", ["repair", "correct"], "未然形"),
          aux("なけれ", "ない", "なけれ", "仮定形"),
          p("ば"),
          v("なら", "なる", "なら", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
    ],
  },
  {
    construction: "〜てもいい",
    calibration: [
      n("外", "そと"),
      p("で"),
      v("遊ん", "遊ぶ", "あそん", "連用タ接続"),
      p("で"),
      p("も"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 6],
    holdout: [
      {
        pieces: [
          n("ここ", "ここ"),
          p("で"),
          n("写真", "しゃしん"),
          p("を"),
          v("撮っ", "撮る", "とっ", "連用タ接続"),
          p("て"),
          p("も"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [4, 8],
        target: 4,
      },
      {
        pieces: [
          n("荷物", "にもつ"),
          p("を"),
          poly("置い", "置く", "おい", "verb", ["put", "leave"], "連用タ接続"),
          p("て"),
          p("も"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
    ],
  },
  {
    construction: "〜てはいけない",
    calibration: [
      n("ここ", "ここ"),
      p("で"),
      v("泳い", "泳ぐ", "およい", "連用タ接続"),
      p("で"),
      p("は"),
      v("いけ", "いける", "いけ", "未然形"),
      aux("ない", "ない", "ない", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 7],
    holdout: [
      {
        pieces: [
          n("中", "なか"),
          p("で"),
          v("走っ", "走る", "はしっ", "連用タ接続"),
          p("て"),
          p("は"),
          v("いけ", "いける", "いけ", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
      {
        pieces: [
          n("約束", "やくそく"),
          p("を"),
          poly(
            "破っ",
            "破る",
            "やぶっ",
            "verb",
            ["break a promise", "tear"],
            "連用タ接続",
          ),
          p("て"),
          p("は"),
          v("いけ", "いける", "いけ", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
    ],
  },
  {
    construction: "〜そうだ（様態）",
    calibration: [
      n("雪", "ゆき"),
      p("が"),
      morphAmbiguous("降り", ["降る", "降りる"], ["ふり", "おり"], "連用形"),
      aux("そう", "そうだ", "そう", "語幹"),
      copula("だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          n("雨", "あめ"),
          p("が"),
          morphAmbiguous("降り", ["降る", "降りる"], ["ふり", "おり"], "連用形"),
          aux("そう", "そうだ", "そう", "語幹"),
          copula("だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          poly("雨", "雨", "あめ", "noun", ["rain", "candy homophone"]),
          p("が"),
          v("止み", "止む", "やみ", "連用形"),
          aux("そう", "そうだ", "そう", "語幹"),
          copula("だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 0,
      },
    ],
  },
  {
    construction: "〜かもしれない",
    calibration: [
      n("店", "みせ"),
      p("は"),
      v("閉まる", "閉まる", "しまる", "基本形"),
      p("かも"),
      v("しれ", "知れる", "しれ", "未然形"),
      aux("ない", "ない", "ない", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 6],
    holdout: [
      {
        pieces: [
          n("彼", "かれ"),
          p("は"),
          v("来", "来る", "こ", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          p("かも"),
          v("しれ", "知れる", "しれ", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
      {
        pieces: [
          n("鍵", "かぎ"),
          p("が"),
          poly("合う", "合う", "あう", "verb", ["fit", "match"]),
          p("かも"),
          v("しれ", "知れる", "しれ", "未然形"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
    ],
  },
  {
    construction: "〜ので",
    calibration: [
      adj("忙しい", "忙しい", "いそがしい", "基本形"),
      p("ので"),
      v("帰り", "帰る", "かえり", "連用形"),
      aux("ます", "ます", "ます", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          adj("寒い", "寒い", "さむい", "基本形"),
          p("ので"),
          n("窓", "まど"),
          p("を"),
          v("閉め", "閉める", "しめ", "連用形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
      {
        pieces: [
          poly("風", "風", "かぜ", "noun", ["wind", "manner"]),
          p("が"),
          adj("強い", "強い", "つよい", "基本形"),
          p("ので"),
          v("戻っ", "戻る", "もどっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 0,
      },
    ],
  },
  {
    construction: "〜のに",
    calibration: [
      v("急い", "急ぐ", "いそい", "連用タ接続"),
      aux("だ", "だ", "だ", "基本形"),
      p("のに"),
      v("遅れ", "遅れる", "おくれ", "連用形"),
      aux("た", "た", "た", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          v("勉強し", "勉強する", "べんきょうし", "連用形"),
          aux("た", "た", "た", "基本形"),
          p("のに"),
          v("忘れ", "忘れる", "わすれ", "連用形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          poly("切っ", "切る", "きっ", "verb", ["cut", "turn off"], "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          p("のに"),
          v("残っ", "残る", "のこっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ながら",
    calibration: [
      n("歌", "うた"),
      p("を"),
      v("歌い", "歌う", "うたい", "連用形"),
      p("ながら"),
      v("歩く", "歩く", "あるく", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("音楽", "おんがく"),
          p("を"),
          v("聞き", "聞く", "きき", "連用形"),
          p("ながら"),
          v("歩く", "歩く", "あるく", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          poly("話し", "話す", "はなし", "verb", ["speak", "tell"], "連用形"),
          p("ながら"),
          n("地図", "ちず"),
          p("を"),
          v("見", "見る", "み", "連用形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜たり〜たりする",
    calibration: [
      n("休み", "やすみ"),
      p("は"),
      v("寝", "寝る", "ね", "連用形"),
      aux("たり", "たり", "たり", "基本形"),
      v("読ん", "読む", "よん", "連用タ接続"),
      aux("だり", "たり", "だり", "基本形"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 7],
    holdout: [
      {
        pieces: [
          n("週末", "しゅうまつ"),
          p("は"),
          v("読ん", "読む", "よん", "連用タ接続"),
          aux("だり", "たり", "だり", "基本形"),
          v("書い", "書く", "かい", "連用タ接続"),
          aux("たり", "たり", "たり", "基本形"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
      {
        pieces: [
          poly(
            "引い",
            "引く",
            "ひい",
            "verb",
            ["pull", "play an instrument"],
            "連用タ接続",
          ),
          aux("たり", "たり", "たり", "基本形"),
          v("押し", "押す", "おし", "連用形"),
          aux("たり", "たり", "たり", "基本形"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 5],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ようになる",
    calibration: [
      n("新聞", "しんぶん"),
      p("が"),
      morphAmbiguous("読める", ["読む", "読める"], ["よめる", "よめる"], "可能形"),
      n("よう", "よう"),
      p("に"),
      v("なっ", "なる", "なっ", "連用タ接続"),
      aux("た", "た", "た", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 7],
    holdout: [
      {
        pieces: [
          n("漢字", "かんじ"),
          p("が"),
          morphAmbiguous("読める", ["読む", "読める"], ["よめる", "よめる"], "可能形"),
          n("よう", "よう"),
          p("に"),
          v("なっ", "なる", "なっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [2, 7],
        target: 2,
      },
      {
        pieces: [
          poly("見える", "見える", "みえる", "verb", ["be visible", "seem"]),
          n("よう", "よう"),
          p("に"),
          v("なっ", "なる", "なっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 5],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ことにする",
    calibration: [
      n("夜", "よる"),
      p("は"),
      v("歩く", "歩く", "あるく", "基本形"),
      n("こと", "こと"),
      p("に"),
      v("し", "する", "し", "連用形"),
      aux("た", "た", "た", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 7],
    holdout: [
      {
        pieces: [
          n("毎朝", "まいあさ"),
          v("走る", "走る", "はしる", "基本形"),
          n("こと", "こと"),
          p("に"),
          v("し", "する", "し", "連用形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [1, 6],
        target: 1,
      },
      {
        pieces: [
          poly("上げる", "上げる", "あげる", "verb", ["raise", "give"]),
          n("こと", "こと"),
          p("に"),
          v("し", "する", "し", "連用形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 5],
        target: 0,
      },
    ],
  },
  {
    construction: "〜つもりだ",
    calibration: [
      n("来月", "らいげつ"),
      v("旅行する", "旅行する", "りょこうする", "基本形"),
      n("つもり", "つもり"),
      copula("だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("明日", "あした"),
          w("早く", "早い", "はやく", "adverb", { conjugation: "連用形" }),
          v("起きる", "起きる", "おきる", "基本形"),
          n("つもり", "つもり"),
          copula("だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          poly("出る", "出る", "でる", "verb", ["leave", "appear"]),
          n("つもり", "つもり"),
          copula("だ", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "〜たばかりだ",
    calibration: [
      n("今", "いま"),
      v("食べ", "食べる", "たべ", "連用形"),
      aux("た", "た", "た", "基本形"),
      p("ばかり"),
      copula("だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          n("今", "いま"),
          v("着い", "着く", "つい", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          p("ばかり"),
          copula("だ", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          poly("取っ", "取る", "とっ", "verb", ["take", "remove"], "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          p("ばかり"),
          copula("だ", "基本形"),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
    ],
  },
  {
    construction: "〜てしまう（縮約）",
    calibration: [
      n("水", "みず"),
      p("を"),
      v("こぼし", "こぼす", "こぼし", "連用形"),
      aux("ちゃっ", "しまう", "ちゃっ", "連用タ接続"),
      aux("た", "た", "た", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          n("宿題", "しゅくだい"),
          p("を"),
          v("忘れ", "忘れる", "わすれ", "連用形"),
          aux("ちゃっ", "しまう", "ちゃっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          poly("掛け", "掛ける", "かけ", "verb", ["hang", "call"], "連用形"),
          aux("ちゃっ", "しまう", "ちゃっ", "連用タ接続"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "可能形",
    calibration: [
      n("私", "わたし"),
      p("は"),
      morphAmbiguous("泳げる", ["泳ぐ", "泳げる"], ["およげる", "およげる"], "可能形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("この", "この"),
          n("魚", "さかな"),
          p("は"),
          morphAmbiguous(
            "食べられる",
            ["食べる", "食べられる"],
            ["たべられる", "たべられる"],
            "可能形",
          ),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("私", "わたし"),
          p("に"),
          p("は"),
          poly("できる", "できる", "できる", "verb", ["can do", "be completed"]),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "受身形",
    calibration: [
      n("弟", "おとうと"),
      p("が"),
      n("犬", "いぬ"),
      p("に"),
      v("追われ", "追う", "おわれ", "受身形"),
      aux("た", "た", "た", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 5],
    holdout: [
      {
        pieces: [
          n("私", "わたし"),
          p("は"),
          n("先生", "せんせい"),
          p("に"),
          v("褒められ", "褒める", "ほめられ", "受身形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [4, 5],
        target: 4,
      },
      {
        pieces: [
          n("紙", "かみ"),
          p("が"),
          poly(
            "切られ",
            "切る",
            "きられ",
            "verb",
            ["be cut", "be disconnected"],
            "受身形",
          ),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "使役形",
    calibration: [
      n("先生", "せんせい"),
      p("は"),
      n("生徒", "せいと"),
      p("に"),
      v("読ませ", "読む", "よませ", "使役形"),
      aux("た", "た", "た", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 5],
    holdout: [
      {
        pieces: [
          n("母", "はは"),
          p("は"),
          n("子供", "こども"),
          p("に"),
          n("野菜", "やさい"),
          p("を"),
          v("食べさせ", "食べる", "たべさせ", "使役形"),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [6, 7],
        target: 6,
      },
      {
        pieces: [
          n("父", "ちち"),
          p("は"),
          poly(
            "立たせ",
            "立つ",
            "たたせ",
            "verb",
            ["make stand", "establish"],
            "使役形",
          ),
          aux("た", "た", "た", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "〜ほど〜ない",
    calibration: [
      n("冬", "ふゆ"),
      p("ほど"),
      adj("寒く", "寒い", "さむく", "連用形"),
      p("は"),
      aux("ない", "ない", "ない", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 5],
    holdout: [
      {
        pieces: [
          n("この", "この"),
          n("町", "まち"),
          p("ほど"),
          adj("静か", "静かだ", "しずか", "語幹"),
          p("で"),
          p("は"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [1, 7],
        target: 3,
      },
      {
        pieces: [
          poly("橋", "橋", "はし", "noun", ["bridge", "chopsticks homophone"]),
          p("ほど"),
          adj("長く", "長い", "ながく", "連用形"),
          p("は"),
          aux("ない", "ない", "ない", "基本形"),
          q("。"),
        ],
        range: [0, 5],
        target: 0,
      },
    ],
  },
  {
    construction: "〜前に",
    calibration: [
      v("寝る", "寝る", "ねる", "基本形"),
      n("前", "まえ"),
      p("に"),
      n("歯", "は"),
      p("を"),
      v("磨く", "磨く", "みがく", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          v("出かける", "出かける", "でかける", "基本形"),
          n("前", "まえ"),
          p("に"),
          n("鍵", "かぎ"),
          p("を"),
          v("見る", "見る", "みる", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          poly("会う", "会う", "あう", "verb", ["meet", "encounter"]),
          n("前", "まえ"),
          p("に"),
          n("電話", "でんわ"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ても",
    calibration: [
      adj("高く", "高い", "たかく", "連用形"),
      p("て"),
      p("も"),
      v("買う", "買う", "かう", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          n("雨", "あめ"),
          p("が"),
          v("降っ", "降る", "ふっ", "連用タ接続"),
          p("て"),
          p("も"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          poly("取れ", "取る", "とれ", "verb", ["come off", "be obtained"], "仮定形"),
          p("て"),
          p("も"),
          v("使う", "使う", "つかう", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "だ",
    calibration: [
      n("これ", "これ"),
      p("は"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          n("私", "わたし"),
          p("は"),
          n("先生", "せんせい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("猫", "ねこ"),
          p("は"),
          n("動物", "どうぶつ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "は",
    calibration: [
      n("これ", "これ"),
      p("は"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("私", "わたし"),
          p("は"),
          n("先生", "せんせい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("猫", "ねこ"),
          p("は"),
          n("動物", "どうぶつ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "も",
    calibration: [
      n("これ", "これ"),
      p("も"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("私", "わたし"),
          p("も"),
          n("先生", "せんせい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("犬", "いぬ"),
          p("も"),
          n("動物", "どうぶつ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "に",
    calibration: [
      n("学校", "がっこう"),
      p("に"),
      v("いく", "いく", "いく", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("家", "いえ"),
          p("に"),
          v("かえる", "かえる", "かえる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("会社", "かいしゃ"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "で",
    calibration: [
      n("外", "そと"),
      p("で"),
      v("遊ぶ", "遊ぶ", "あそぶ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("学校", "がっこう"),
          p("で"),
          v("学ぶ", "学ぶ", "まなぶ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("家", "いえ"),
          p("で"),
          v("休む", "休む", "やすむ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "を",
    calibration: [
      n("本", "ほん"),
      p("を"),
      v("よむ", "読む", "よむ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("水", "みず"),
          p("を"),
          v("飲む", "飲む", "のむ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("ご飯", "ごはん"),
          p("を"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "が",
    calibration: [
      n("雨", "あめ"),
      p("が"),
      v("ふる", "ふる", "ふる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("犬", "いぬ"),
          p("が"),
          v("走る", "走る", "はしる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("猫", "ねこ"),
          p("が"),
          v("寝る", "寝る", "ねる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "から",
    calibration: [
      n("学校", "がっこう"),
      p("から"),
      v("かえる", "かえる", "かえる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("家", "いえ"),
          p("から"),
          v("でる", "出る", "でる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("会社", "かいしゃ"),
          p("から"),
          v("かえる", "かえる", "かえる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "まで",
    calibration: [
      n("学校", "がっこう"),
      p("まで"),
      v("歩く", "歩く", "あるく", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("駅", "えき"),
          p("まで"),
          v("走る", "走る", "はしる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("家", "いえ"),
          p("まで"),
          v("歩く", "歩く", "あるく", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "と",
    calibration: [
      n("友達", "ともだち"),
      p("と"),
      v("遊ぶ", "遊ぶ", "あそぶ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("母", "はは"),
          p("と"),
          v("話す", "話す", "はなす", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("父", "ちち"),
          p("と"),
          v("歩く", "歩く", "あるく", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "よ",
    calibration: [v("いく", "いく", "いく", "基本形"), p("よ"), q("。")],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [v("食べる", "食べる", "たべる", "基本形"), p("よ"), q("。")],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [v("飲む", "飲む", "のむ", "基本形"), p("よ"), q("。")],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ね",
    calibration: [v("いく", "いく", "いく", "基本形"), p("ね"), q("。")],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [v("食べる", "食べる", "たべる", "基本形"), p("ね"), q("。")],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [v("見る", "見る", "みる", "基本形"), p("ね"), q("。")],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "～んです",
    calibration: [
      n("学生", "がくせい"),
      w("な", "な", "な", "auxiliary"),
      w("ん", "ん", "ん", "noun"),
      aux("です", "です", "です", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("先生", "せんせい"),
          w("な", "な", "な", "auxiliary"),
          w("ん", "ん", "ん", "noun"),
          aux("です", "です", "です", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("元気", "げんき"),
          w("な", "な", "な", "auxiliary"),
          w("ん", "ん", "ん", "noun"),
          aux("です", "です", "です", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "の",
    calibration: [
      v("泳ぐ", "泳ぐ", "およぐ", "基本形"),
      p("の"),
      p("が"),
      adj("すき", "すき", "すき", "基本形"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("走る", "走る", "はしる", "基本形"),
          p("の"),
          p("が"),
          adj("すき", "すき", "すき", "基本形"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("書く", "書く", "かく", "基本形"),
          p("の"),
          p("が"),
          adj("すき", "すき", "すき", "基本形"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "けど",
    calibration: [
      n("雨", "あめ"),
      p("が"),
      v("ふる", "ふる", "ふる", "基本形"),
      p("けど"),
      v("でかける", "でかける", "でかける", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          adj("高い", "高い", "たかい", "基本形"),
          p("けど"),
          v("買う", "買う", "かう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          adj("忙しい", "忙しい", "いそがしい", "基本形"),
          p("けど"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "とか",
    calibration: [
      n("本", "ほん"),
      p("とか"),
      n("ペン", "ぺん"),
      p("とか"),
      v("買う", "買う", "かう", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("犬", "いぬ"),
          p("とか"),
          n("猫", "ねこ"),
          p("とか"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("パン", "ぱん"),
          p("とか"),
          n("ご飯", "ごはん"),
          p("とか"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "とく",
    calibration: [
      n("宿題", "しゅくだい"),
      v("し", "する", "し", "連用形"),
      v("とく", "とく", "とく", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("窓", "まど"),
          p("を"),
          v("開け", "開ける", "あけ", "連用形"),
          v("とく", "とく", "とく", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("本", "ほん"),
          p("を"),
          v("読ん", "読む", "よん", "連用タ接続"),
          v("どく", "どく", "どく", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "なきゃ",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("なきゃ", "ない", "なきゃ", "auxiliary", { conjugation: "仮定縮約２" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲ま", "飲む", "のま", "未然形"),
          w("なきゃ", "ない", "なきゃ", "auxiliary", { conjugation: "仮定縮約２" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          v("行か", "行く", "いか", "未然形"),
          w("なきゃ", "ない", "なきゃ", "auxiliary", { conjugation: "仮定縮約２" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "みたい",
    calibration: [
      n("本", "ほん"),
      w("みたい", "みたい", "みたい", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("犬", "いぬ"),
          w("みたい", "みたい", "みたい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("猫", "ねこ"),
          w("みたい", "みたい", "みたい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "これ",
    calibration: [
      n("これ", "これ"),
      p("は"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          n("ペン", "ぺん"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          n("犬", "いぬ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "それ",
    calibration: [
      n("それ", "それ"),
      p("は"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          n("それ", "それ"),
          p("は"),
          n("ペン", "ぺん"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("それ", "それ"),
          p("は"),
          n("猫", "ねこ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "あれ",
    calibration: [
      n("あれ", "あれ"),
      p("は"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          n("あれ", "あれ"),
          p("は"),
          n("山", "やま"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("あれ", "あれ"),
          p("は"),
          n("車", "くるま"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "か",
    calibration: [n("彼", "かれ"), p("は"), n("学生", "がくせい"), p("か"), q("。")],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [n("これ", "これ"), p("は"), n("本", "ほん"), p("か"), q("。")],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("犬", "いぬ"),
          p("は"),
          adj("白い", "白い", "しろい", "基本形"),
          p("か"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "ここ",
    calibration: [
      n("ここ", "ここ"),
      p("は"),
      n("学校", "がっこう"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          n("ここ", "ここ"),
          p("は"),
          n("家", "いえ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("ここ", "ここ"),
          p("は"),
          n("駅", "えき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "そこ",
    calibration: [
      n("そこ", "そこ"),
      p("は"),
      n("学校", "がっこう"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          n("そこ", "そこ"),
          p("は"),
          n("店", "みせ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("そこ", "そこ"),
          p("は"),
          n("公園", "こうえん"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "あそこ",
    calibration: [
      n("あそこ", "あそこ"),
      p("は"),
      n("学校", "がっこう"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          n("あそこ", "あそこ"),
          p("は"),
          n("家", "いえ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("あそこ", "あそこ"),
          p("は"),
          n("駅", "えき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜くない",
    calibration: [
      adj("寒く", "寒い", "さむく", "連用テ接続"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          adj("高く", "高い", "たかく", "連用テ接続"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          adj("忙しく", "忙しい", "いそがしく", "連用テ接続"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜じゃない",
    calibration: [
      n("元気", "げんき"),
      w("じゃない", "じゃない", "じゃない", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("先生", "せんせい"),
          w("じゃない", "じゃない", "じゃない", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          n("学生", "がくせい"),
          w("じゃない", "じゃない", "じゃない", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ない (る-Verb Negative)",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("見", "見る", "み", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          v("寝", "寝る", "ね", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ない (う-Verb Negative)",
    calibration: [
      v("書か", "書く", "かか", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲ま", "飲む", "のま", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          v("話さ", "話す", "はなさ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ます",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      w("ます", "ます", "ます", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲み", "飲む", "のみ", "連用形"),
          w("ます", "ます", "ます", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          v("行き", "行く", "いき", "連用形"),
          w("ます", "ます", "ます", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "でしょう",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("は"),
      n("晴れ", "はれ"),
      w("でしょ", "です", "でしょ", "auxiliary", { conjugation: "未然形" }),
      w("う", "う", "う", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("彼", "かれ"),
          p("は"),
          n("先生", "せんせい"),
          w("でしょ", "です", "でしょ", "auxiliary", { conjugation: "未然形" }),
          w("う", "う", "う", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          n("本", "ほん"),
          w("でしょ", "です", "でしょ", "auxiliary", { conjugation: "未然形" }),
          w("う", "う", "う", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "だろう",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("は"),
      n("雨", "あめ"),
      w("だろ", "だろう", "だろ", "auxiliary", { conjugation: "未然形" }),
      w("う", "う", "う", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("彼", "かれ"),
          p("は"),
          n("学生", "がくせい"),
          w("だろ", "だろう", "だろ", "auxiliary", { conjugation: "未然形" }),
          w("う", "う", "う", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("それ", "それ"),
          p("は"),
          n("本", "ほん"),
          w("だろ", "だろう", "だろ", "auxiliary", { conjugation: "未然形" }),
          w("う", "う", "う", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "がある",
    calibration: [
      n("本", "ほん"),
      p("が"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("車", "くるま"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("時間", "じかん"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "がいる",
    calibration: [
      n("猫", "ねこ"),
      p("が"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("犬", "いぬ"),
          p("が"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("友達", "ともだち"),
          p("が"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "この",
    calibration: [
      w("この", "この", "この", "adverb"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("この", "この", "この", "adverb"),
          n("犬", "いぬ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("この", "この", "この", "adverb"),
          n("店", "みせ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "その",
    calibration: [
      w("その", "その", "その", "adverb"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("その", "その", "その", "adverb"),
          n("猫", "ねこ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("その", "その", "その", "adverb"),
          n("車", "くるま"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "あの",
    calibration: [
      w("あの", "あの", "あの", "adverb"),
      n("本", "ほん"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("あの", "あの", "あの", "adverb"),
          n("山", "やま"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("あの", "あの", "あの", "adverb"),
          n("人", "ひと"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜かった",
    calibration: [
      adj("寒かっ", "寒い", "さむかっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          adj("高かっ", "高い", "たかかっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
      {
        pieces: [
          adj("忙しかっ", "忙しい", "いそがしかっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "の ( nominalizer )",
    calibration: [
      v("読む", "読む", "よむ", "基本形"),
      p("の"),
      p("が"),
      adj("すき", "すき", "すき", "基本形"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("走る", "走る", "はしる", "基本形"),
          p("の"),
          p("が"),
          adj("すき", "すき", "すき", "基本形"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("書く", "書く", "かく", "基本形"),
          p("の"),
          p("が"),
          adj("すき", "すき", "すき", "基本形"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "する",
    calibration: [
      n("サッカー", "さっかー"),
      p("を"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("勉強", "べんきょう"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("仕事", "しごと"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "くる",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      v("くる", "くる", "くる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("友達", "ともだち"),
          p("が"),
          v("くる", "くる", "くる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("先生", "せんせい"),
          p("が"),
          v("くる", "くる", "くる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "〜た (る)",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("見", "見る", "み", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          v("寝", "寝る", "ね", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜た (う)",
    calibration: [
      v("書い", "書く", "かい", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲ん", "飲む", "のん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          v("買っ", "買う", "かっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "好き",
    calibration: [
      n("音楽", "おんがく"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("猫", "ねこ"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("本", "ほん"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "きらい",
    calibration: [
      n("納豆", "なっとう"),
      p("が"),
      n("嫌い", "きらい"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("雨", "あめ"),
          p("が"),
          n("嫌い", "きらい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("混雑", "こんざつ"),
          p("が"),
          n("嫌い", "きらい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "のがすき",
    calibration: [
      v("泳ぐ", "泳ぐ", "およぐ", "基本形"),
      p("の"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("走る", "走る", "はしる", "基本形"),
          p("の"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("読む", "読む", "よむ", "基本形"),
          p("の"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "ので / から",
    calibration: [
      n("雨", "あめ"),
      w("な", "な", "な", "auxiliary"),
      p("の"),
      p("で"),
      v("休む", "休む", "やすむ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("病気", "びょうき"),
          w("な", "な", "な", "auxiliary"),
          p("の"),
          p("で"),
          v("休む", "休む", "やすむ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          adj("安い", "安い", "やすい", "基本形"),
          p("の"),
          p("で"),
          v("買う", "買う", "かう", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜なかった",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("行か", "行く", "いか", "未然形"),
          w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 0,
      },
      {
        pieces: [
          v("見", "見る", "み", "未然形"),
          w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "〜て",
    calibration: [
      n("本", "ほん"),
      p("を"),
      v("読ん", "読む", "よん", "連用タ接続"),
      p("で"),
      v("寝る", "寝る", "ねる", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          n("ご飯", "ごはん"),
          p("を"),
          v("食べ", "食べる", "たべ", "連用形"),
          p("て"),
          v("出かける", "出かける", "でかける", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("手", "て"),
          p("を"),
          v("洗っ", "洗う", "あらっ", "連用タ接続"),
          p("て"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "〜ている (進行)",
    calibration: [
      n("犬", "いぬ"),
      p("が"),
      v("走っ", "走る", "はしっ", "連用タ接続"),
      p("て"),
      w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("猫", "ねこ"),
          p("が"),
          v("寝", "寝る", "ね", "連用形"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("鳥", "とり"),
          p("が"),
          v("食べ", "食べる", "たべ", "連用形"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "〜にいく",
    calibration: [
      n("買い物", "かいもの"),
      p("に"),
      v("いく", "いく", "いく", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("学校", "がっこう"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("図書館", "としょかん"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "だれ",
    calibration: [
      w("だれ", "だれ", "だれ", "noun"),
      p("が"),
      v("くる", "くる", "くる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("だれ", "だれ", "だれ", "noun"),
          p("が"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("だれ", "だれ", "だれ", "noun"),
          p("が"),
          n("先生", "せんせい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "なんで / どうして",
    calibration: [
      w("なんで", "なんで", "なんで", "adverb"),
      aux("です", "です", "です", "基本形"),
      p("か"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("どうして", "どうして", "どうして", "adverb"),
          aux("です", "です", "です", "基本形"),
          p("か"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("なんで", "なんで", "なんで", "adverb"),
          v("来", "来る", "き", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("の"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "じゃない",
    calibration: [
      n("先生", "せんせい"),
      w("じゃない", "じゃない", "じゃない", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("学生", "がくせい"),
          w("じゃない", "じゃない", "じゃない", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
      {
        pieces: [
          w("有名", "有名", "ゆうめい", "noun"),
          w("じゃない", "じゃない", "じゃない", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "〜くなかった",
    calibration: [
      adj("寒く", "寒い", "さむく", "連用テ接続"),
      w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          adj("高く", "高い", "たかく", "連用テ接続"),
          w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          adj("忙しく", "忙しい", "いそがしく", "連用テ接続"),
          w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "って",
    calibration: [
      n("彼", "かれ"),
      p("は"),
      n("学生", "がくせい"),
      aux("だ", "だ", "だ", "基本形"),
      p("って"),
      q("。"),
    ],
    calibrationRange: [4, 5],
    holdout: [
      {
        pieces: [
          n("田中", "たなか"),
          p("は"),
          n("先生", "せんせい"),
          aux("だ", "だ", "だ", "基本形"),
          p("って"),
          q("。"),
        ],
        range: [4, 5],
        target: 4,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          n("本", "ほん"),
          aux("だ", "だ", "だ", "基本形"),
          p("って"),
          q("。"),
        ],
        range: [4, 5],
        target: 4,
      },
    ],
  },
  {
    construction: "Verb + Noun",
    calibration: [
      v("食べる", "食べる", "たべる", "基本形"),
      n("人", "ひと"),
      p("が"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          v("読む", "読む", "よむ", "基本形"),
          n("もの", "もの"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
      {
        pieces: [
          v("作っ", "作る", "つくっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          n("もの", "もの"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "の (省略)",
    calibration: [
      adj("赤い", "赤い", "あかい", "基本形"),
      p("の"),
      p("が"),
      adj("すき", "すき", "すき", "基本形"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          adj("大きい", "大きい", "おおきい", "基本形"),
          p("の"),
          p("が"),
          adj("すき", "すき", "すき", "基本形"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          adj("新しい", "新しい", "あたらしい", "基本形"),
          p("の"),
          p("が"),
          adj("すき", "すき", "すき", "基本形"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "な",
    calibration: [
      n("元気", "げんき"),
      w("な", "な", "な", "auxiliary"),
      n("人", "ひと"),
      p("が"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          w("有名", "有名", "ゆうめい", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("店", "みせ"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("静か", "静か", "しずか", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("所", "ところ"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "だけ",
    calibration: [
      n("水", "みず"),
      p("だけ"),
      v("飲む", "飲む", "のむ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("ご飯", "ごはん"),
          p("だけ"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("少し", "少し", "すこし", "adverb"),
          p("だけ"),
          v("休む", "休む", "やすむ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "どこ",
    calibration: [
      n("駅", "えき"),
      p("は"),
      w("どこ", "どこ", "どこ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("家", "いえ"),
          p("は"),
          w("どこ", "どこ", "どこ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("学校", "がっこう"),
          p("は"),
          w("どこ", "どこ", "どこ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "どれ",
    calibration: [
      w("どれ", "どれ", "どれ", "noun"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("どれ", "どれ", "どれ", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          p("か"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("どれ", "どれ", "どれ", "noun"),
          p("を"),
          v("買う", "買う", "かう", "基本形"),
          p("か"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ている (状態)",
    calibration: [
      n("結婚", "けっこん"),
      v("し", "する", "し", "連用形"),
      p("て"),
      w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          v("知っ", "知る", "しっ", "連用タ接続"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("住ん", "住む", "すん", "連用タ接続"),
          p("で"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "てから",
    calibration: [
      n("ご飯", "ごはん"),
      p("を"),
      v("食べ", "食べる", "たべ", "連用形"),
      p("て"),
      p("から"),
      v("出かける", "出かける", "でかける", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("手", "て"),
          p("を"),
          v("洗っ", "洗う", "あらっ", "連用タ接続"),
          p("て"),
          p("から"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("宿題", "しゅくだい"),
          p("を"),
          v("し", "する", "し", "連用形"),
          p("て"),
          p("から"),
          v("遊ぶ", "遊ぶ", "あそぶ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "もう / まだ",
    calibration: [
      w("もう", "もう", "もう", "adverb"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("まだ", "まだ", "まだ", "adverb"),
          w("だめ", "だめ", "だめ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("もう", "もう", "もう", "adverb"),
          adj("いい", "いい", "いい", "基本形"),
          p("か"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "まだ〜てない",
    calibration: [
      w("まだ", "まだ", "まだ", "adverb"),
      v("来", "来る", "き", "連用形"),
      p("て"),
      w("い", "いる", "い", "verb", { conjugation: "連用形" }),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          w("まだ", "まだ", "まだ", "adverb"),
          v("食べ", "食べる", "たべ", "連用形"),
          p("て"),
          w("い", "いる", "い", "verb", { conjugation: "連用形" }),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          w("まだ", "まだ", "まだ", "adverb"),
          v("読ん", "読む", "よん", "連用タ接続"),
          p("で"),
          w("い", "いる", "い", "verb", { conjugation: "連用形" }),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "〜たい",
    calibration: [
      n("水", "みず"),
      p("が"),
      v("飲み", "飲む", "のみ", "連用形"),
      w("たい", "たい", "たい", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          n("ご飯", "ごはん"),
          p("が"),
          v("食べ", "食べる", "たべ", "連用形"),
          w("たい", "たい", "たい", "auxiliary"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("映画", "えいが"),
          p("が"),
          v("見", "見る", "み", "連用形"),
          w("たい", "たい", "たい", "auxiliary"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "けっこう",
    calibration: [
      w("けっこう", "けっこう", "けっこう", "adverb"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("けっこう", "けっこう", "けっこう", "adverb"),
          v("飲ん", "飲む", "のん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("けっこう", "けっこう", "けっこう", "adverb"),
          adj("いい", "いい", "いい", "基本形"),
          n("天気", "てんき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "たくさん",
    calibration: [
      w("たくさん", "たくさん", "たくさん", "adverb"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("たくさん", "たくさん", "たくさん", "adverb"),
          v("飲ん", "飲む", "のん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("たくさん", "たくさん", "たくさん", "adverb"),
          n("人", "ひと"),
          p("が"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "くらい / ぐらい",
    calibration: [
      w("三", "三", "さん", "noun"),
      n("時間", "じかん"),
      w("くらい", "くらい", "くらい", "particle"),
      v("待っ", "待つ", "まっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          w("少し", "少し", "すこし", "adverb"),
          w("くらい", "くらい", "くらい", "particle"),
          v("休む", "休む", "やすむ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("一", "一", "いち", "noun"),
          n("時間", "じかん"),
          w("ぐらい", "ぐらい", "ぐらい", "particle"),
          v("歩い", "歩く", "あるい", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "すぎる",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      v("すぎる", "過ぎる", "すぎる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲み", "飲む", "のみ", "連用形"),
          v("すぎる", "過ぎる", "すぎる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("走り", "走る", "はしり", "連用形"),
          v("すぎる", "過ぎる", "すぎる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "にする",
    calibration: [
      n("コーヒー", "こーひー"),
      p("に"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("紅茶", "こうちゃ"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("ビール", "びーる"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜になる・〜くなる",
    calibration: [
      n("元気", "げんき"),
      p("に"),
      v("なる", "なる", "なる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          adj("寒く", "寒い", "さむく", "連用テ接続"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("先生", "せんせい"),
          p("に"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜のほうが",
    calibration: [
      n("犬", "いぬ"),
      p("の"),
      w("ほう", "ほう", "ほう", "noun"),
      p("が"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("猫", "ねこ"),
          p("の"),
          w("ほう", "ほう", "ほう", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("の"),
          w("ほう", "ほう", "ほう", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "なにか・なにも",
    calibration: [
      w("なにか", "なにか", "なにか", "noun"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("たい", "たい", "たい", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("なにも", "なにも", "なにも", "noun"),
          v("食べ", "食べる", "たべ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("何か", "何か", "なにか", "noun"),
          v("飲み", "飲む", "のみ", "連用形"),
          w("たい", "たい", "たい", "auxiliary"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "誰か・どこか・誰も・どこも",
    calibration: [
      w("誰か", "誰か", "だれか", "noun"),
      p("が"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("どこか", "どこか", "どこか", "noun"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("誰も", "誰も", "だれも", "noun"),
          v("い", "いる", "い", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ましょう / 〜ましょうか",
    calibration: [
      n("一緒", "いっしょ"),
      p("に"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("ましょう", "ます", "ましょう", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          n("一緒", "いっしょ"),
          p("に"),
          v("飲み", "飲む", "のみ", "連用形"),
          w("ましょう", "ます", "ましょう", "auxiliary"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("一緒", "いっしょ"),
          p("に"),
          v("行き", "行く", "いき", "連用形"),
          w("ましょう", "ます", "ましょう", "auxiliary"),
          p("か"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "〜ませんか",
    calibration: [
      n("一緒", "いっしょ"),
      p("に"),
      v("食べ", "食べる", "たべ", "未然形"),
      w("ません", "ます", "ません", "auxiliary"),
      p("か"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("一緒", "いっしょ"),
          p("に"),
          v("飲み", "飲む", "のみ", "未然形"),
          w("ません", "ます", "ません", "auxiliary"),
          p("か"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("一緒", "いっしょ"),
          p("に"),
          v("行き", "行く", "いき", "未然形"),
          w("ません", "ます", "ません", "auxiliary"),
          p("か"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "〜ないでください",
    calibration: [
      n("ここ", "ここ"),
      p("で"),
      v("待た", "待つ", "また", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      p("で"),
      w("ください", "くださる", "ください", "verb", { conjugation: "命令形" }),
      q("。"),
    ],
    calibrationRange: [3, 6],
    holdout: [
      {
        pieces: [
          v("騒が", "騒ぐ", "さわが", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("で"),
          w("ください", "くださる", "ください", "verb", { conjugation: "命令形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          v("心配し", "心配する", "しんぱいし", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("で"),
          w("ください", "くださる", "ください", "verb", { conjugation: "命令形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "〜たほうがいい / 〜ないほうがいい",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("ほう", "ほう", "ほう", "noun"),
      p("が"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("寝", "寝る", "ね", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("ほう", "ほう", "ほう", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
      {
        pieces: [
          v("飲ま", "飲む", "のま", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("ほう", "ほう", "ほう", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "Adjective + て / Noun + で",
    calibration: [
      adj("高く", "高い", "たかく", "連用テ接続"),
      p("て"),
      adj("大きい", "大きい", "おおきい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          n("元気", "げんき"),
          p("で"),
          adj("明るい", "明るい", "あかるい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("きれい", "きれい", "きれい", "noun"),
          p("で"),
          w("有名", "有名", "ゆうめい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "のがへた / のがじょうず",
    calibration: [
      v("泳ぐ", "泳ぐ", "およぐ", "基本形"),
      p("の"),
      p("が"),
      w("へた", "へた", "へた", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("走る", "走る", "はしる", "基本形"),
          p("の"),
          p("が"),
          w("へた", "へた", "へた", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("歌う", "歌う", "うたう", "基本形"),
          p("の"),
          p("が"),
          w("じょうず", "じょうず", "じょうず", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "あげる / くれる / もらう",
    calibration: [
      n("花", "はな"),
      p("を"),
      v("あげる", "あげる", "あげる", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("本", "ほん"),
          p("を"),
          v("くれる", "くれる", "くれる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("ペン", "ぺん"),
          p("を"),
          v("もらう", "もらう", "もらう", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "とき",
    calibration: [
      n("子供", "こども"),
      p("の"),
      w("とき", "とき", "とき", "noun"),
      w("よく", "よい", "よく", "adverb"),
      v("遊ん", "遊ぶ", "あそん", "連用タ接続"),
      w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("学生", "がくせい"),
          p("の"),
          w("とき", "とき", "とき", "noun"),
          w("よく", "よい", "よく", "adverb"),
          n("本", "ほん"),
          p("を"),
          v("読ん", "読む", "よん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          adj("若い", "若い", "わかい", "基本形"),
          w("とき", "とき", "とき", "noun"),
          w("よく", "よい", "よく", "adverb"),
          v("走っ", "走る", "はしっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "あとで",
    calibration: [
      w("あとで", "あとで", "あとで", "adverb"),
      n("電話", "でんわ"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("あとで", "あとで", "あとで", "adverb"),
          n("手紙", "てがみ"),
          p("を"),
          v("書く", "書く", "かく", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("あとで", "あとで", "あとで", "adverb"),
          n("宿題", "しゅくだい"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "までに",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("まで"),
      p("に"),
      v("出す", "出す", "だす", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("三時", "三時", "さんじ", "noun"),
          p("まで"),
          p("に"),
          v("帰る", "帰る", "かえる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("金曜日", "きんようび"),
          p("まで"),
          p("に"),
          v("終える", "終える", "おえる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "ごろ",
    calibration: [
      w("三時", "三時", "さんじ", "noun"),
      w("ごろ", "ごろ", "ごろ", "particle"),
      p("に"),
      v("起きる", "起きる", "おきる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("昼", "ひる"),
          w("ごろ", "ごろ", "ごろ", "particle"),
          p("に"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("夜", "よる"),
          w("ごろ", "ごろ", "ごろ", "particle"),
          p("に"),
          v("寝る", "寝る", "ねる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜ていた",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      p("て"),
      w("い", "いる", "い", "verb", { conjugation: "連用形" }),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("読ん", "読む", "よん", "連用タ接続"),
          p("で"),
          w("い", "いる", "い", "verb", { conjugation: "連用形" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("見", "見る", "み", "連用形"),
          p("て"),
          w("い", "いる", "い", "verb", { conjugation: "連用形" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "るところだ",
    calibration: [
      v("食べる", "食べる", "たべる", "基本形"),
      w("ところ", "ところ", "ところ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          v("出かける", "出かける", "でかける", "基本形"),
          w("ところ", "ところ", "ところ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          v("寝る", "寝る", "ねる", "基本形"),
          w("ところ", "ところ", "ところ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ていく / 〜てくる",
    calibration: [
      v("持っ", "持つ", "もっ", "連用タ接続"),
      p("て"),
      v("いく", "いく", "いく", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("連れ", "連れる", "つれ", "連用形"),
          p("て"),
          v("くる", "くる", "くる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("運ん", "運ぶ", "はこん", "連用タ接続"),
          p("で"),
          v("くる", "くる", "くる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜やすい",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      v("やすい", "やすい", "やすい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("読み", "読む", "よみ", "連用形"),
          v("やすい", "やすい", "やすい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("使い", "使う", "つかい", "連用形"),
          v("やすい", "やすい", "やすい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜にくい",
    calibration: [
      v("分かり", "分かる", "わかり", "連用形"),
      v("にくい", "にくい", "にくい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("覚え", "覚える", "おぼえ", "連用形"),
          v("にくい", "にくい", "にくい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("聞き", "聞く", "きき", "連用形"),
          v("にくい", "にくい", "にくい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜づらい",
    calibration: [
      v("分かり", "分かる", "わかり", "連用形"),
      v("づらい", "づらい", "づらい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("覚え", "覚える", "おぼえ", "連用形"),
          v("づらい", "づらい", "づらい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("言い", "言う", "いい", "連用形"),
          v("づらい", "づらい", "づらい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜はじめる",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      v("はじめる", "はじめる", "はじめる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("読み", "読む", "よみ", "連用形"),
          v("はじめる", "はじめる", "はじめる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("走り", "走る", "はしり", "連用形"),
          v("はじめる", "はじめる", "はじめる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜おわる",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      v("おわる", "おわる", "おわる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("読み", "読む", "よみ", "連用形"),
          v("おわる", "おわる", "おわる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("書き", "書く", "かき", "連用形"),
          v("おわる", "おわる", "おわる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜なおす",
    calibration: [
      v("書き", "書く", "かき", "連用形"),
      v("なおす", "なおす", "なおす", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("読み", "読む", "よみ", "連用形"),
          v("なおす", "なおす", "なおす", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("作り", "作る", "つくり", "連用形"),
          v("なおす", "なおす", "なおす", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ないで / なくて",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      p("で"),
      v("寝る", "寝る", "ねる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("飲ま", "飲む", "のま", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("で"),
          v("寝る", "寝る", "ねる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("見", "見る", "み", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("で"),
          v("出かける", "出かける", "でかける", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "でも",
    calibration: [
      n("雨", "あめ"),
      p("で"),
      p("も"),
      v("出かける", "出かける", "でかける", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("風邪", "かぜ"),
          p("で"),
          p("も"),
          n("学校", "がっこう"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("熱", "ねつ"),
          p("で"),
          p("も"),
          n("会社", "かいしゃ"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "れる・られる",
    calibration: [
      n("私", "わたし"),
      p("は"),
      n("先生", "せんせい"),
      p("に"),
      v("褒められる", "褒める", "ほめられる", "受身形"),
      q("。"),
    ],
    calibrationRange: [4, 5],
    holdout: [
      {
        pieces: [
          n("子供", "こども"),
          p("は"),
          n("親", "おや"),
          p("に"),
          v("叱られる", "叱る", "しかられる", "受身形"),
          q("。"),
        ],
        range: [4, 5],
        target: 4,
      },
      {
        pieces: [
          w("この", "この", "この", "adverb"),
          n("本", "ほん"),
          p("は"),
          v("読める", "読む", "よめる", "可能形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "ということ",
    calibration: [
      n("彼", "かれ"),
      p("が"),
      v("来る", "来る", "くる", "基本形"),
      w("という", "という", "という", "particle"),
      w("こと", "こと", "こと", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("雨", "あめ"),
          p("が"),
          v("降る", "降る", "ふる", "基本形"),
          w("という", "という", "という", "particle"),
          w("こと", "こと", "こと", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("電車", "でんしゃ"),
          p("が"),
          v("遅れる", "遅れる", "おくれる", "基本形"),
          w("という", "という", "という", "particle"),
          w("こと", "こと", "こと", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "だけで",
    calibration: [
      n("日本語", "にほんご"),
      p("だけ"),
      p("で"),
      v("話す", "話す", "はなす", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("箸", "はし"),
          p("だけ"),
          p("で"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("水", "みず"),
          p("だけ"),
          p("で"),
          v("生きる", "生きる", "いきる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "なるべく",
    calibration: [
      w("なるべく", "なるべく", "なるべく", "adverb"),
      w("早く", "早い", "はやく", "adverb"),
      v("来る", "来る", "くる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("なるべく", "なるべく", "なるべく", "adverb"),
          w("安く", "安い", "やすく", "adverb"),
          v("買う", "買う", "かう", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("なるべく", "なるべく", "なるべく", "adverb"),
          w("静か", "静か", "しずか", "noun"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜ら",
    calibration: [
      n("子供", "こども"),
      p("ら"),
      p("が"),
      v("遊ぶ", "遊ぶ", "あそぶ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("学生", "がくせい"),
          p("ら"),
          p("が"),
          v("集まる", "集まる", "あつまる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("僕", "僕", "ぼく", "noun"),
          p("ら"),
          p("が"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "だんだん / どんどん",
    calibration: [
      w("だんだん", "だんだん", "だんだん", "adverb"),
      adj("寒く", "寒い", "さむく", "連用テ接続"),
      v("なる", "なる", "なる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("どんどん", "どんどん", "どんどん", "adverb"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("だんだん", "だんだん", "だんだん", "adverb"),
          adj("大きく", "大きい", "おおきく", "連用テ接続"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "とおもう",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("は"),
      n("雨", "あめ"),
      aux("だ", "だ", "だ", "基本形"),
      p("と"),
      v("おもう", "おもう", "おもう", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 6],
    holdout: [
      {
        pieces: [
          n("彼", "かれ"),
          p("は"),
          v("来る", "来る", "くる", "基本形"),
          p("と"),
          v("おもう", "おもう", "おもう", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          adj("いい", "いい", "いい", "基本形"),
          p("と"),
          v("おもう", "おもう", "おもう", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "こと",
    calibration: [
      v("見る", "見る", "みる", "基本形"),
      w("こと", "こと", "こと", "noun"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("食べる", "食べる", "たべる", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("泳ぐ", "泳ぐ", "およぐ", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "そう (伝聞・様態)",
    calibration: [
      n("雨", "あめ"),
      p("が"),
      v("降る", "降る", "ふる", "基本形"),
      w("そう", "そう", "そう", "auxiliary"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          adj("高い", "高い", "たかい", "基本形"),
          w("そう", "そう", "そう", "auxiliary"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          adj("おいしい", "おいしい", "おいしい", "基本形"),
          w("そう", "そう", "そう", "auxiliary"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "とか～とか",
    calibration: [
      n("本", "ほん"),
      p("とか"),
      n("ペン", "ぺん"),
      p("とか"),
      v("買う", "買う", "かう", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("犬", "いぬ"),
          p("とか"),
          n("猫", "ねこ"),
          p("とか"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("パン", "ぱん"),
          p("とか"),
          n("ご飯", "ごはん"),
          p("とか"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "そういう",
    calibration: [
      w("そういう", "そういう", "そういう", "adverb"),
      n("話", "はなし"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("そういう", "そういう", "そういう", "adverb"),
          w("こと", "こと", "こと", "noun"),
          p("が"),
          adj("多い", "多い", "おおい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("そういう", "そういう", "そういう", "adverb"),
          n("本", "ほん"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "Verb[よう]",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("よう", "よう", "よう", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲も", "飲む", "のも", "未然形"),
          w("う", "う", "う", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("行こ", "行く", "いこ", "未然形"),
          w("う", "う", "う", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "かな",
    calibration: [n("鳥", "とり"), w("かな", "かな", "かな", "particle"), q("。")],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [n("猫", "ねこ"), w("かな", "かな", "かな", "particle"), q("。")],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [n("本", "ほん"), w("かな", "かな", "かな", "particle"), q("。")],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ば / なら",
    calibration: [
      v("飲め", "飲む", "のめ", "仮定形"),
      p("ば"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("行け", "行く", "いけ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("雨", "あめ"),
          w("なら", "なる", "なら", "auxiliary"),
          v("出かけ", "出かける", "でかけ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "がる / たがる",
    calibration: [
      w("寒", "寒い", "さむ", "adjective"),
      v("がる", "がる", "がる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("食べ", "食べる", "たべ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          v("がる", "がる", "がる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          w("怖", "怖い", "こわ", "adjective"),
          v("がる", "がる", "がる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "がする",
    calibration: [n("気", "き"), p("が"), v("する", "する", "する", "基本形"), q("。")],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("変", "変", "へん", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("気", "き"),
          p("が"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          adj("いい", "いい", "いい", "基本形"),
          n("感じ", "かんじ"),
          p("が"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "みたいに・みたいな",
    calibration: [
      w("みたい", "みたい", "みたい", "noun"),
      p("な"),
      n("人", "ひと"),
      p("が"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          n("星", "ほし"),
          p("が"),
          w("みたい", "みたい", "みたい", "noun"),
          p("に"),
          v("光る", "光る", "ひかる", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("みたい", "みたい", "みたい", "noun"),
          p("な"),
          n("声", "こえ"),
          p("が"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "そうに・そうな",
    calibration: [
      w("そう", "そう", "そう", "adverb"),
      p("に"),
      v("見える", "見える", "みえる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          w("そう", "そう", "そう", "adverb"),
          p("な"),
          n("顔", "かお"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 2],
        target: 0,
      },
      {
        pieces: [
          w("おいし", "おいしい", "おいし", "adjective"),
          w("そう", "そう", "そう", "auxiliary"),
          p("に"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜ようと思う",
    calibration: [
      n("留学", "りゅうがく"),
      v("し", "する", "し", "未然形"),
      w("よう", "よう", "よう", "auxiliary"),
      p("と"),
      v("思う", "思う", "おもう", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("起き", "起きる", "おき", "未然形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("と"),
          v("思う", "思う", "おもう", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          w("毎日", "毎日", "まいにち", "adverb"),
          v("走ろ", "走る", "はしろ", "未然形"),
          w("う", "う", "う", "auxiliary"),
          p("と"),
          v("思う", "思う", "おもう", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "〜にする / 〜くする",
    calibration: [
      w("静か", "静か", "しずか", "noun"),
      p("に"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("きれい", "きれい", "きれい", "noun"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          adj("甘く", "甘い", "あまく", "連用テ接続"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "といい",
    calibration: [
      v("止む", "止む", "やむ", "基本形"),
      p("と"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("治る", "治る", "なおる", "基本形"),
          p("と"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          v("晴れる", "晴れる", "はれる", "基本形"),
          p("と"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "じゃないか",
    calibration: [
      adj("いい", "いい", "いい", "基本形"),
      n("天気", "てんき"),
      w("じゃない", "じゃない", "じゃない", "auxiliary"),
      p("か"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          adj("いい", "いい", "いい", "基本形"),
          n("考え", "かんがえ"),
          w("じゃない", "じゃない", "じゃない", "auxiliary"),
          p("か"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("きれい", "きれい", "きれい", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("景色", "けしき"),
          w("じゃない", "じゃない", "じゃない", "auxiliary"),
          p("か"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "らしい",
    calibration: [
      n("男", "おとこ"),
      w("らしい", "らしい", "らしい", "auxiliary"),
      n("人", "ひと"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("春", "はる"),
          w("らしい", "らしい", "らしい", "auxiliary"),
          n("天気", "てんき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("子供", "こども"),
          w("らしい", "らしい", "らしい", "auxiliary"),
          n("質問", "しつもん"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "てほしい",
    calibration: [
      w("静か", "静か", "しずか", "noun"),
      p("に"),
      v("し", "する", "し", "連用形"),
      p("て"),
      w("ほしい", "ほしい", "ほしい", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("来", "来る", "き", "連用形"),
          p("て"),
          w("ほしい", "ほしい", "ほしい", "auxiliary"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("ゆっくり", "ゆっくり", "ゆっくり", "adverb"),
          v("休ん", "休む", "やすん", "連用タ接続"),
          p("で"),
          w("ほしい", "ほしい", "ほしい", "auxiliary"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "聞こえる / 見える",
    calibration: [
      n("音楽", "おんがく"),
      p("が"),
      v("聞こえる", "聞こえる", "きこえる", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("海", "うみ"),
          p("が"),
          v("見える", "見える", "みえる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("声", "こえ"),
          p("が"),
          v("聞こえる", "聞こえる", "きこえる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "～代",
    calibration: [
      n("バス", "ばす"),
      w("代", "代", "だい", "noun"),
      p("が"),
      adj("高い", "高い", "たかい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("電話", "でんわ"),
          w("代", "代", "だい", "noun"),
          p("が"),
          adj("高い", "高い", "たかい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("80", "80", "はちじゅう", "noun"),
          w("年代", "年代", "ねんだい", "noun"),
          p("の"),
          n("音楽", "おんがく"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "かかる / する (コスト)",
    calibration: [
      n("時間", "じかん"),
      p("が"),
      v("かかる", "かかる", "かかる", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("お金", "おかね"),
          p("が"),
          v("かかる", "かかる", "かかる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("送料", "そうりょう"),
          p("が"),
          v("かかる", "かかる", "かかる", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "Number + も",
    calibration: [
      w("三", "三", "さん", "noun"),
      n("人", "ひと"),
      p("も"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("2", "2", "に", "noun"),
          w("つ", "つ", "つ", "noun"),
          p("も"),
          v("食べ", "食べる", "たべ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("五千", "五千", "ごせん", "noun"),
          n("円", "えん"),
          p("も"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "ほとんど",
    calibration: [
      w("ほとんど", "ほとんど", "ほとんど", "adverb"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("ほとんど", "ほとんど", "ほとんど", "adverb"),
          v("飲ん", "飲む", "のん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("ほとんど", "ほとんど", "ほとんど", "adverb"),
          v("寝", "寝る", "ね", "連用形"),
          p("て"),
          w("い", "いる", "い", "verb", { conjugation: "連用形" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "そんな・こんな・あんな・どんな",
    calibration: [
      w("そんな", "そんな", "そんな", "adverb"),
      w("こと", "こと", "こと", "noun"),
      p("が"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("こんな", "こんな", "こんな", "adverb"),
          n("本", "ほん"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("どんな", "どんな", "どんな", "adverb"),
          n("本", "ほん"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "以上 / 以外",
    calibration: [
      w("三", "三", "さん", "noun"),
      n("人", "ひと"),
      w("以上", "以上", "いじょう", "noun"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("これ", "これ"),
          w("以外", "以外", "いがい", "noun"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("想像", "そうぞう"),
          w("以上", "以上", "いじょう", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ずっと",
    calibration: [
      w("ずっと", "ずっと", "ずっと", "adverb"),
      v("待っ", "待つ", "まっ", "連用タ接続"),
      p("て"),
      w("い", "いる", "い", "verb", { conjugation: "連用形" }),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("ずっと", "ずっと", "ずっと", "adverb"),
          n("雨", "あめ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("ずっと", "ずっと", "ずっと", "adverb"),
          n("昔", "むかし"),
          p("から"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "だいたい",
    calibration: [
      w("だいたい", "だいたい", "だいたい", "adverb"),
      v("分かる", "分かる", "わかる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("だいたい", "だいたい", "だいたい", "adverb"),
          w("同じ", "同じ", "おなじ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("だいたい", "だいたい", "だいたい", "adverb"),
          w("三", "三", "さん", "noun"),
          n("時間", "じかん"),
          v("かかる", "かかる", "かかる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "なん + counter + か",
    calibration: [
      w("何", "何", "なに", "noun"),
      n("人", "ひと"),
      p("か"),
      v("いる", "いる", "いる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("何", "何", "なに", "noun"),
          n("冊", "さつ"),
          p("か"),
          v("読ん", "読む", "よん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("なん", "なん", "なん", "noun"),
          n("度", "ど"),
          p("か"),
          v("行っ", "行く", "いっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "真(っ)",
    calibration: [
      w("真っ", "真っ", "まっ", "adverb"),
      w("白", "白", "しろ", "noun"),
      w("な", "な", "な", "auxiliary"),
      n("雪", "ゆき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("真っ", "真っ", "まっ", "adverb"),
          w("暗", "暗", "くら", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("夜", "よる"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("まっ", "まっ", "まっ", "adverb"),
          w("しろ", "しろ", "しろ", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("シャツ", "しゃつ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "Number + しか〜ない",
    calibration: [
      w("三", "三", "さん", "noun"),
      n("人", "ひと"),
      w("しか", "しか", "しか", "particle"),
      v("い", "いる", "い", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 5],
    holdout: [
      {
        pieces: [
          w("一", "一", "いち", "noun"),
          w("つ", "つ", "つ", "noun"),
          w("しか", "しか", "しか", "particle"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
      {
        pieces: [
          w("千", "千", "せん", "noun"),
          n("円", "えん"),
          w("しか", "しか", "しか", "particle"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
    ],
  },
  {
    construction: "すこしも～ない",
    calibration: [
      w("すこし", "すこし", "すこし", "adverb"),
      p("も"),
      v("食べ", "食べる", "たべ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 4],
    holdout: [
      {
        pieces: [
          w("少し", "少し", "すこし", "adverb"),
          p("も"),
          v("飲ま", "飲む", "のま", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
      {
        pieces: [
          w("すこし", "すこし", "すこし", "adverb"),
          p("も"),
          v("寝", "寝る", "ね", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
    ],
  },
  {
    construction: "ばあいは",
    calibration: [
      n("雨", "あめ"),
      p("の"),
      w("ばあい", "場合", "ばあい", "noun"),
      p("は"),
      v("休む", "休む", "やすむ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("台風", "たいふう"),
          p("の"),
          w("ばあい", "場合", "ばあい", "noun"),
          p("は"),
          v("休む", "休む", "やすむ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("雪", "ゆき"),
          p("の"),
          w("場合", "場合", "ばあい", "noun"),
          p("は"),
          v("休む", "休む", "やすむ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "てよかった",
    calibration: [
      n("晴れ", "はれ"),
      p("て"),
      adj("よかっ", "よい", "よかっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          adj("安く", "安い", "やすく", "連用テ接続"),
          p("て"),
          adj("よかっ", "よい", "よかっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("着い", "着く", "つい", "連用タ接続"),
          p("て"),
          adj("よかっ", "よい", "よかっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "Verb［せる・させる］",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("させる", "させる", "させる", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲ま", "飲む", "のま", "未然形"),
          w("せる", "せる", "せる", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("行か", "行く", "いか", "未然形"),
          w("せる", "せる", "せる", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜ても・〜でも",
    calibration: [
      n("雨", "あめ"),
      p("で"),
      p("も"),
      v("出かける", "出かける", "でかける", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          adj("忙しく", "忙しい", "いそがしく", "連用テ接続"),
          p("て"),
          p("も"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("子供", "こども"),
          p("で"),
          p("も"),
          v("分かる", "分かる", "わかる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "てしまう / ちゃう",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      p("て"),
      v("しまう", "しまう", "しまう", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("忘れ", "忘れる", "わすれ", "連用形"),
          v("ちゃう", "ちゃう", "ちゃう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("飲ん", "飲む", "のん", "連用タ接続"),
          v("じゃう", "じゃう", "じゃう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "させられる",
    calibration: [
      n("残業", "ざんぎょう"),
      w("させ", "させる", "させ", "auxiliary"),
      w("られる", "られる", "られる", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("来", "来る", "き", "未然形"),
          w("させ", "させる", "させ", "auxiliary"),
          w("られる", "られる", "られる", "auxiliary"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          v("食べ", "食べる", "たべ", "未然形"),
          w("させ", "させる", "させ", "auxiliary"),
          w("られる", "られる", "られる", "auxiliary"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "てある",
    calibration: [
      n("窓", "まど"),
      p("が"),
      v("開け", "開ける", "あけ", "連用形"),
      p("て"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("ご飯", "ごはん"),
          p("が"),
          v("作っ", "作る", "つくっ", "連用タ接続"),
          p("て"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("鍵", "かぎ"),
          p("が"),
          v("かけ", "かける", "かけ", "連用形"),
          p("て"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "ているあいだに",
    calibration: [
      n("テレビ", "てれび"),
      p("を"),
      v("見", "見る", "み", "連用形"),
      p("て"),
      w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
      w("あいだ", "あいだ", "あいだ", "noun"),
      p("に"),
      v("寝", "寝る", "ね", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 7],
    holdout: [
      {
        pieces: [
          n("音楽", "おんがく"),
          p("を"),
          v("聞い", "聞く", "きい", "連用タ接続"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          w("あいだ", "あいだ", "あいだ", "noun"),
          p("に"),
          v("寝", "寝る", "ね", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 7],
        target: 3,
      },
      {
        pieces: [
          n("本", "ほん"),
          p("を"),
          v("読ん", "読む", "よん", "連用タ接続"),
          p("で"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          w("あいだ", "あいだ", "あいだ", "noun"),
          p("に"),
          v("寝", "寝る", "ね", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 7],
        target: 3,
      },
    ],
  },
  {
    construction: "なくてもいい",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
      p("て"),
      p("も"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          v("飲ま", "飲む", "のま", "未然形"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          p("て"),
          p("も"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          v("来", "来る", "き", "未然形"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          p("て"),
          p("も"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "てみる",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      p("て"),
      v("みる", "みる", "みる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("飲ん", "飲む", "のん", "連用タ接続"),
          p("で"),
          v("みる", "みる", "みる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("着", "着る", "き", "連用形"),
          p("て"),
          v("みる", "みる", "みる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜てあげる / 〜てくれる / 〜てもらう",
    calibration: [
      n("花", "はな"),
      p("を"),
      v("買っ", "買う", "かっ", "連用タ接続"),
      p("て"),
      v("あげる", "あげる", "あげる", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("荷物", "にもつ"),
          p("を"),
          v("持っ", "持つ", "もっ", "連用タ接続"),
          p("て"),
          v("くれる", "くれる", "くれる", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("宿題", "しゅくだい"),
          p("を"),
          v("見", "見る", "み", "連用形"),
          p("て"),
          v("もらう", "もらう", "もらう", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "〜てくれてありがとう",
    calibration: [
      v("手伝っ", "手伝う", "てつだっ", "連用タ接続"),
      p("て"),
      v("くれ", "くれる", "くれ", "連用形"),
      p("て"),
      w("ありがとう", "ありがとう", "ありがとう", "interjection"),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          v("教え", "教える", "おしえ", "連用形"),
          p("て"),
          v("くれ", "くれる", "くれ", "連用形"),
          p("て"),
          w("ありがとう", "ありがとう", "ありがとう", "interjection"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          v("運ん", "運ぶ", "はこん", "連用タ接続"),
          p("で"),
          v("くれ", "くれる", "くれ", "連用形"),
          p("て"),
          w("ありがとう", "ありがとう", "ありがとう", "interjection"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "〜てくれない / 〜てもらえない",
    calibration: [
      v("貸し", "貸す", "かし", "連用形"),
      p("て"),
      v("くれ", "くれる", "くれ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("教え", "教える", "おしえ", "連用形"),
          p("て"),
          v("くれ", "くれる", "くれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("手伝っ", "手伝う", "てつだっ", "連用タ接続"),
          p("て"),
          v("もらえ", "もらう", "もらえ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "たら",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      w("たら", "たら", "たら", "auxiliary"),
      v("太る", "太る", "ふとる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲ん", "飲む", "のん", "連用タ接続"),
          w("だら", "だら", "だら", "auxiliary"),
          v("酔う", "酔う", "よう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          adj("安かっ", "安い", "やすかっ", "連用タ接続"),
          w("たら", "たら", "たら", "auxiliary"),
          v("買う", "買う", "かう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ほかに",
    calibration: [
      w("ほかに", "ほかに", "ほかに", "adverb"),
      w("何", "何", "なに", "noun"),
      p("も"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("ほかに", "ほかに", "ほかに", "adverb"),
          w("誰", "誰", "だれ", "noun"),
          p("も"),
          v("い", "いる", "い", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("ほかに", "ほかに", "ほかに", "adverb"),
          n("意見", "いけん"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "そんなに",
    calibration: [
      w("そんなに", "そんなに", "そんなに", "adverb"),
      v("食べ", "食べる", "たべ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      p("で"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("そんなに", "そんなに", "そんなに", "adverb"),
          adj("難しく", "難しい", "むずかしく", "連用テ接続"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("そんなに", "そんなに", "そんなに", "adverb"),
          v("急が", "急ぐ", "いそが", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("で"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "れる・られる (可能)",
    calibration: [
      w("この", "この", "この", "adverb"),
      n("辞書", "じしょ"),
      p("は"),
      v("読める", "読む", "よめる", "可能形"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          w("ひらがな", "ひらがな", "ひらがな", "noun"),
          p("は"),
          v("書ける", "書く", "かける", "可能形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("日本語", "にほんご"),
          p("が"),
          v("話せる", "話す", "はなせる", "可能形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "んだけど / んですが",
    calibration: [
      n("頭", "あたま"),
      p("が"),
      adj("痛い", "痛い", "いたい", "基本形"),
      w("ん", "ん", "ん", "noun"),
      w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
      p("けど"),
      q("。"),
    ],
    calibrationRange: [3, 6],
    holdout: [
      {
        pieces: [
          v("疲れ", "疲れる", "つかれ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("ん", "ん", "ん", "noun"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          p("けど"),
          p("さ"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          w("明日", "明日", "あした", "adverb"),
          p("は"),
          w("無理", "無理", "むり", "noun"),
          w("ん", "ん", "ん", "noun"),
          aux("です", "です", "です", "基本形"),
          p("が"),
          p("さ"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "はずだ / はずがない",
    calibration: [
      n("彼", "かれ"),
      p("は"),
      v("来る", "来る", "くる", "基本形"),
      w("はず", "はず", "はず", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("雨", "あめ"),
          p("が"),
          v("降る", "降る", "ふる", "基本形"),
          w("はず", "はず", "はず", "noun"),
          p("が"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
      {
        pieces: [
          n("彼女", "かのじょ"),
          p("は"),
          v("知っ", "知る", "しっ", "連用タ接続"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          w("はず", "はず", "はず", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [5, 7],
        target: 5,
      },
    ],
  },
  {
    construction: "かどうか",
    calibration: [
      v("来る", "来る", "くる", "基本形"),
      p("か"),
      w("どう", "どう", "どう", "adverb"),
      p("か"),
      v("分から", "分かる", "わから", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("晴れる", "晴れる", "はれる", "基本形"),
          p("か"),
          w("どう", "どう", "どう", "adverb"),
          p("か"),
          v("分から", "分かる", "わから", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("彼", "かれ"),
          p("が"),
          v("来る", "来る", "くる", "基本形"),
          p("か"),
          w("どう", "どう", "どう", "adverb"),
          p("か"),
          v("知ら", "知る", "しら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "と (条件)",
    calibration: [
      v("押す", "押す", "おす", "基本形"),
      p("と"),
      v("開く", "開く", "あく", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("食べる", "食べる", "たべる", "基本形"),
          p("と"),
          v("太る", "太る", "ふとる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("春", "はる"),
          p("に"),
          v("なる", "なる", "なる", "基本形"),
          p("と"),
          adj("暖かく", "暖かい", "あたたかく", "連用テ接続"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "ないと",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      p("と"),
      adj("大きく", "大きい", "おおきく", "連用テ接続"),
      v("なら", "なる", "なら", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("寝", "寝る", "ね", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("と"),
          w("明日", "明日", "あした", "adverb"),
          p("が"),
          adj("つらい", "つらい", "つらい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("急が", "急ぐ", "いそが", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("と"),
          v("遅れる", "遅れる", "おくれる", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "だけでなく",
    calibration: [
      n("日本語", "にほんご"),
      p("だけ"),
      p("で"),
      w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
      n("英語", "えいご"),
      p("も"),
      v("話せる", "話す", "はなせる", "可能形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("母", "はは"),
          p("だけ"),
          p("で"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          n("父", "ちち"),
          p("も"),
          v("来る", "来る", "くる", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("犬", "いぬ"),
          p("だけ"),
          p("で"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          n("猫", "ねこ"),
          p("も"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "かい",
    calibration: [v("行く", "行く", "いく", "基本形"), p("かい"), q("。")],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [v("食べる", "食べる", "たべる", "基本形"), p("かい"), q("。")],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [v("分かる", "分かる", "わかる", "基本形"), p("かい"), q("。")],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "もし",
    calibration: [
      w("もし", "もし", "もし", "adverb"),
      n("雨", "あめ"),
      p("が"),
      v("降っ", "降る", "ふっ", "連用タ接続"),
      w("たら", "たら", "たら", "auxiliary"),
      n("中止", "ちゅうし"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("もし", "もし", "もし", "adverb"),
          n("時間", "じかん"),
          p("が"),
          v("あっ", "ある", "あっ", "連用タ接続"),
          w("たら", "たら", "たら", "auxiliary"),
          n("電話", "でんわ"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("もし", "もし", "もし", "adverb"),
          adj("よかっ", "よい", "よかっ", "連用タ接続"),
          w("たら", "たら", "たら", "auxiliary"),
          v("教え", "教える", "おしえ", "連用形"),
          p("て"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "し",
    calibration: [
      adj("安い", "安い", "やすい", "基本形"),
      p("し"),
      adj("寒い", "寒い", "さむい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("雨", "あめ"),
          aux("だ", "だ", "だ", "基本形"),
          p("し"),
          "、",
          n("風", "かぜ"),
          p("も"),
          adj("強い", "強い", "つよい", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          v("行く", "行く", "いく", "基本形"),
          p("し"),
          "、",
          v("食べる", "食べる", "たべる", "基本形"),
          p("し"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ようにする",
    calibration: [
      w("早く", "早い", "はやく", "adverb"),
      v("起きる", "起きる", "おきる", "基本形"),
      w("よう", "よう", "よう", "auxiliary"),
      p("に"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          w("毎日", "毎日", "まいにち", "adverb"),
          n("運動", "うんどう"),
          v("する", "する", "する", "基本形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
      {
        pieces: [
          n("野菜", "やさい"),
          p("を"),
          v("食べる", "食べる", "たべる", "基本形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "〜つづける",
    calibration: [
      v("読み", "読む", "よみ", "連用形"),
      v("つづける", "つづける", "つづける", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("走り", "走る", "はしり", "連用形"),
          v("つづける", "つづける", "つづける", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("書き", "書く", "かき", "連用形"),
          v("つづける", "つづける", "つづける", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ようにいう",
    calibration: [
      n("先生", "せんせい"),
      p("に"),
      v("頑張る", "頑張る", "がんばる", "基本形"),
      w("よう", "よう", "よう", "auxiliary"),
      p("に"),
      v("言わ", "言う", "いわ", "未然形"),
      w("れた", "れる", "れた", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("母", "はは"),
          p("に"),
          n("野菜", "やさい"),
          p("を"),
          v("食べる", "食べる", "たべる", "基本形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("言わ", "言う", "いわ", "未然形"),
          w("れた", "れる", "れた", "auxiliary"),
          q("。"),
        ],
        range: [5, 7],
        target: 5,
      },
      {
        pieces: [
          n("医者", "いしゃ"),
          p("に"),
          v("痩せる", "痩せる", "やせる", "基本形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("言わ", "言う", "いわ", "未然形"),
          w("れた", "れる", "れた", "auxiliary"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "よていだ",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("は"),
      n("休み", "やすみ"),
      p("の"),
      w("よてい", "予定", "よてい", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 6],
    holdout: [
      {
        pieces: [
          n("会議", "かいぎ"),
          p("は"),
          w("三時", "三時", "さんじ", "noun"),
          p("から"),
          p("の"),
          w("よてい", "予定", "よてい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [5, 7],
        target: 5,
      },
      {
        pieces: [
          n("旅行", "りょこう"),
          w("来月", "来月", "らいげつ", "noun"),
          p("の"),
          w("予定", "予定", "よてい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "〜たばかり",
    calibration: [
      w("さっき", "さっき", "さっき", "adverb"),
      v("食べ", "食べる", "たべ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("ばかり", "ばかり", "ばかり", "particle"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          w("さっき", "さっき", "さっき", "adverb"),
          v("着い", "着く", "つい", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("ばかり", "ばかり", "ばかり", "particle"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("さっき", "さっき", "さっき", "adverb"),
          v("起き", "起きる", "おき", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("ばかり", "ばかり", "ばかり", "particle"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "命令形 (動詞)",
    calibration: [
      n("紙", "かみ"),
      p("に"),
      n("名前", "なまえ"),
      p("を"),
      v("書け", "書く", "かけ", "命令形"),
      p("よ"),
      q("。"),
    ],
    calibrationRange: [4, 5],
    holdout: [
      {
        pieces: [
          w("静か", "静か", "しずか", "noun"),
          p("に"),
          v("しろ", "する", "しろ", "命令形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("来い", "来る", "こい", "命令形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ように (目的)",
    calibration: [
      v("痩せる", "痩せる", "やせる", "基本形"),
      w("よう", "よう", "よう", "auxiliary"),
      p("に"),
      v("食べる", "食べる", "たべる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("間に合う", "間に合う", "まにあう", "基本形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("急ぐ", "急ぐ", "いそぐ", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("忘れ", "忘れる", "わすれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          n("メモ", "めも"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "かしら",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("は"),
      v("晴れる", "晴れる", "はれる", "基本形"),
      w("かしら", "かしら", "かしら", "particle"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          n("彼", "かれ"),
          p("は"),
          v("来る", "来る", "くる", "基本形"),
          w("かしら", "かしら", "かしら", "particle"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("で"),
          adj("いい", "いい", "いい", "基本形"),
          w("かしら", "かしら", "かしら", "particle"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "って感じ",
    calibration: [
      adj("懐かしい", "懐かしい", "なつかしい", "基本形"),
      p("って"),
      w("感じ", "感じ", "かんじ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("変", "変", "へん", "noun"),
          w("な", "な", "な", "auxiliary"),
          p("って"),
          w("感じ", "感じ", "かんじ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          adj("いい", "いい", "いい", "基本形"),
          p("って"),
          w("感じ", "感じ", "かんじ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "風",
    calibration: [
      n("日本", "にほん"),
      w("風", "風", "かぜ", "noun"),
      p("の"),
      n("音楽", "おんがく"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          w("和風", "和風", "わふう", "noun"),
          p("の"),
          n("旅館", "りょかん"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          n("中華", "ちゅうか"),
          w("風", "風", "かぜ", "noun"),
          p("の"),
          n("料理", "りょうり"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "にきがつく",
    calibration: [
      n("間違い", "まちがい"),
      p("に"),
      w("気", "気", "き", "noun"),
      p("が"),
      v("つく", "つく", "つく", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          n("嘘", "うそ"),
          p("に"),
          w("気", "気", "き", "noun"),
          p("が"),
          v("つく", "つく", "つく", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          n("変化", "へんか"),
          p("に"),
          w("気", "気", "き", "noun"),
          p("が"),
          v("つく", "つく", "つく", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "それに",
    calibration: [
      w("それに", "それに", "それに", "adverb"),
      adj("安い", "安い", "やすい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("それに", "それに", "それに", "adverb"),
          adj("おいしい", "おいしい", "おいしい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("それに", "それに", "それに", "adverb"),
          adj("近い", "近い", "ちかい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "それで",
    calibration: [
      w("それで", "それで", "それで", "adverb"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("それで", "それで", "それで", "adverb"),
          n("終わり", "おわり"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("それで", "それで", "それで", "adverb"),
          w("十分", "十分", "じゅうぶん", "noun"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "Question-phrase + か",
    calibration: [
      w("だれか", "だれか", "だれか", "noun"),
      v("来る", "来る", "くる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("いつか", "いつか", "いつか", "adverb"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("なにか", "なにか", "なにか", "noun"),
          v("食べ", "食べる", "たべ", "連用形"),
          w("たい", "たい", "たい", "auxiliary"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "それでも",
    calibration: [
      w("それでも", "それでも", "それでも", "adverb"),
      v("行く", "行く", "いく", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("それでも", "それでも", "それでも", "adverb"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("それでも", "それでも", "それでも", "adverb"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "たらどう",
    calibration: [
      v("休ん", "休む", "やすん", "連用タ接続"),
      w("だら", "だら", "だら", "auxiliary"),
      w("どう", "どう", "どう", "adverb"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("寝", "寝る", "ね", "連用形"),
          w("たら", "たら", "たら", "auxiliary"),
          w("どう", "どう", "どう", "adverb"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("ゆっくり", "ゆっくり", "ゆっくり", "adverb"),
          v("休ん", "休む", "やすん", "連用タ接続"),
          w("だら", "だら", "だら", "auxiliary"),
          w("どう", "どう", "どう", "adverb"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "といわれている",
    calibration: [
      n("彼", "かれ"),
      p("は"),
      n("親切", "しんせつ"),
      aux("だ", "だ", "だ", "基本形"),
      p("と"),
      v("いわれている", "いわれる", "いわれている", "受身形"),
      q("。"),
    ],
    calibrationRange: [4, 6],
    holdout: [
      {
        pieces: [
          n("富士山", "ふじさん"),
          p("は"),
          adj("高い", "高い", "たかい", "基本形"),
          p("と"),
          v("いわれている", "いわれる", "いわれている", "受身形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("彼女", "かのじょ"),
          p("は"),
          adj("優しい", "優しい", "やさしい", "基本形"),
          p("と"),
          v("いわれている", "いわれる", "いわれている", "受身形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "ばよかった",
    calibration: [
      w("もっと", "もっと", "もっと", "adverb"),
      w("早く", "早い", "はやく", "adverb"),
      v("来れ", "来る", "これ", "仮定形"),
      p("ば"),
      adj("よかっ", "よい", "よかっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 6],
    holdout: [
      {
        pieces: [
          w("もっと", "もっと", "もっと", "adverb"),
          v("勉強すれ", "勉強する", "べんきょうすれ", "仮定形"),
          p("ば"),
          adj("よかっ", "よい", "よかっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("寝れ", "寝る", "ねれ", "仮定形"),
          p("ば"),
          adj("よかっ", "よい", "よかっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "ばいい",
    calibration: [
      w("早く", "早い", "はやく", "adverb"),
      v("寝れ", "寝る", "ねれ", "仮定形"),
      p("ば"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          w("もっと", "もっと", "もっと", "adverb"),
          v("食べれ", "食べる", "たべれ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("ゆっくり", "ゆっくり", "ゆっくり", "adverb"),
          v("休め", "休む", "やすめ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "中",
    calibration: [
      n("部屋", "へや"),
      p("の"),
      w("中", "中", "なか", "noun"),
      p("で"),
      v("遊ぶ", "遊ぶ", "あそぶ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("箱", "はこ"),
          p("の"),
          w("中", "中", "なか", "noun"),
          p("に"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          n("ポケット", "ぽけっと"),
          p("の"),
          w("中", "中", "なか", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "うちに / ないうちに",
    calibration: [
      adj("暗く", "暗い", "くらく", "連用テ接続"),
      v("なら", "なる", "なら", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      w("うち", "うち", "うち", "noun"),
      p("に"),
      v("帰る", "帰る", "かえる", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          adj("若い", "若い", "わかい", "基本形"),
          w("うち", "うち", "うち", "noun"),
          p("に"),
          v("遊ぶ", "遊ぶ", "あそぶ", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("忘れ", "忘れる", "わすれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("うち", "うち", "うち", "noun"),
          p("に"),
          n("メモ", "めも"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "べき / べきではない",
    calibration: [
      n("学生", "がくせい"),
      p("は"),
      n("勉強", "べんきょう"),
      v("す", "する", "す", "未然形"),
      w("べき", "べき", "べき", "auxiliary"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 6],
    holdout: [
      {
        pieces: [
          n("嘘", "うそ"),
          p("を"),
          v("つく", "つく", "つく", "基本形"),
          w("べき", "べき", "べき", "auxiliary"),
          p("で"),
          p("は"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 7],
        target: 3,
      },
      {
        pieces: [
          w("もっと", "もっと", "もっと", "adverb"),
          v("寝る", "寝る", "ねる", "基本形"),
          w("べき", "べき", "べき", "auxiliary"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "なかなか",
    calibration: [
      w("なかなか", "なかなか", "なかなか", "adverb"),
      v("来", "来る", "き", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("なかなか", "なかなか", "なかなか", "adverb"),
          v("寝", "寝る", "ね", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("なかなか", "なかなか", "なかなか", "adverb"),
          adj("いい", "いい", "いい", "基本形"),
          n("天気", "てんき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "なかなか〜ない",
    calibration: [
      w("なかなか", "なかなか", "なかなか", "adverb"),
      v("起き", "起きる", "おき", "未然形"),
      w("られ", "られる", "られ", "auxiliary"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 4],
    holdout: [
      {
        pieces: [
          w("なかなか", "なかなか", "なかなか", "adverb"),
          v("眠れ", "眠る", "ねむれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("なかなか", "なかなか", "なかなか", "adverb"),
          v("温まら", "温まる", "あたたまら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "によって",
    calibration: [
      n("人", "ひと"),
      p("に"),
      v("よっ", "よる", "よっ", "連用タ接続"),
      p("て"),
      v("違う", "違う", "ちがう", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("季節", "きせつ"),
          p("に"),
          v("よっ", "よる", "よっ", "連用タ接続"),
          p("て"),
          v("違う", "違う", "ちがう", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("場合", "ばあい"),
          p("に"),
          v("よっ", "よる", "よっ", "連用タ接続"),
          p("て"),
          v("違う", "違う", "ちがう", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "全く〜ない",
    calibration: [
      w("全く", "全く", "まったく", "adverb"),
      v("知ら", "知る", "しら", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("全く", "全く", "まったく", "adverb"),
          v("食べ", "食べる", "たべ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("まったく", "まったく", "まったく", "adverb"),
          n("問題", "もんだい"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "させてもらう",
    calibration: [
      w("一足", "一足", "ひとあし", "adverb"),
      n("先", "さき"),
      p("に"),
      v("食べ", "食べる", "たべ", "未然形"),
      w("させ", "させる", "させ", "auxiliary"),
      p("て"),
      v("もらう", "もらう", "もらう", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 7],
    holdout: [
      {
        pieces: [
          n("先生", "せんせい"),
          p("に"),
          v("教え", "教える", "おしえ", "未然形"),
          w("させ", "させる", "させ", "auxiliary"),
          p("て"),
          v("もらう", "もらう", "もらう", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
      {
        pieces: [
          n("先", "さき"),
          p("に"),
          n("失礼", "しつれい"),
          w("させ", "させる", "させ", "auxiliary"),
          p("て"),
          v("もらう", "もらう", "もらう", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "Particle + の",
    calibration: [w("私", "私", "わたし", "noun"), p("の"), n("本", "ほん"), q("。")],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [n("彼", "かれ"), p("の"), n("車", "くるま"), q("。")],
        range: [0, 2],
        target: 0,
      },
      {
        pieces: [n("これ", "これ"), p("の"), n("名前", "なまえ"), p("は"), q("。")],
        range: [0, 2],
        target: 0,
      },
    ],
  },
  {
    construction: "ところが / ところで",
    calibration: [
      w("ところが", "ところが", "ところが", "adverb"),
      n("雨", "あめ"),
      p("が"),
      v("降っ", "降る", "ふっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("ところで", "ところで", "ところで", "adverb"),
          w("明日", "明日", "あした", "adverb"),
          p("は"),
          w("暇", "暇", "ひま", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("ところが", "ところが", "ところが", "adverb"),
          n("彼", "かれ"),
          p("は"),
          v("来", "来る", "き", "未然形"),
          w("なかっ", "ない", "なかっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "ほど / ほど〜ない",
    calibration: [
      v("思っ", "思う", "おもっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("ほど", "ほど", "ほど", "particle"),
      adj("難しく", "難しい", "むずかしく", "連用テ接続"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("想像", "そうぞう"),
          w("ほど", "ほど", "ほど", "particle"),
          w("簡単", "簡単", "かんたん", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("言う", "言う", "いう", "基本形"),
          w("ほど", "ほど", "ほど", "particle"),
          adj("悪く", "悪い", "わるく", "連用テ接続"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ば〜ほど",
    calibration: [
      v("行け", "行く", "いけ", "仮定形"),
      p("ば"),
      v("行く", "行く", "いく", "基本形"),
      w("ほど", "ほど", "ほど", "particle"),
      v("太る", "太る", "ふとる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("読め", "読む", "よめ", "仮定形"),
          p("ば"),
          v("読む", "読む", "よむ", "基本形"),
          w("ほど", "ほど", "ほど", "particle"),
          adj("賢く", "賢い", "かしこく", "連用テ接続"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("年", "とし"),
          p("を"),
          v("取れ", "取る", "とれ", "仮定形"),
          p("ば"),
          v("取る", "取る", "とる", "基本形"),
          w("ほど", "ほど", "ほど", "particle"),
          v("忘れる", "忘れる", "わすれる", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "という / というのは",
    calibration: [
      n("寿司", "すし"),
      w("という", "という", "という", "particle"),
      n("食べ物", "たべもの"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          w("何", "何", "なに", "noun"),
          w("という", "という", "という", "particle"),
          n("花", "はな"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          n("富士山", "ふじさん"),
          w("という", "という", "という", "particle"),
          n("山", "やま"),
          p("が"),
          w("有名", "有名", "ゆうめい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "的",
    calibration: [
      n("日本", "にほん"),
      w("的", "的", "てき", "noun"),
      w("な", "な", "な", "auxiliary"),
      n("発想", "はっそう"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("世界", "せかい"),
          w("的", "的", "てき", "noun"),
          p("に"),
          w("有名", "有名", "ゆうめい", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("伝統", "でんとう"),
          w("的", "的", "てき", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("祭り", "まつり"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "もの / もん",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      w("もの", "もの", "もの", "noun"),
      p("が"),
      n("好き", "すき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("飲み", "飲む", "のみ", "連用形"),
          w("もの", "もの", "もの", "noun"),
          p("が"),
          n("好き", "すき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("知ら", "知る", "しら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("もん", "もん", "もん", "particle"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "ものだ",
    calibration: [
      w("昔", "昔", "むかし", "adverb"),
      p("は"),
      adj("よかっ", "よい", "よかっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("もの", "もの", "もの", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 6],
    holdout: [
      {
        pieces: [
          n("子供", "こども"),
          p("は"),
          v("寝る", "寝る", "ねる", "基本形"),
          w("もの", "もの", "もの", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          n("約束", "やくそく"),
          p("は"),
          v("守る", "守る", "まもる", "基本形"),
          w("もの", "もの", "もの", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "おかげで",
    calibration: [
      w("君", "君", "きみ", "noun"),
      p("の"),
      w("おかげ", "おかげ", "おかげ", "noun"),
      p("で"),
      v("助かっ", "助かる", "たすかっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("薬", "くすり"),
          p("の"),
          w("おかげ", "おかげ", "おかげ", "noun"),
          p("で"),
          v("治っ", "治る", "なおっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("みんな", "みんな", "みんな", "noun"),
          p("の"),
          w("おかげ", "おかげ", "おかげ", "noun"),
          p("で"),
          v("でき", "できる", "でき", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "こそ / からこそ",
    calibration: [
      w("あなた", "あなた", "あなた", "noun"),
      p("こそ"),
      n("必要", "ひつよう"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          w("今", "今", "いま", "adverb"),
          p("こそ"),
          v("頑張る", "頑張る", "がんばる", "基本形"),
          w("とき", "とき", "とき", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("君", "君", "きみ", "noun"),
          p("の"),
          n("努力", "どりょく"),
          v("あっ", "ある", "あっ", "連用タ接続"),
          p("て"),
          p("こそ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [5, 6],
        target: 5,
      },
    ],
  },
  {
    construction: "ばかり",
    calibration: [
      n("冗談", "じょうだん"),
      p("ばかり"),
      v("言う", "言う", "いう", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("文句", "もんく"),
          p("ばかり"),
          v("言う", "言う", "いう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("食べ", "食べる", "たべ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("ばかり", "ばかり", "ばかり", "particle"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "ばかりに",
    calibration: [
      adj("甘く", "甘い", "あまく", "連用テ接続"),
      v("見", "見る", "み", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("ばかり", "ばかり", "ばかり", "particle"),
      p("に"),
      n("失敗", "しっぱい"),
      v("し", "する", "し", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("油断", "ゆだん"),
          v("し", "する", "し", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("ばかり", "ばかり", "ばかり", "particle"),
          p("に"),
          v("負け", "負ける", "まけ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          v("急い", "急ぐ", "いそい", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          w("ばかり", "ばかり", "ばかり", "particle"),
          p("に"),
          v("忘れ", "忘れる", "わすれ", "連用形"),
          w("もの", "もの", "もの", "noun"),
          p("を"),
          v("し", "する", "し", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "ことがある (頻度)",
    calibration: [
      w("たま", "たま", "たま", "adverb"),
      p("に"),
      n("京都", "きょうと"),
      p("に"),
      v("行く", "行く", "いく", "基本形"),
      w("こと", "こと", "こと", "noun"),
      p("が"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [5, 8],
    holdout: [
      {
        pieces: [
          w("時々", "時々", "ときどき", "adverb"),
          n("映画", "えいが"),
          p("を"),
          v("見る", "見る", "みる", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [4, 7],
        target: 4,
      },
      {
        pieces: [
          w("よく", "よい", "よく", "adverb"),
          n("ここ", "ここ"),
          p("に"),
          v("来る", "来る", "くる", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [4, 7],
        target: 4,
      },
    ],
  },
  {
    construction: "ことにする / ことになる",
    calibration: [
      n("禁煙", "きんえん"),
      v("する", "する", "する", "基本形"),
      w("こと", "こと", "こと", "noun"),
      p("に"),
      v("し", "する", "し", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 6],
    holdout: [
      {
        pieces: [
          n("引っ越し", "ひっこし"),
          v("する", "する", "する", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("に"),
          v("なっ", "なる", "なっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
      {
        pieces: [
          w("明日", "明日", "あした", "adverb"),
          p("から"),
          v("走る", "走る", "はしる", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "ことはない",
    calibration: [
      n("心配", "しんぱい"),
      v("する", "する", "する", "基本形"),
      w("こと", "こと", "こと", "noun"),
      p("は"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          v("謝る", "謝る", "あやまる", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("は"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("急ぐ", "急ぐ", "いそぐ", "基本形"),
          w("こと", "こと", "こと", "noun"),
          p("は"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "～と言っても",
    calibration: [
      n("子供", "こども"),
      aux("だ", "だ", "だ", "基本形"),
      p("と"),
      v("言っ", "言う", "いっ", "連用タ接続"),
      p("て"),
      p("も"),
      n("大人", "おとな"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 6],
    holdout: [
      {
        pieces: [
          adj("簡単", "簡単", "かんたん", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          p("と"),
          v("言っ", "言う", "いっ", "連用タ接続"),
          p("て"),
          p("も"),
          adj("難しい", "難しい", "むずかしい", "基本形"),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
      {
        pieces: [
          n("元気", "げんき"),
          aux("だ", "だ", "だ", "基本形"),
          p("と"),
          v("言っ", "言う", "いっ", "連用タ接続"),
          p("て"),
          p("も"),
          w("無理", "無理", "むり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
    ],
  },
  {
    construction: "といえば",
    calibration: [
      n("京都", "きょうと"),
      p("と"),
      v("いえ", "言う", "いえ", "仮定形"),
      p("ば"),
      n("寺", "てら"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("夏", "なつ"),
          p("と"),
          v("いえ", "言う", "いえ", "仮定形"),
          p("ば"),
          n("海", "うみ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("日本", "にほん"),
          p("と"),
          v("いえ", "言う", "いえ", "仮定形"),
          p("ば"),
          n("富士山", "ふじさん"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "〜合う",
    calibration: [
      v("話し", "話す", "はなし", "連用形"),
      v("あう", "あう", "あう", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("助け", "助ける", "たすけ", "連用形"),
          v("あう", "あう", "あう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("向かい", "向かう", "むかい", "連用形"),
          v("あう", "あう", "あう", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "について",
    calibration: [
      n("日本", "にほん"),
      p("の"),
      n("文化", "ぶんか"),
      p("に"),
      v("つい", "つく", "つい", "連用形"),
      p("て"),
      v("考える", "考える", "かんがえる", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 6],
    holdout: [
      {
        pieces: [
          n("計画", "けいかく"),
          p("に"),
          v("つい", "つく", "つい", "連用形"),
          p("て"),
          v("話す", "話す", "はなす", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("問題", "もんだい"),
          p("に"),
          v("つい", "つく", "つい", "連用形"),
          p("て"),
          v("考える", "考える", "かんがえる", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "ちゃんと",
    calibration: [
      w("ちゃんと", "ちゃんと", "ちゃんと", "adverb"),
      v("食べる", "食べる", "たべる", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("ちゃんと", "ちゃんと", "ちゃんと", "adverb"),
          v("寝る", "寝る", "ねる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("ちゃんと", "ちゃんと", "ちゃんと", "adverb"),
          v("聞く", "聞く", "きく", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "に比べて",
    calibration: [
      n("去年", "きょねん"),
      p("に"),
      v("比べ", "比べる", "くらべ", "連用形"),
      p("て"),
      adj("暑い", "暑い", "あつい", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("姉", "あね"),
          p("に"),
          v("比べ", "比べる", "くらべ", "連用形"),
          p("て"),
          n("背", "せ"),
          p("が"),
          adj("高い", "高い", "たかい", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("弟", "おとうと"),
          p("に"),
          v("比べ", "比べる", "くらべ", "連用形"),
          p("て"),
          w("静か", "静か", "しずか", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "どんなに〜ても / いくら〜でも",
    calibration: [
      w("どんなに", "どんなに", "どんなに", "adverb"),
      adj("高く", "高い", "たかく", "連用テ接続"),
      p("て"),
      p("も"),
      v("買う", "買う", "かう", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 4],
    holdout: [
      {
        pieces: [
          w("どんなに", "どんなに", "どんなに", "adverb"),
          adj("忙しく", "忙しい", "いそがしく", "連用テ接続"),
          p("て"),
          p("も"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
      {
        pieces: [
          w("いくら", "いくら", "いくら", "adverb"),
          n("雨", "あめ"),
          p("で"),
          p("も"),
          v("出かける", "出かける", "でかける", "基本形"),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
    ],
  },
  {
    construction: "かなり",
    calibration: [
      w("かなり", "かなり", "かなり", "adverb"),
      adj("高い", "高い", "たかい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("かなり", "かなり", "かなり", "adverb"),
          adj("難しい", "難しい", "むずかしい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("かなり", "かなり", "かなり", "adverb"),
          adj("遠い", "遠い", "とおい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "あまりに",
    calibration: [
      w("あまりに", "あまりに", "あまりに", "adverb"),
      adj("寒い", "寒い", "さむい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("あまりに", "あまりに", "あまりに", "adverb"),
          adj("高い", "高い", "たかい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("あまりに", "あまりに", "あまりに", "adverb"),
          w("静か", "静か", "しずか", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "わけだ / わけではない",
    calibration: [
      w("そういう", "そういう", "そういう", "adverb"),
      w("わけ", "わけ", "わけ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("知ら", "知る", "しら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("わけ", "わけ", "わけ", "noun"),
          p("で"),
          p("は"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 6],
        target: 2,
      },
      {
        pieces: [
          w("だから", "だから", "だから", "adverb"),
          w("こう", "こう", "こう", "adverb"),
          v("なる", "なる", "なる", "基本形"),
          w("わけ", "わけ", "わけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "ところだった",
    calibration: [
      v("忘れる", "忘れる", "わすれる", "基本形"),
      w("ところ", "ところ", "ところ", "noun"),
      w("だっ", "だ", "だっ", "auxiliary", { conjugation: "連用タ接続" }),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("転ぶ", "転ぶ", "ころぶ", "基本形"),
          w("ところ", "ところ", "ところ", "noun"),
          w("だっ", "だ", "だっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("遅れる", "遅れる", "おくれる", "基本形"),
          w("ところ", "ところ", "ところ", "noun"),
          w("だっ", "だ", "だっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "だって / んだって",
    calibration: [
      p("だって"),
      v("知ら", "知る", "しら", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      p("よ"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("んだって", "んだって", "んだって", "particle"),
          v("知ら", "知る", "しら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          p("よ"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          p("だって"),
          w("明日", "明日", "あした", "adverb"),
          p("は"),
          n("休み", "やすみ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "に対して",
    calibration: [
      n("彼", "かれ"),
      p("に"),
      v("対し", "対する", "たいし", "連用形"),
      p("て"),
      adj("厳しい", "厳しい", "きびしい", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("子供", "こども"),
          p("に"),
          v("対し", "対する", "たいし", "連用形"),
          p("て"),
          adj("優しい", "優しい", "やさしい", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("意見", "いけん"),
          p("に"),
          v("対し", "対する", "たいし", "連用形"),
          p("て"),
          n("反対", "はんたい"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "さ (フィラー・間投詞)",
    calibration: [
      adj("いい", "いい", "いい", "基本形"),
      w("さ", "さ", "さ", "particle"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          w("さあ", "さあ", "さあ", "interjection"),
          v("行こ", "行く", "いこ", "未然形"),
          w("う", "う", "う", "auxiliary"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("そう", "そう", "そう", "adverb"),
          aux("だ", "だ", "だ", "基本形"),
          w("ろ", "ろ", "ろ", "auxiliary"),
          w("さ", "さ", "さ", "particle"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "それぞれ",
    calibration: [
      w("それぞれ", "それぞれ", "それぞれ", "noun"),
      p("の"),
      n("意見", "いけん"),
      p("が"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("それぞれ", "それぞれ", "それぞれ", "noun"),
          p("の"),
          n("国", "くに"),
          p("に"),
          v("帰る", "帰る", "かえる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("それぞれ", "それぞれ", "それぞれ", "noun"),
          v("違う", "違う", "ちがう", "基本形"),
          n("道", "みち"),
          p("を"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "まま",
    calibration: [
      v("寝", "寝る", "ね", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("まま", "まま", "まま", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("目", "め"),
          p("を"),
          v("開け", "開ける", "あけ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("まま", "まま", "まま", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [4, 5],
        target: 4,
      },
      {
        pieces: [
          v("座っ", "座る", "すわっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("まま", "まま", "まま", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "しかない",
    calibration: [
      v("諦める", "諦める", "あきらめる", "基本形"),
      w("しか", "しか", "しか", "particle"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          v("行く", "行く", "いく", "基本形"),
          w("しか", "しか", "しか", "particle"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("待つ", "待つ", "まつ", "基本形"),
          w("しか", "しか", "しか", "particle"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "～ても～なくても",
    calibration: [
      v("行っ", "行く", "いっ", "連用タ接続"),
      p("て"),
      p("も"),
      v("行か", "行く", "いか", "未然形"),
      w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
      p("て"),
      p("も"),
      w("同じ", "同じ", "おなじ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 7],
    holdout: [
      {
        pieces: [
          v("食べ", "食べる", "たべ", "連用形"),
          p("て"),
          p("も"),
          v("食べ", "食べる", "たべ", "未然形"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          p("て"),
          p("も"),
          w("同じ", "同じ", "おなじ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 7],
        target: 1,
      },
      {
        pieces: [
          v("飲ん", "飲む", "のん", "連用タ接続"),
          p("で"),
          p("も"),
          v("飲ま", "飲む", "のま", "未然形"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          p("て"),
          p("も"),
          w("同じ", "同じ", "おなじ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 7],
        target: 1,
      },
    ],
  },
  {
    construction: "んじゃない",
    calibration: [
      v("行く", "行く", "いく", "基本形"),
      w("ん", "ん", "ん", "noun"),
      w("じゃ", "じゃ", "じゃ", "auxiliary"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("知ら", "知る", "しら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("ん", "ん", "ん", "noun"),
          w("じゃ", "じゃ", "じゃ", "auxiliary"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          v("できる", "できる", "できる", "基本形"),
          w("ん", "ん", "ん", "noun"),
          w("じゃ", "じゃ", "じゃ", "auxiliary"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "わけがない",
    calibration: [
      n("彼", "かれ"),
      p("が"),
      v("来る", "来る", "くる", "基本形"),
      w("わけ", "わけ", "わけ", "noun"),
      p("が"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [3, 6],
    holdout: [
      {
        pieces: [
          w("そんな", "そんな", "そんな", "adverb"),
          w("こと", "こと", "こと", "noun"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          w("わけ", "わけ", "わけ", "noun"),
          p("が"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [4, 7],
        target: 4,
      },
      {
        pieces: [
          w("一人", "一人", "ひとり", "noun"),
          p("で"),
          v("できる", "できる", "できる", "基本形"),
          w("わけ", "わけ", "わけ", "noun"),
          p("が"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "としたら / とすると",
    calibration: [
      n("雨", "あめ"),
      aux("だ", "だ", "だ", "基本形"),
      p("と"),
      v("し", "する", "し", "未然形"),
      w("たら", "たら", "たら", "auxiliary"),
      n("中止", "ちゅうし"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          n("台風", "たいふう"),
          aux("だ", "だ", "だ", "基本形"),
          p("と"),
          v("する", "する", "する", "基本形"),
          p("と"),
          n("休み", "やすみ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          n("雪", "ゆき"),
          aux("だ", "だ", "だ", "基本形"),
          p("と"),
          v("し", "する", "し", "未然形"),
          w("たら", "たら", "たら", "auxiliary"),
          n("休み", "やすみ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "として",
    calibration: [
      n("先生", "せんせい"),
      p("と"),
      v("し", "する", "し", "連用形"),
      p("て"),
      n("尊敬", "そんけい"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("友", "とも"),
          p("と"),
          v("し", "する", "し", "連用形"),
          p("て"),
          v("話す", "話す", "はなす", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("代表", "だいひょう"),
          p("と"),
          v("し", "する", "し", "連用形"),
          p("て"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "にしては",
    calibration: [
      n("年", "とし"),
      p("の"),
      w("わり", "わり", "わり", "noun"),
      p("に"),
      v("し", "する", "し", "連用形"),
      p("て"),
      p("は"),
      w("上手", "上手", "じょうず", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [4, 7],
    holdout: [
      {
        pieces: [
          n("子供", "こども"),
          p("に"),
          v("し", "する", "し", "連用形"),
          p("て"),
          p("は"),
          w("しっかり", "しっかり", "しっかり", "adverb"),
          v("し", "する", "し", "連用形"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          n("初心者", "しょしんしゃ"),
          p("に"),
          v("し", "する", "し", "連用形"),
          p("て"),
          p("は"),
          w("上手", "上手", "じょうず", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "にしても",
    calibration: [
      n("雨", "あめ"),
      p("に"),
      v("し", "する", "し", "連用形"),
      p("て"),
      p("も"),
      n("試合", "しあい"),
      p("は"),
      v("ある", "ある", "ある", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          n("風邪", "かぜ"),
          p("に"),
          v("し", "する", "し", "連用形"),
          p("て"),
          p("も"),
          n("学校", "がっこう"),
          p("に"),
          v("いく", "いく", "いく", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          adj("嫌い", "嫌い", "きらい", "noun"),
          p("に"),
          v("し", "する", "し", "連用形"),
          p("て"),
          p("も"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "にとって",
    calibration: [
      w("私", "私", "わたし", "noun"),
      p("に"),
      v("とっ", "とる", "とっ", "連用タ接続"),
      p("て"),
      w("大切", "大切", "たいせつ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("子供", "こども"),
          p("に"),
          v("とっ", "とる", "とっ", "連用タ接続"),
          p("て"),
          n("必要", "ひつよう"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("日本", "にほん"),
          p("に"),
          v("とっ", "とる", "とっ", "連用タ接続"),
          p("て"),
          w("大事", "大事", "だいじ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "というより",
    calibration: [
      v("疲れ", "疲れる", "つかれ", "連用形"),
      w("という", "という", "という", "particle"),
      w("より", "より", "より", "particle"),
      adj("眠い", "眠い", "ねむい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          adj("暑い", "暑い", "あつい", "基本形"),
          w("という", "という", "という", "particle"),
          w("より", "より", "より", "particle"),
          adj("熱い", "熱い", "あつい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          adj("悲しい", "悲しい", "かなしい", "基本形"),
          w("という", "という", "という", "particle"),
          w("より", "より", "より", "particle"),
          adj("悔しい", "悔しい", "くやしい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "はもちろん",
    calibration: [
      n("雨", "あめ"),
      p("は"),
      w("もちろん", "もちろん", "もちろん", "adverb"),
      n("風", "かぜ"),
      p("も"),
      adj("強い", "強い", "つよい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          n("彼", "かれ"),
          p("は"),
          w("もちろん", "もちろん", "もちろん", "adverb"),
          v("来る", "来る", "くる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("これ", "これ"),
          p("は"),
          w("もちろん", "もちろん", "もちろん", "adverb"),
          w("無料", "無料", "むりょう", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "て初めて",
    calibration: [
      n("一人暮らし", "ひとりぐらし"),
      p("を"),
      v("し", "する", "し", "連用形"),
      p("て"),
      w("初めて", "初めて", "はじめて", "adverb"),
      v("分かる", "分かる", "わかる", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("留学", "りゅうがく"),
          v("し", "する", "し", "連用形"),
          p("て"),
          w("初めて", "初めて", "はじめて", "adverb"),
          v("分かる", "分かる", "わかる", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("親", "おや"),
          p("に"),
          v("なっ", "なる", "なっ", "連用タ接続"),
          p("て"),
          w("初めて", "初めて", "はじめて", "adverb"),
          v("分かる", "分かる", "わかる", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
    ],
  },
  {
    construction: "さえ / さえ〜ば",
    calibration: [
      n("子供", "こども"),
      p("さえ"),
      v("分かる", "分かる", "わかる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          w("君", "君", "きみ", "noun"),
          p("さえ"),
          v("いれ", "いる", "いれ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("水", "みず"),
          p("さえ"),
          v("あれ", "ある", "あれ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "たものだ",
    calibration: [
      adj("若い", "若い", "わかい", "基本形"),
      n("頃", "ころ"),
      p("は"),
      w("よく", "よい", "よく", "adverb"),
      v("遊ん", "遊ぶ", "あそん", "連用タ接続"),
      w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
      w("もの", "もの", "もの", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [5, 8],
    holdout: [
      {
        pieces: [
          w("よく", "よい", "よく", "adverb"),
          v("走っ", "走る", "はしっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("もの", "もの", "もの", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          w("よく", "よい", "よく", "adverb"),
          v("泳い", "泳ぐ", "およい", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          w("もの", "もの", "もの", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "さて",
    calibration: [
      w("さて", "さて", "さて", "interjection"),
      v("始め", "始める", "はじめ", "未然形"),
      w("よう", "よう", "よう", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("さて", "さて", "さて", "interjection"),
          v("帰ろ", "帰る", "かえろ", "未然形"),
          w("う", "う", "う", "auxiliary"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("さて", "さて", "さて", "interjection"),
          v("寝", "寝る", "ね", "未然形"),
          w("よう", "よう", "よう", "auxiliary"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "むしろ",
    calibration: [
      w("むしろ", "むしろ", "むしろ", "adverb"),
      adj("安い", "安い", "やすい", "基本形"),
      w("ほう", "ほう", "ほう", "noun"),
      p("が"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("むしろ", "むしろ", "むしろ", "adverb"),
          adj("高い", "高い", "たかい", "基本形"),
          w("ほう", "ほう", "ほう", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("むしろ", "むしろ", "むしろ", "adverb"),
          w("静か", "静か", "しずか", "noun"),
          w("な", "な", "な", "auxiliary"),
          w("ほう", "ほう", "ほう", "noun"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "つまり",
    calibration: [
      w("つまり", "つまり", "つまり", "adverb"),
      w("そういう", "そういう", "そういう", "adverb"),
      w("こと", "こと", "こと", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("つまり", "つまり", "つまり", "adverb"),
          v("でき", "できる", "でき", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("わけ", "わけ", "わけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("つまり", "つまり", "つまり", "adverb"),
          w("無理", "無理", "むり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "かえって",
    calibration: [
      w("かえって", "かえって", "かえって", "adverb"),
      adj("難しく", "難しい", "むずかしく", "連用テ接続"),
      v("なっ", "なる", "なっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("かえって", "かえって", "かえって", "adverb"),
          w("よく", "よい", "よく", "adverb"),
          v("なっ", "なる", "なっ", "連用タ接続"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("かえって", "かえって", "かえって", "adverb"),
          w("静か", "静か", "しずか", "noun"),
          w("だっ", "だ", "だっ", "auxiliary", { conjugation: "連用タ接続" }),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜気がする",
    calibration: [
      w("嫌", "嫌", "いや", "noun"),
      w("な", "な", "な", "auxiliary"),
      n("気", "き"),
      p("が"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          w("変", "変", "へん", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("気", "き"),
          p("が"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          w("嫌", "嫌", "いや", "noun"),
          w("な", "な", "な", "auxiliary"),
          n("気", "き"),
          p("が"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "とても〜ない",
    calibration: [
      w("とても", "とても", "とても", "adverb"),
      adj("寒く", "寒い", "さむく", "連用テ接続"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("とても", "とても", "とても", "adverb"),
          v("信じ", "信じる", "しんじ", "未然形"),
          w("られ", "られる", "られ", "auxiliary"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 4],
        target: 0,
      },
      {
        pieces: [
          w("とても", "とても", "とても", "adverb"),
          v("でき", "できる", "でき", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "別に〜ない",
    calibration: [
      w("別に", "別に", "べつに", "adverb"),
      v("食べ", "食べる", "たべ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("別に", "別に", "べつに", "adverb"),
          adj("欲しく", "欲しい", "ほしく", "連用テ接続"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("べつに", "べつに", "べつに", "adverb"),
          v("困ら", "困る", "こまら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "じゃなくて",
    calibration: [
      n("肉", "にく"),
      w("じゃ", "じゃ", "じゃ", "auxiliary"),
      w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
      p("て"),
      n("魚", "さかな"),
      p("が"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("コーヒー", "こーひー"),
          w("じゃ", "じゃ", "じゃ", "auxiliary"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          p("て"),
          n("紅茶", "こうちゃ"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          w("今日", "今日", "きょう", "noun"),
          w("じゃ", "じゃ", "じゃ", "auxiliary"),
          w("なく", "ない", "なく", "auxiliary", { conjugation: "連用テ接続" }),
          p("て"),
          w("明日", "明日", "あした", "adverb"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "〜ようとしない",
    calibration: [
      v("食べ", "食べる", "たべ", "未然形"),
      w("よう", "よう", "よう", "auxiliary"),
      p("と"),
      v("し", "する", "し", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          v("起き", "起きる", "おき", "未然形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("と"),
          v("し", "する", "し", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          v("教え", "教える", "おしえ", "未然形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("と"),
          v("し", "する", "し", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "もしかしたら",
    calibration: [
      w("もしか", "もしか", "もしか", "adverb"),
      v("し", "する", "し", "未然形"),
      w("たら", "たら", "たら", "auxiliary"),
      n("雨", "あめ"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("もしか", "もしか", "もしか", "adverb"),
          v("し", "する", "し", "未然形"),
          w("たら", "たら", "たら", "auxiliary"),
          n("雪", "ゆき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("もしか", "もしか", "もしか", "adverb"),
          v("し", "する", "し", "未然形"),
          w("たら", "たら", "たら", "auxiliary"),
          n("彼", "かれ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "〜かというと",
    calibration: [
      adj("嫌い", "嫌い", "きらい", "noun"),
      p("か"),
      p("と"),
      v("いう", "いう", "いう", "基本形"),
      p("と"),
      w("そう", "そう", "そう", "adverb"),
      p("で"),
      p("も"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          v("できる", "できる", "できる", "基本形"),
          p("か"),
          p("と"),
          v("いう", "いう", "いう", "基本形"),
          p("と"),
          w("微妙", "微妙", "びみょう", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          v("行ける", "行ける", "いける", "基本形"),
          p("か"),
          p("と"),
          v("いう", "いう", "いう", "基本形"),
          p("と"),
          v("分から", "分かる", "わから", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "〜ずつ",
    calibration: [
      w("一", "一", "いち", "noun"),
      w("つ", "つ", "つ", "noun"),
      w("ずつ", "ずつ", "ずつ", "particle"),
      v("食べる", "食べる", "たべる", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          w("一", "一", "いち", "noun"),
          n("人", "ひと"),
          w("ずつ", "ずつ", "ずつ", "particle"),
          v("並ぶ", "並ぶ", "ならぶ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          w("少し", "少し", "すこし", "adverb"),
          w("ずつ", "ずつ", "ずつ", "particle"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "だらけ",
    calibration: [
      n("間違い", "まちがい"),
      w("だらけ", "だらけ", "だらけ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("ゴミ", "ごみ"),
          w("だらけ", "だらけ", "だらけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("借金", "しゃっきん"),
          w("だらけ", "だらけ", "だらけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜み",
    calibration: [
      w("楽しみ", "楽しみ", "たのしみ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("悲しみ", "悲しみ", "かなしみ", "noun"),
          p("が"),
          adj("深い", "深い", "ふかい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("痛み", "痛み", "いたみ", "noun"),
          p("が"),
          v("ある", "ある", "ある", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "〜と違って",
    calibration: [
      n("昨日", "きのう"),
      p("と"),
      v("違っ", "違う", "ちがっ", "連用タ接続"),
      p("て"),
      adj("寒い", "寒い", "さむい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("姉", "あね"),
          p("と"),
          v("違っ", "違う", "ちがっ", "連用タ接続"),
          p("て"),
          w("静か", "静か", "しずか", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("去年", "きょねん"),
          p("と"),
          v("違っ", "違う", "ちがっ", "連用タ接続"),
          p("て"),
          adj("暑い", "暑い", "あつい", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "に違いない",
    calibration: [
      n("彼", "かれ"),
      p("に"),
      w("違い", "違い", "ちがい", "noun"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("これ", "これ"),
          p("に"),
          w("違い", "違い", "ちがい", "noun"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("犯人", "はんにん"),
          p("は"),
          n("彼", "かれ"),
          p("に"),
          w("違い", "違い", "ちがい", "noun"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "に限る / とは限らない",
    calibration: [
      n("ビール", "びーる"),
      p("に"),
      v("限る", "限る", "かぎる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 3],
    holdout: [
      {
        pieces: [
          adj("安い", "安い", "やすい", "基本形"),
          w("もの", "もの", "もの", "noun"),
          p("に"),
          v("限る", "限る", "かぎる", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("誰", "誰", "だれ", "noun"),
          p("に"),
          p("で"),
          p("も"),
          v("できる", "できる", "できる", "基本形"),
          p("と"),
          p("は"),
          v("限ら", "限る", "かぎら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [5, 9],
        target: 5,
      },
    ],
  },
  {
    construction: "めったに〜ない",
    calibration: [
      w("めったに", "めったに", "めったに", "adverb"),
      v("怒ら", "怒る", "おこら", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          w("めったに", "めったに", "めったに", "adverb"),
          v("会わ", "会う", "あわ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
      {
        pieces: [
          w("めったに", "めったに", "めったに", "adverb"),
          v("泣か", "泣く", "なか", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 3],
        target: 0,
      },
    ],
  },
  {
    construction: "割に",
    calibration: [
      n("値段", "ねだん"),
      p("の"),
      w("割に", "割に", "わりに", "adverb"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("年", "とし"),
          p("の"),
          w("割に", "割に", "わりに", "adverb"),
          adj("若い", "若い", "わかい", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          adj("小さい", "小さい", "ちいさい", "基本形"),
          w("割に", "割に", "わりに", "adverb"),
          adj("高い", "高い", "たかい", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "Verb[volitional]とする",
    calibration: [
      v("行こ", "行く", "いこ", "未然形"),
      w("う", "う", "う", "auxiliary"),
      p("と"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("食べ", "食べる", "たべ", "未然形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("と"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("寝", "寝る", "ね", "未然形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("と"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "そうもない",
    calibration: [
      v("でき", "できる", "でき", "未然形"),
      w("そう", "そう", "そう", "auxiliary"),
      p("も"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("あり", "ある", "あり", "未然形"),
          w("そう", "そう", "そう", "auxiliary"),
          p("も"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("終わり", "おわり"),
          w("そう", "そう", "そう", "auxiliary"),
          p("も"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "ないことはない",
    calibration: [
      v("でき", "できる", "でき", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      w("こと", "こと", "こと", "noun"),
      p("は"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 5],
    holdout: [
      {
        pieces: [
          v("知ら", "知る", "しら", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("こと", "こと", "こと", "noun"),
          p("は"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
      {
        pieces: [
          v("行か", "行く", "いか", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("こと", "こと", "こと", "noun"),
          p("は"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 5],
        target: 1,
      },
    ],
  },
  {
    construction: "なんか・なんて",
    calibration: [
      w("なんか", "なんか", "なんか", "adverb"),
      w("変", "変", "へん", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("なんて", "なんて", "なんて", "adverb"),
          w("こと", "こと", "こと", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("なんか", "なんか", "なんか", "adverb"),
          v("疲れ", "疲れる", "つかれ", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "ついでに",
    calibration: [
      n("買い物", "かいもの"),
      p("の"),
      w("ついで", "ついで", "ついで", "noun"),
      p("に"),
      v("寄る", "寄る", "よる", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("散歩", "さんぽ"),
          p("の"),
          w("ついで", "ついで", "ついで", "noun"),
          p("に"),
          v("買う", "買う", "かう", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("仕事", "しごと"),
          p("の"),
          w("ついで", "ついで", "ついで", "noun"),
          p("に"),
          v("会う", "会う", "あう", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "たとたんに",
    calibration: [
      v("帰っ", "帰る", "かえっ", "連用タ接続"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      w("とたん", "とたん", "とたん", "noun"),
      p("に"),
      n("電話", "でんわ"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          v("出", "出る", "で", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("とたん", "とたん", "とたん", "noun"),
          p("に"),
          n("雨", "あめ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          v("寝", "寝る", "ね", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("とたん", "とたん", "とたん", "noun"),
          p("に"),
          n("地震", "じしん"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "おきに / たびに",
    calibration: [
      n("東京", "とうきょう"),
      p("に"),
      v("行く", "行く", "いく", "基本形"),
      w("たび", "たび", "たび", "noun"),
      p("に"),
      v("太る", "太る", "ふとる", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          v("会う", "会う", "あう", "基本形"),
          w("たび", "たび", "たび", "noun"),
          p("に"),
          adj("嬉しい", "嬉しい", "うれしい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          n("帰省", "きせい"),
          p("の"),
          w("たび", "たび", "たび", "noun"),
          p("に"),
          v("太る", "太る", "ふとる", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "なし / あり",
    calibration: [n("問題", "もんだい"), w("なし", "なし", "なし", "noun"), q("。")],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [n("味", "あじ"), w("なし", "なし", "なし", "noun"), q("。")],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [n("問題", "もんだい"), w("あり", "あり", "あり", "noun"), q("。")],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "考えられない",
    calibration: [
      v("考え", "考える", "かんがえ", "未然形"),
      w("られ", "られる", "られ", "auxiliary"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 3],
    holdout: [
      {
        pieces: [
          v("信じ", "信じる", "しんじ", "未然形"),
          w("られ", "られる", "られ", "auxiliary"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("なんて", "なんて", "なんて", "adverb"),
          v("考え", "考える", "かんがえ", "未然形"),
          w("られ", "られる", "られ", "auxiliary"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [4, 7],
        target: 4,
      },
      {
        pieces: [
          w("そんな", "そんな", "そんな", "adverb"),
          w("こと", "こと", "こと", "noun"),
          v("考え", "考える", "かんがえ", "未然形"),
          w("られ", "られる", "られ", "auxiliary"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "〜向き / 〜向け",
    calibration: [
      n("子供", "こども"),
      w("向き", "向き", "むき", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("初心者", "しょしんしゃ"),
          w("向け", "向け", "むけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("上級者", "じょうきゅうしゃ"),
          w("向き", "向き", "むき", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜切る / 〜きれない",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      v("きる", "きる", "きる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("使い", "使う", "つかい", "連用形"),
          v("きれ", "きれる", "きれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          v("読み", "読む", "よみ", "連用形"),
          v("きれ", "きれる", "きれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜きり",
    calibration: [
      w("これっきり", "これっきり", "これっきり", "adverb"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          v("締め", "締める", "しめ", "連用形"),
          w("切り", "切り", "きり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("君", "君", "きみ", "noun"),
          p("に"),
          w("限り", "限り", "かぎり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "〜かけ",
    calibration: [
      v("食べ", "食べる", "たべ", "連用形"),
      w("かけ", "かけ", "かけ", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("読み", "読む", "よみ", "連用形"),
          w("かけ", "かけ", "かけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("言い", "言う", "いい", "連用形"),
          w("かけ", "かけ", "かけ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜たて",
    calibration: [
      v("焼き", "焼く", "やき", "連用形"),
      w("たて", "たて", "たて", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("作り", "作る", "つくり", "連用形"),
          w("たて", "たて", "たて", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("炊き", "炊く", "たき", "連用形"),
          w("たて", "たて", "たて", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜込む",
    calibration: [
      v("飛び", "飛ぶ", "とび", "連用形"),
      v("込む", "込む", "こむ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("駆け", "駆ける", "かけ", "連用形"),
          v("込む", "込む", "こむ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("差し", "差す", "さし", "連用形"),
          v("込む", "込む", "こむ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "ふりをする",
    calibration: [
      v("知ら", "知る", "しら", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      w("ふり", "ふり", "ふり", "noun"),
      p("を"),
      v("する", "する", "する", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 5],
    holdout: [
      {
        pieces: [
          v("見", "見る", "み", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("ふり", "ふり", "ふり", "noun"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
      {
        pieces: [
          v("聞こえ", "聞こえる", "きこえ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          w("ふり", "ふり", "ふり", "noun"),
          p("を"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [2, 5],
        target: 2,
      },
    ],
  },
  {
    construction: "できれば (できたら)",
    calibration: [
      v("できれ", "できる", "できれ", "仮定形"),
      p("ば"),
      adj("嬉しい", "嬉しい", "うれしい", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 2],
    holdout: [
      {
        pieces: [
          w("できたら", "できたら", "できたら", "adverb"),
          n("電話", "でんわ"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("できれば", "できれば", "できれば", "adverb"),
          w("明日", "明日", "あした", "adverb"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "でよければ",
    calibration: [
      n("これ", "これ"),
      p("で"),
      v("よけれ", "よい", "よけれ", "仮定形"),
      p("ば"),
      adj("いい", "いい", "いい", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("これ", "これ"),
          p("で"),
          v("よけれ", "よい", "よけれ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          w("明日", "明日", "あした", "adverb"),
          p("で"),
          v("よけれ", "よい", "よけれ", "仮定形"),
          p("ば"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "とおり",
    calibration: [
      w("その", "その", "その", "adverb"),
      w("とおり", "とおり", "とおり", "noun"),
      p("に"),
      v("やる", "やる", "やる", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("言う", "言う", "いう", "基本形"),
          w("とおり", "とおり", "とおり", "noun"),
          p("に"),
          v("する", "する", "する", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("見", "見る", "み", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          w("とおり", "とおり", "とおり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "どうしても",
    calibration: [
      w("どうしても", "どうしても", "どうしても", "adverb"),
      v("分から", "分かる", "わから", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("どうしても", "どうしても", "どうしても", "adverb"),
          v("行き", "行く", "いき", "連用形"),
          w("たい", "たい", "たい", "auxiliary"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("どうしても", "どうしても", "どうしても", "adverb"),
          w("明日", "明日", "あした", "adverb"),
          p("が"),
          adj("いい", "いい", "いい", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "同士",
    calibration: [
      n("友達", "ともだち"),
      w("同士", "同士", "どうし", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("仲間", "なかま"),
          w("同士", "同士", "どうし", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("兄弟", "きょうだい"),
          w("同士", "同士", "どうし", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "まさか",
    calibration: [
      w("まさか", "まさか", "まさか", "adverb"),
      n("彼", "かれ"),
      p("が"),
      v("来る", "来る", "くる", "基本形"),
      w("なんて", "なんて", "なんて", "adverb"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("まさか", "まさか", "まさか", "adverb"),
          n("雪", "ゆき"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("まさか", "まさか", "まさか", "adverb"),
          n("合格", "ごうかく"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "つい",
    calibration: [
      w("つい", "つい", "つい", "adverb"),
      w("うっかり", "うっかり", "うっかり", "adverb"),
      v("忘れ", "忘れる", "わすれ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          v("食べ", "食べる", "たべ", "連用形"),
          p("て"),
          w("つい", "つい", "つい", "adverb"),
          v("寝", "寝る", "ね", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
      {
        pieces: [
          adj("いい", "いい", "いい", "基本形"),
          n("天気", "てんき"),
          p("で"),
          w("つい", "つい", "つい", "adverb"),
          v("出かけ", "出かける", "でかけ", "未然形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "せいで",
    calibration: [
      n("雨", "あめ"),
      p("の"),
      w("せい", "せい", "せい", "noun"),
      p("で"),
      v("遅れ", "遅れる", "おくれ", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          n("風邪", "かぜ"),
          p("の"),
          w("せい", "せい", "せい", "noun"),
          p("で"),
          v("休ん", "休む", "やすん", "連用タ接続"),
          w("だ", "だ", "だ", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          n("彼", "かれ"),
          p("の"),
          w("せい", "せい", "せい", "noun"),
          p("で"),
          n("失敗", "しっぱい"),
          v("し", "する", "し", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "くせに",
    calibration: [
      n("子供", "こども"),
      p("の"),
      w("くせ", "くせ", "くせ", "noun"),
      p("に"),
      w("偉そう", "偉そう", "えらそう", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          v("知っ", "知る", "しっ", "連用タ接続"),
          p("て"),
          w("いる", "いる", "いる", "auxiliary", { conjugation: "基本形" }),
          w("くせ", "くせ", "くせ", "noun"),
          p("に"),
          v("黙る", "黙る", "だまる", "基本形"),
          q("。"),
        ],
        range: [4, 6],
        target: 4,
      },
      {
        pieces: [
          adj("若い", "若い", "わかい", "基本形"),
          w("くせ", "くせ", "くせ", "noun"),
          p("に"),
          w("生意気", "生意気", "なまいき", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "〜がち / 〜ぎみ",
    calibration: [
      n("病気", "びょうき"),
      w("がち", "がち", "がち", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("風邪", "かぜ"),
          w("ぎみ", "ぎみ", "ぎみ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          n("遅刻", "ちこく"),
          w("がち", "がち", "がち", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜っぽい",
    calibration: [
      n("子供", "こども"),
      w("っぽい", "っぽい", "っぽい", "adjective"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("水", "みず"),
          w("っぽい", "っぽい", "っぽい", "adjective"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("忘れ", "忘れる", "わすれ", "連用形"),
          w("っぽい", "っぽい", "っぽい", "adjective"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "〜っぱなし",
    calibration: [
      v("開け", "開ける", "あけ", "連用形"),
      w("っぱなし", "っぱなし", "っぱなし", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          v("出し", "出す", "だし", "連用形"),
          w("っぱなし", "っぱなし", "っぱなし", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("つけ", "つける", "つけ", "連用形"),
          w("っぱなし", "っぱなし", "っぱなし", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
  {
    construction: "わざわざ",
    calibration: [
      w("わざわざ", "わざわざ", "わざわざ", "adverb"),
      v("来", "来る", "き", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("わざわざ", "わざわざ", "わざわざ", "adverb"),
          n("電話", "でんわ"),
          v("し", "する", "し", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("わざわざ", "わざわざ", "わざわざ", "adverb"),
          v("会い", "会う", "あい", "連用形"),
          p("に"),
          v("来", "来る", "き", "連用形"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "一体",
    calibration: [
      w("一体", "一体", "いったい", "adverb"),
      w("何", "何", "なに", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("一体", "一体", "いったい", "adverb"),
          w("誰", "誰", "だれ", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("一体", "一体", "いったい", "adverb"),
          w("どこ", "どこ", "どこ", "noun"),
          p("に"),
          v("いる", "いる", "いる", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "折角",
    calibration: [
      w("折角", "折角", "せっかく", "adverb"),
      v("来", "来る", "き", "連用形"),
      w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
      p("のに"),
      w("残念", "残念", "ざんねん", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [0, 1],
    holdout: [
      {
        pieces: [
          w("折角", "折角", "せっかく", "adverb"),
          p("の"),
          n("休み", "やすみ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
      {
        pieces: [
          w("せっかく", "せっかく", "せっかく", "adverb"),
          n("晴れ", "はれ"),
          w("た", "た", "た", "auxiliary", { conjugation: "基本形" }),
          p("のに"),
          n("雨", "あめ"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [0, 1],
        target: 0,
      },
    ],
  },
  {
    construction: "っけ",
    calibration: [
      w("あの", "あの", "あの", "adverb"),
      n("人", "ひと"),
      w("だっけ", "だっけ", "だっけ", "auxiliary"),
      q("。"),
    ],
    calibrationRange: [2, 3],
    holdout: [
      {
        pieces: [
          n("それ", "それ"),
          w("なんだっけ", "なんだっけ", "なんだっけ", "auxiliary"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          w("明日", "明日", "あした", "adverb"),
          p("は"),
          n("何曜日", "なんようび"),
          w("だっけ", "だっけ", "だっけ", "auxiliary"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
    ],
  },
  {
    construction: "代わりに",
    calibration: [
      n("薬", "くすり"),
      p("の"),
      w("代わり", "代わり", "かわり", "noun"),
      p("に"),
      v("休む", "休む", "やすむ", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          w("私", "私", "わたし", "noun"),
          p("の"),
          w("代わり", "代わり", "かわり", "noun"),
          p("に"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
      {
        pieces: [
          w("誰か", "誰か", "だれか", "noun"),
          p("の"),
          w("代わり", "代わり", "かわり", "noun"),
          p("に"),
          v("行く", "行く", "いく", "基本形"),
          q("。"),
        ],
        range: [2, 4],
        target: 2,
      },
    ],
  },
  {
    construction: "どころか",
    calibration: [
      n("冗談", "じょうだん"),
      w("どころか", "どころか", "どころか", "particle"),
      n("本気", "ほんき"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [1, 2],
    holdout: [
      {
        pieces: [
          n("休み", "やすみ"),
          w("どころか", "どころか", "どころか", "particle"),
          n("残業", "ざんぎょう"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
      {
        pieces: [
          v("褒め", "褒める", "ほめ", "未然形"),
          w("られる", "られる", "られる", "auxiliary"),
          w("どころか", "どころか", "どころか", "particle"),
          v("叱ら", "叱る", "しか", "未然形"),
          w("れた", "れる", "れた", "auxiliary"),
          q("。"),
        ],
        range: [2, 3],
        target: 2,
      },
    ],
  },
  {
    construction: "わけにはいかない",
    calibration: [
      v("休む", "休む", "やすむ", "基本形"),
      w("わけ", "わけ", "わけ", "noun"),
      p("に"),
      p("は"),
      v("いか", "いく", "いか", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 6],
    holdout: [
      {
        pieces: [
          v("サボる", "サボる", "さぼる", "基本形"),
          w("わけ", "わけ", "わけ", "noun"),
          p("に"),
          p("は"),
          v("いか", "いく", "いか", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 6],
        target: 1,
      },
      {
        pieces: [
          v("忘れる", "忘れる", "わすれる", "基本形"),
          w("わけ", "わけ", "わけ", "noun"),
          p("に"),
          p("は"),
          v("いか", "いく", "いか", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 6],
        target: 1,
      },
    ],
  },
  {
    construction: "つもりだ",
    calibration: [
      w("明日", "明日", "あした", "adverb"),
      p("は"),
      v("休む", "休む", "やすむ", "基本形"),
      w("つもり", "つもり", "つもり", "noun"),
      aux("だ", "だ", "だ", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 5],
    holdout: [
      {
        pieces: [
          n("週末", "しゅうまつ"),
          p("は"),
          v("出かける", "出かける", "でかける", "基本形"),
          w("つもり", "つもり", "つもり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [3, 5],
        target: 3,
      },
      {
        pieces: [
          w("来年", "来年", "らいねん", "noun"),
          p("は"),
          n("留学", "りゅうがく"),
          v("する", "する", "する", "基本形"),
          w("つもり", "つもり", "つもり", "noun"),
          aux("だ", "だ", "だ", "基本形"),
          q("。"),
        ],
        range: [4, 6],
        target: 4,
      },
    ],
  },
  {
    construction: "のに",
    calibration: [
      n("雨", "あめ"),
      w("な", "な", "な", "auxiliary"),
      p("の"),
      p("に"),
      v("出かける", "出かける", "でかける", "基本形"),
      q("。"),
    ],
    calibrationRange: [2, 4],
    holdout: [
      {
        pieces: [
          adj("安い", "安い", "やすい", "基本形"),
          p("の"),
          p("に"),
          adj("おいしい", "おいしい", "おいしい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
      {
        pieces: [
          adj("近い", "近い", "ちかい", "基本形"),
          p("の"),
          p("に"),
          adj("遠い", "遠い", "とおい", "基本形"),
          q("。"),
        ],
        range: [1, 3],
        target: 1,
      },
    ],
  },
  {
    construction: "かもしれない",
    calibration: [
      n("雨", "あめ"),
      w("かも", "かも", "かも", "adverb"),
      v("しれ", "しれる", "しれ", "未然形"),
      w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
      q("。"),
    ],
    calibrationRange: [1, 4],
    holdout: [
      {
        pieces: [
          n("台風", "たいふう"),
          w("かも", "かも", "かも", "adverb"),
          v("しれ", "しれる", "しれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
      {
        pieces: [
          n("雪", "ゆき"),
          w("かも", "かも", "かも", "adverb"),
          v("しれ", "しれる", "しれ", "未然形"),
          w("ない", "ない", "ない", "auxiliary", { conjugation: "基本形" }),
          q("。"),
        ],
        range: [1, 4],
        target: 1,
      },
    ],
  },
  {
    construction: "ようになる",
    calibration: [
      n("日本語", "にほんご"),
      p("が"),
      v("話せる", "話す", "はなせる", "可能形"),
      w("よう", "よう", "よう", "auxiliary"),
      p("に"),
      v("なる", "なる", "なる", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 6],
    holdout: [
      {
        pieces: [
          w("早く", "早い", "はやく", "adverb"),
          v("起き", "起きる", "おき", "未然形"),
          w("られ", "られる", "られ", "auxiliary"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
      {
        pieces: [
          n("漢字", "かんじ"),
          p("が"),
          v("読める", "読む", "よめる", "可能形"),
          w("よう", "よう", "よう", "auxiliary"),
          p("に"),
          v("なる", "なる", "なる", "基本形"),
          q("。"),
        ],
        range: [3, 6],
        target: 3,
      },
    ],
  },
  {
    construction: "ながら",
    calibration: [
      n("音楽", "おんがく"),
      p("を"),
      v("聞き", "聞く", "きき", "連用形"),
      w("ながら", "ながら", "ながら", "particle"),
      v("歩く", "歩く", "あるく", "基本形"),
      q("。"),
    ],
    calibrationRange: [3, 4],
    holdout: [
      {
        pieces: [
          n("テレビ", "てれび"),
          p("を"),
          v("見", "見る", "み", "連用形"),
          w("ながら", "ながら", "ながら", "particle"),
          v("食べる", "食べる", "たべる", "基本形"),
          q("。"),
        ],
        range: [3, 4],
        target: 3,
      },
      {
        pieces: [
          v("歩き", "歩く", "あるき", "連用形"),
          w("ながら", "ながら", "ながら", "particle"),
          v("話す", "話す", "はなす", "基本形"),
          q("。"),
        ],
        range: [1, 2],
        target: 1,
      },
    ],
  },
];

const calibrationPrefixes: readonly (readonly CuePiece[])[] = [
  [w("3", "3", "さん", "noun"), n("回", "かい"), q("、")],
  [w("ねえ", "ねえ", "ねえ", "interjection"), q("、")],
  [q("🎵"), "\n"],
  [n("ミナ", "みな", "unknown"), w("さん", "さん", "さん", "auxiliary"), q("、")],
];

const calibrationAnalyzableFixtures: readonly JapaneseCueFixture[] = patterns.flatMap(
  (pattern, patternIndex) =>
    calibrationPrefixes.map((prefix, variantIndex) => {
      const grammarOffset = prefix.filter((piece) => typeof piece !== "string").length;
      const pieces = [...prefix, ...pattern.calibration];
      const expectedText = pieces
        .map((piece) => (typeof piece === "string" ? piece : piece.surface))
        .join("");
      const rawText =
        variantIndex === 3
          ? expectedText.replace("ミナ", "ﾐﾅ")
          : expectedText.replace("3", "３");
      return cue({
        id: `cal-${String(patternIndex + 1).padStart(2, "0")}-${variantIndex + 1}`,
        split: "calibration",
        pieces,
        construction: pattern.construction,
        grammarTokenRange: [
          pattern.calibrationRange[0] + grammarOffset,
          pattern.calibrationRange[1] + grammarOffset,
        ],
        targetTokenIndex: pattern.calibrationRange[0] + grammarOffset,
        rawText,
        riskSlices: [
          "grammar",
          "inflection",
          ...(variantIndex === 2 ? ["astral", "multiline", "utf16-offset"] : []),
          ...(variantIndex === 3 ? ["normalization", "half-width", "name"] : []),
        ],
      });
    }),
);

export const calibrationFixtures: readonly JapaneseCueFixture[] = [
  ...calibrationAnalyzableFixtures,
  unsupportedCue(
    "cal-unsupported-01",
    "   \n",
    "Whitespace-only input must fail visibly rather than become trusted tokens.",
  ),
  unsupportedCue(
    "cal-unsupported-02",
    "\u0000",
    "A control-only cue is malformed language input and must fail visibly.",
  ),
];

export const holdoutFixtures: readonly JapaneseCueFixture[] = patterns.flatMap(
  (pattern, patternIndex) =>
    pattern.holdout.map((item, variantIndex) => {
      const prefix: readonly CuePiece[] =
        variantIndex === 0
          ? [
              w("1", "1", "いち", "noun"),
              n("回", "かい"),
              q("、"),
              n("私", "わたし"),
              p("は"),
            ]
          : patternIndex % 5 === 0
            ? [q("🎵"), "\n", w("実は", "実は", "じつは", "adverb"), q("、")]
            : [w("実は", "実は", "じつは", "adverb"), q("、")];
      const tokenOffset = prefix.filter((piece) => typeof piece !== "string").length;
      const pieces = [...prefix, ...item.pieces];
      const expectedText = pieces
        .map((piece) => (typeof piece === "string" ? piece : piece.surface))
        .join("");
      const rawText =
        variantIndex === 0 && patternIndex % 4 === 0
          ? expectedText.replace("1", "１")
          : expectedText;

      return cue({
        id: `hold-${String(patternIndex + 1).padStart(2, "0")}-${variantIndex + 1}`,
        split: "holdout",
        pieces,
        construction: pattern.construction,
        grammarTokenRange: [item.range[0] + tokenOffset, item.range[1] + tokenOffset],
        targetTokenIndex: item.target + tokenOffset,
        rawText,
        riskSlices: [
          "grammar",
          "inflection",
          ...(variantIndex === 1 ? ["ambiguity", "polysemy"] : []),
          ...(variantIndex === 0 ? ["numbers", "counters"] : []),
          ...(variantIndex === 0 && patternIndex % 4 === 0 ? ["normalization"] : []),
          ...(variantIndex === 1 && patternIndex % 5 === 0
            ? ["astral", "multiline", "utf16-offset"]
            : []),
        ],
        ...(variantIndex === 1
          ? {
              annotationNote:
                "The target has multiple plausible senses; every allowed sense remains explicit.",
            }
          : {}),
      });
    }),
);

export const japaneseFixtureCorpus: readonly JapaneseCueFixture[] = [
  ...calibrationFixtures,
  ...holdoutFixtures,
];
