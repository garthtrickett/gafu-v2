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
        beat: "An old man and an old woman lived in a small village long ago.",
        word: null,
      },
      { beat: "Their house was small and the roof was old.", word: null },
      { beat: "They had no children.", word: null },
      { beat: "They had wanted a child for many years.", word: null },
      { beat: "Every morning the old man went up into the hills.", word: null },
      { beat: "He cut wood there and carried it home on his back.", word: null },
      { beat: "Every morning the old woman went down to the river.", word: null },
      {
        beat: "She washed the clothes there in the cold water.",
        word: word("洗濯", "せんたく", "noun", "washing; laundry"),
      },
      { beat: "They had very little, but they were kind to each other.", word: null },
      { beat: "One morning the old man left the house first.", word: null },
      {
        beat: "The old woman took the clothes and walked down to the river.",
        word: null,
      },
      { beat: "The water was clear and very cold.", word: null },
      { beat: "She knelt on the stones and began to wash.", word: null },
      { beat: "After a while she heard a sound from up the river.", word: null },
      { beat: "Something large was coming down towards her on the water.", word: null },
      { beat: "It was round, and it was pink.", word: null },
      {
        beat: "It was a peach, and it was bigger than her head.",
        word: word("桃", "もも", "noun", "peach"),
      },
      { beat: "She had never seen a peach anywhere near that size.", word: null },
      { beat: "She reached out and pulled it in to the bank.", word: null },
      { beat: "It was so heavy she could hardly lift it.", word: null },
      { beat: "She left the clothes where they were and carried it home.", word: null },
      { beat: "She put it on the floor and waited for the old man.", word: null },
      { beat: "In the evening he came down from the hills.", word: null },
      { beat: "She showed him the peach and he could not believe it.", word: null },
      { beat: "They were both hungry, so they decided to eat it.", word: null },
      { beat: "The old man went and got a knife.", word: null },
      { beat: "As he lifted the knife, the peach moved.", word: null },
      { beat: "Then it opened by itself, from the top.", word: null },
      { beat: "A small boy was sitting inside it.", word: null },
      { beat: "The boy looked at them and laughed.", word: null },
      { beat: "The old woman began to cry.", word: null },
      { beat: "She told him they had wanted a child for years and years.", word: null },
      { beat: "The boy said he had been sent to be their son.", word: null },
      { beat: "They named him after the peach he came out of.", word: null },
      { beat: "They gave him rice and a place to sleep.", word: null },
      { beat: "He ate more than either of them.", word: null },
      { beat: "He grew faster than any child in the village.", word: null },
      { beat: "By the time he was ten he was taller than the old man.", word: null },
      { beat: "He could carry more wood than anyone.", word: null },
      { beat: "He was kind, and everyone in the village liked him.", word: null },
      {
        beat: "One day a man came running down the road into the village.",
        word: null,
      },
      { beat: "He was out of breath and he was frightened.", word: null },
      {
        beat: "He said the ogres had come again.",
        word: word("鬼", "おに", "noun", "ogre; demon"),
      },
      {
        beat: "The ogres lived far out at sea, on an island.",
        word: word("島", "しま", "noun", "island"),
      },
      { beat: "They came in boats, and they took rice and money.", word: null },
      {
        beat: "They took whatever they wanted and nobody could stop them.",
        word: null,
      },
      { beat: "Some of them were as tall as two men.", word: null },
      { beat: "The villagers were afraid to go outside.", word: null },
      { beat: "The boy listened to all of it without saying anything.", word: null },
      { beat: "Then he went home and stood in front of the old couple.", word: null },
      {
        beat: "He said he would go to the island and put an end to it.",
        word: word(
          "退治",
          "たいじ",
          "noun",
          "putting down; ridding a place of something",
        ),
      },
      { beat: "The old woman said he was too young.", word: null },
      {
        beat: "The old man looked at him for a long time and said he was strong enough.",
        word: null,
      },
      { beat: "The old woman made dumplings for him to take.", word: null },
      { beat: "She said they were the best dumplings in Japan.", word: null },
      { beat: "She wrapped them in a cloth and tied it.", word: null },
      { beat: "The old man gave him a sword and a hat.", word: null },
      {
        beat: "The two of them walked with him to the edge of the village.",
        word: null,
      },
      { beat: "They told him to come home safely.", word: null },
      { beat: "He promised that he would.", word: null },
      { beat: "Then he went off down the road by himself.", word: null },
      { beat: "The road ran a long way between the fields.", word: null },
      { beat: "After some time a dog came out of the long grass.", word: null },
      { beat: "The dog asked him where he was going.", word: null },
      { beat: "He said he was going to the ogres' island.", word: null },
      { beat: "The dog asked for one of the dumplings.", word: null },
      { beat: "The boy untied the cloth and gave him one.", word: null },
      { beat: "The dog ate it in one bite.", word: null },
      { beat: "Then the dog said he would come along too.", word: null },
      {
        beat: "So the two of them walked on together.",
        word: word("家来", "けらい", "noun", "retainer; follower"),
      },
      { beat: "The dog walked at his side and kept watch.", word: null },
      {
        beat: "Later a monkey came down out of a tree.",
        word: word("猿", "さる", "noun", "monkey"),
      },
      { beat: "The monkey asked him the same question.", word: null },
      { beat: "The boy told him where he was going and why.", word: null },
      { beat: "The monkey asked for a dumpling as well.", word: null },
      { beat: "The boy gave him one.", word: null },
      { beat: "The monkey said he would come, and climbed down.", word: null },
      { beat: "Now there were three of them on the road.", word: null },
      { beat: "Near the sea a bird flew down in front of them.", word: null },
      { beat: "It was a pheasant, with a long tail.", word: null },
      { beat: "The bird asked to go with them.", word: null },
      { beat: "The boy gave it the last dumpling but one.", word: null },
      { beat: "The bird ate it and flew up over their heads.", word: null },
      { beat: "Now there were four.", word: null },
      { beat: "Together they came out onto the shore.", word: null },
      { beat: "The sea was grey and the wind was strong.", word: null },
      { beat: "They found an old boat pulled up on the sand.", word: null },
      { beat: "They pushed it down into the water and climbed in.", word: null },
      { beat: "The boy rowed, and the dog sat at the front.", word: null },
      { beat: "The waves were high and the boat went slowly.", word: null },
      { beat: "For a long time they could see no land at all.", word: null },
      { beat: "Then the island came up out of the sea ahead of them.", word: null },
      { beat: "There was a castle on it, with a wall and a great gate.", word: null },
      { beat: "They pulled the boat up and walked to the gate.", word: null },
      { beat: "The gate was shut and barred from the inside.", word: null },
      { beat: "The bird flew up over the wall.", word: null },
      { beat: "It went at the ogres' eyes with its beak.", word: null },
      { beat: "While they were shouting, the monkey climbed the wall.", word: null },
      { beat: "The monkey pulled the bar back and the gate came open.", word: null },
      { beat: "The dog ran in first and took hold of them.", word: null },
      { beat: "The boy came through the gate with his sword in his hand.", word: null },
      { beat: "The ogres were big, but they were slow and clumsy.", word: null },
      { beat: "One after another they gave up and sat down.", word: null },
      { beat: "At last the chief of the ogres came out.", word: null },
      { beat: "He knelt down on the stones in front of the boy.", word: null },
      {
        beat: "He said he was sorry, and that they would never come again.",
        word: null,
      },
      {
        beat: "Then he brought out everything the ogres had taken.",
        word: word("宝", "たから", "noun", "treasure"),
      },
      { beat: "There was rice, and cloth, and gold.", word: null },
      { beat: "They carried it all down to the boat.", word: null },
      { beat: "The boat sat low in the water on the way back.", word: null },
      { beat: "The villagers were standing on the shore, waiting.", word: null },
      { beat: "When they saw the boat they began to cheer.", word: null },
      {
        beat: "The boy gave the rice and the money back to the people it belonged to.",
        word: null,
      },
      { beat: "Then he walked home up the road.", word: null },
      { beat: "The old man and the old woman were waiting at the door.", word: null },
      { beat: "They lived comfortably after that, all three of them.", word: null },
      { beat: "And the dog, the monkey and the bird stayed with them.", word: null },
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
