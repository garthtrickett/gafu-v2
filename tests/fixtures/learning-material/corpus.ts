export type PresentationBase = Readonly<{
  id: string;
  cardType: "vocabulary" | "grammar";
  japanese: string;
  targetSurface: string;
  grammarForm: string | null;
}>;

export type InvalidFault =
  | "malformedStructure"
  | "readingMismatch"
  | "invalidSpan"
  | "surfaceMismatch"
  | "targetAbsent"
  | "targetOnlyMetadata"
  | "wrongIdentity"
  | "repeatedMisleading"
  | "oneUnknownVocabulary"
  | "severalUnknownVocabulary"
  | "unknownInflectedLookalike"
  | "knownFormWrongSense"
  | "oneUnknownGrammar"
  | "severalUnknownGrammar"
  | "degradedOrAmbiguous";

const vocabularySeeds: readonly PresentationBase[] = [
  {
    id: "vocab-eat",
    cardType: "vocabulary",
    japanese: "犬が魚を食べている。",
    targetSurface: "食べ",
    grammarForm: null,
  },
  {
    id: "vocab-read",
    cardType: "vocabulary",
    japanese: "私は本を読んだ。",
    targetSurface: "読ん",
    grammarForm: null,
  },
  {
    id: "vocab-drink",
    cardType: "vocabulary",
    japanese: "父は水を飲みます。",
    targetSurface: "飲み",
    grammarForm: null,
  },
  {
    id: "vocab-walk",
    cardType: "vocabulary",
    japanese: "友達が道を歩いている。",
    targetSurface: "歩い",
    grammarForm: null,
  },
  {
    id: "vocab-write",
    cardType: "vocabulary",
    japanese: "姉が手紙を書いた。",
    targetSurface: "書い",
    grammarForm: null,
  },
  {
    id: "vocab-speak",
    cardType: "vocabulary",
    japanese: "先生は日本語で話します。",
    targetSurface: "話し",
    grammarForm: null,
  },
  {
    id: "vocab-listen",
    cardType: "vocabulary",
    japanese: "弟が音楽を聞いている。",
    targetSurface: "聞い",
    grammarForm: null,
  },
  {
    id: "vocab-see",
    cardType: "vocabulary",
    japanese: "猫が窓から外を見ている。",
    targetSurface: "見",
    grammarForm: null,
  },
  {
    id: "vocab-buy",
    cardType: "vocabulary",
    japanese: "母は駅で切符を買った。",
    targetSurface: "買っ",
    grammarForm: null,
  },
  {
    id: "vocab-play",
    cardType: "vocabulary",
    japanese: "子供たちが公園で遊んでいる。",
    targetSurface: "遊ん",
    grammarForm: null,
  },
];

const grammarSeeds: readonly PresentationBase[] = [
  {
    id: "grammar-progressive",
    cardType: "grammar",
    japanese: "犬が庭で遊んでいる。",
    targetSurface: "でいる",
    grammarForm: "〜ている",
  },
  {
    id: "grammar-permission",
    cardType: "grammar",
    japanese: "ここで写真を撮ってもいい。",
    targetSurface: "てもいい",
    grammarForm: "〜てもいい",
  },
  {
    id: "grammar-experience",
    cardType: "grammar",
    japanese: "私は大阪へ行ったことがある。",
    targetSurface: "たことがある",
    grammarForm: "〜たことがある",
  },
  {
    id: "grammar-simultaneous",
    cardType: "grammar",
    japanese: "音楽を聞きながら歩く。",
    targetSurface: "ながら",
    grammarForm: "〜ながら",
  },
  {
    id: "grammar-obligation",
    cardType: "grammar",
    japanese: "薬を飲まなければならない。",
    targetSurface: "なければならない",
    grammarForm: "〜なければならない",
  },
  {
    id: "grammar-prohibition",
    cardType: "grammar",
    japanese: "ここで泳いではいけない。",
    targetSurface: "ではいけない",
    grammarForm: "〜てはいけない",
  },
  {
    id: "grammar-possibility",
    cardType: "grammar",
    japanese: "明日は雨が降るかもしれない。",
    targetSurface: "かもしれない",
    grammarForm: "〜かもしれない",
  },
  {
    id: "grammar-reason",
    cardType: "grammar",
    japanese: "静かなのでよく眠れる。",
    targetSurface: "ので",
    grammarForm: "〜ので",
  },
  {
    id: "grammar-contrast",
    cardType: "grammar",
    japanese: "勉強したのに忘れた。",
    targetSurface: "のに",
    grammarForm: "〜のに",
  },
  {
    id: "grammar-before",
    cardType: "grammar",
    japanese: "寝る前に歯を磨く。",
    targetSurface: "前に",
    grammarForm: "〜前に",
  },
];

const presentationVariants = (seed: PresentationBase): readonly PresentationBase[] => {
  const stem = seed.japanese.endsWith("。")
    ? seed.japanese.slice(0, -1)
    : seed.japanese;
  return [
    { ...seed, id: `${seed.id}-plain` },
    { ...seed, id: `${seed.id}-today`, japanese: `今日は、${seed.japanese}` },
    { ...seed, id: `${seed.id}-certainly`, japanese: `たしか、${seed.japanese}` },
    { ...seed, id: `${seed.id}-dialogue`, japanese: `${stem}ね。` },
  ];
};

export const vocabularyBases: readonly PresentationBase[] =
  vocabularySeeds.flatMap(presentationVariants);

export const grammarBases: readonly PresentationBase[] =
  grammarSeeds.flatMap(presentationVariants);

export const invalidFaults: readonly InvalidFault[] = [
  "malformedStructure",
  "readingMismatch",
  "invalidSpan",
  "surfaceMismatch",
  "targetAbsent",
  "targetOnlyMetadata",
  "wrongIdentity",
  "repeatedMisleading",
  "oneUnknownVocabulary",
  "severalUnknownVocabulary",
  "unknownInflectedLookalike",
  "knownFormWrongSense",
  "oneUnknownGrammar",
  "severalUnknownGrammar",
  "degradedOrAmbiguous",
];

export const adversarialManifest = {
  validVocabulary: vocabularyBases.map((base) => base.id),
  validGrammar: grammarBases.map((base) => base.id),
  invalidVocabulary: invalidFaults.flatMap((fault) =>
    vocabularyBases.map((base) => `${base.id}-${fault}`),
  ),
  invalidGrammar: invalidFaults.flatMap((fault) =>
    grammarBases.map((base) => `${base.id}-${fault}`),
  ),
} as const;
