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
