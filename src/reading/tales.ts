import type { Tale, TaleWord } from "./contracts.ts";

/**
 * The tales, as plot rather than as prose.
 *
 * These are traditional oral tales, centuries old and belonging to nobody;
 * what is stored here is the sequence of events in plain English, written
 * for a generator to render. No Japanese text is kept, and none is quoted:
 * the sentences a reader gets are written fresh against the words that
 * reader knows, so two learners reading 桃太郎 read different Japanese and
 * neither reads anyone's translation.
 *
 * Beats are deliberately spare. A beat that demanded particular words would
 * fight the one rule that matters — every word but the beat's own is one the
 * learner already has — so each says what happens and leaves the wording to
 * the generator, which has the learner's vocabulary in front of it.
 */
const word = (
  lemma: string,
  reading: string,
  partOfSpeech: string,
  meaning: string,
): TaleWord => ({ lemma, reading, partOfSpeech, meaning });

export const tales: readonly Tale[] = [
  {
    id: "momotaro",
    title: "桃太郎",
    titleReading: "ももたろう",
    titleEnglish: "Peach Boy",
    provenance: "Traditional; one of the five tales every Japanese child is told.",
    beats: [
      {
        beat: "An old man and an old woman live together. They have no children.",
        word: null,
      },
      {
        beat: "The old woman goes to the river to do the washing.",
        word: word("洗濯", "せんたく", "noun", "washing; laundry"),
      },
      {
        beat: "A very large peach comes floating down the river towards her.",
        word: word("桃", "もも", "noun", "peach"),
      },
      {
        beat: "She carries it home. When they try to cut it open, a boy is inside.",
        word: null,
      },
      {
        beat: "They name him after the fruit and raise him. He grows strong.",
        word: null,
      },
      {
        beat: "He hears that ogres are taking things from the village, and says he will go and deal with them.",
        word: word("鬼", "おに", "noun", "ogre; demon"),
      },
      {
        beat: "The old woman makes him food to take. On the road a dog, a monkey and a bird each ask for some and join him.",
        word: null,
      },
      {
        beat: "The three animals become his followers and go with him.",
        word: word("家来", "けらい", "noun", "retainer; follower"),
      },
      {
        beat: "They cross the sea to the island where the ogres live.",
        word: word("島", "しま", "noun", "island"),
      },
      {
        beat: "They fight the ogres and win. The ogres give back what they took.",
        word: word(
          "退治",
          "たいじ",
          "noun",
          "putting down; ridding a place of something",
        ),
      },
      {
        beat: "He brings the treasure home, and the three of them live comfortably.",
        word: word("宝", "たから", "noun", "treasure"),
      },
    ],
  },
  {
    id: "urashima",
    title: "浦島太郎",
    titleReading: "うらしまたろう",
    titleEnglish: "Urashima Tarō",
    provenance:
      "Traditional; among the oldest, with versions in the 8th-century records.",
    beats: [
      {
        beat: "A young man lives by the sea and catches fish for a living.",
        word: word("漁師", "りょうし", "noun", "fisherman"),
      },
      {
        beat: "On the beach he finds children being cruel to a turtle.",
        word: word("亀", "かめ", "noun", "turtle"),
      },
      { beat: "He pays them to let it go, and puts it back in the sea.", word: null },
      {
        beat: "Days later the turtle returns and says it will carry him under the sea to thank him.",
        word: null,
      },
      {
        beat: "They arrive at a palace beneath the water, where a princess welcomes him.",
        word: word(
          "竜宮城",
          "りゅうぐうじょう",
          "noun",
          "the dragon palace under the sea",
        ),
      },
      {
        beat: "He stays and is happy there. Time passes without him noticing.",
        word: null,
      },
      {
        beat: "He grows homesick and says he wants to see his mother and father.",
        word: null,
      },
      {
        beat: "The princess gives him a box, and tells him he must never open it.",
        word: word(
          "玉手箱",
          "たまてばこ",
          "noun",
          "the jewelled box he is told not to open",
        ),
      },
      {
        beat: "Back on the shore, nothing is as he left it. Nobody knows his name.",
        word: null,
      },
      {
        beat: "He learns that hundreds of years have gone by while he was away.",
        word: null,
      },
      {
        beat: "In his grief he opens the box. Smoke rises out of it, and he becomes an old man.",
        word: word("煙", "けむり", "noun", "smoke"),
      },
    ],
  },
  {
    id: "kasajizo",
    title: "笠地蔵",
    titleReading: "かさじぞう",
    titleEnglish: "The Straw Hats for the Jizō Statues",
    provenance: "Traditional; a New Year tale told across Japan.",
    beats: [
      {
        beat: "An old man and his wife are very poor. They have almost nothing.",
        word: null,
      },
      {
        beat: "He makes woven hats by hand to sell.",
        word: word("笠", "かさ", "noun", "woven hat, of the old broad kind"),
      },
      {
        beat: "It is the day before New Year, so he walks to town to sell them.",
        word: word("正月", "しょうがつ", "noun", "the New Year"),
      },
      {
        beat: "Nobody buys any. He starts the long walk home with all of them.",
        word: null,
      },
      {
        beat: "Snow is falling hard. By the road stand six stone statues, bare in the cold.",
        word: word(
          "地蔵",
          "じぞう",
          "noun",
          "Jizō, a stone statue that stands by roads",
        ),
      },
      {
        beat: "He puts a hat on each of them. There are six statues and five hats.",
        word: null,
      },
      {
        beat: "He takes off his own and puts it on the last one, then walks home cold.",
        word: null,
      },
      {
        beat: "He tells his wife what he did. She says he did the right thing.",
        word: null,
      },
      {
        beat: "In the night something heavy is set down outside their door.",
        word: null,
      },
      {
        beat: "In the morning there is food and money enough for the New Year, and six sets of footprints in the snow.",
        word: null,
      },
      {
        beat: "They understand it as thanks returned for a kindness.",
        word: word("恩", "おん", "noun", "a kindness owed and returned"),
      },
    ],
  },
  {
    id: "tsuru",
    title: "鶴の恩返し",
    titleReading: "つるのおんがえし",
    titleEnglish: "The Crane's Return of a Kindness",
    provenance: "Traditional; one of the animal-wife tales.",
    beats: [
      {
        beat: "A poor man finds a bird caught by the leg and in pain.",
        word: word("罠", "わな", "noun", "trap; snare"),
      },
      {
        beat: "The bird is a crane. He frees it and it flies away.",
        word: word("鶴", "つる", "noun", "crane"),
      },
      {
        beat: "That winter a young woman comes to his door out of the snow and asks to stay.",
        word: null,
      },
      { beat: "They marry. She is quiet and kind and he is happy.", word: null },
      {
        beat: "She says she will make cloth to sell, but he must not watch her working.",
        word: word("織る", "おる", "verb", "to weave"),
      },
      {
        beat: "She shuts herself in the room for three days.",
        word: word("障子", "しょうじ", "noun", "paper sliding door"),
      },
      {
        beat: "What she brings out is finer than anything he has seen, and sells for a great deal.",
        word: word("反物", "たんもの", "noun", "a bolt of woven cloth"),
      },
      {
        beat: "He asks her to make more, and then more again. She grows thin.",
        word: null,
      },
      { beat: "He cannot bear not knowing, and looks through the door.", word: null },
      {
        beat: "Inside is the crane, pulling out its own feathers to make the cloth.",
        word: null,
      },
      {
        beat: "Seen, she cannot stay. She becomes a crane again and flies away, and he is alone.",
        word: null,
      },
    ],
  },
] as const;

export const taleById = (id: string): Tale | null =>
  tales.find((tale) => tale.id === id) ?? null;

/** Every word the tales can introduce, for the page to show before reading. */
export const taleWords = (tale: Tale): readonly TaleWord[] =>
  tale.beats.flatMap((beat) => (beat.word === null ? [] : [beat.word]));
