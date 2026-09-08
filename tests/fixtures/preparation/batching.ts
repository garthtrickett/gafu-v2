import type {
  AnalyzedCue,
  CandidateEvidence,
} from "../../../src/preparation/batching-contracts.ts";
import { evidence } from "../../support/deterministic-batch-provider.ts";

const span = (sentence: string, surface: string) => {
  const start = sentence.indexOf(surface);
  return {
    start,
    end: start + surface.length,
    unit: "utf16-code-unit" as const,
    normalization: "nfkc-v1" as const,
  };
};

const vocabularyCue = (
  cueId: string,
  normalizedJapanese: string,
  surface: string,
  lemma: string,
  reading: string,
): AnalyzedCue => ({
  cueId,
  normalizedJapanese,
  tokens: [
    {
      surface,
      lemma,
      reading,
      partOfSpeech: ["名詞または動詞"],
      span: span(normalizedJapanese, surface),
    },
  ],
  grammarEvidence: [],
});

const grammarCue = (
  cueId: string,
  normalizedJapanese: string,
  surface: string,
  canonicalForm: string,
): AnalyzedCue => ({
  cueId,
  normalizedJapanese,
  tokens: [],
  grammarEvidence: [{ canonicalForm, spans: [span(normalizedJapanese, surface)] }],
});

export const batchingCues: readonly AnalyzedCue[] = [
  vocabularyCue("episode-1:001", "猫が寝ている。", "猫", "猫", "ねこ"),
  vocabularyCue("episode-1:002", "犬が走った。", "走っ", "走る", "はしる"),
  vocabularyCue("episode-1:003", "橋を渡った。", "橋", "橋", "はし"),
  grammarCue("episode-2:001", "本を読んでいる。", "でいる", "〜ている"),
  vocabularyCue("episode-2:002", "猫が起きた。", "猫", "猫", "ねこ"),
  grammarCue("episode-2:003", "雨かもしれない。", "かもしれない", "〜かもしれない"),
  vocabularyCue("episode-3:001", "水を飲んだ。", "飲ん", "飲む", "のむ"),
  vocabularyCue("episode-3:002", "音楽を聞いた。", "聞い", "聞く", "きく"),
  vocabularyCue("episode-3:003", "駅へ歩いた。", "歩い", "歩く", "あるく"),
  vocabularyCue("episode-4:001", "料理を作った。", "作っ", "作る", "つくる"),
  vocabularyCue("episode-4:002", "友達と話した。", "話し", "話す", "はなす"),
  vocabularyCue(
    "episode-4:003",
    "最終目標を見つけた。",
    "最終目標",
    "最終目標",
    "さいしゅうもくひょう",
  ),
];

const cue = (id: string): AnalyzedCue => {
  const found = batchingCues.find((item) => item.cueId === id);
  if (found === undefined) throw new Error(`fixture cue missing: ${id}`);
  return found;
};

const item = (
  id: string,
  surface: string,
  kind: CandidateEvidence["kind"],
  canonicalKey: string,
  ambiguity: readonly string[] = [],
): CandidateEvidence => {
  const found = cue(id);
  return evidence(id, found.normalizedJapanese, surface, kind, canonicalKey, ambiguity);
};

export const batchingCandidates: ReadonlyMap<string, readonly CandidateEvidence[]> =
  new Map([
    ["episode-1:001", [item("episode-1:001", "猫", "vocabulary", "猫:ねこ")]],
    ["episode-1:002", [item("episode-1:002", "走っ", "vocabulary", "走る:はしる")]],
    [
      "episode-1:003",
      [item("episode-1:003", "橋", "vocabulary", "橋:はし", ["端:はし", "箸:はし"])],
    ],
    ["episode-2:001", [item("episode-2:001", "でいる", "grammar", "〜ている")]],
    ["episode-2:002", [item("episode-2:002", "猫", "vocabulary", "猫:ねこ")]],
    [
      "episode-2:003",
      [item("episode-2:003", "かもしれない", "grammar", "〜かもしれない")],
    ],
    ["episode-3:001", [item("episode-3:001", "飲ん", "vocabulary", "飲む:のむ")]],
    ["episode-3:002", [item("episode-3:002", "聞い", "vocabulary", "聞く:きく")]],
    ["episode-3:003", [item("episode-3:003", "歩い", "vocabulary", "歩く:あるく")]],
    ["episode-4:001", [item("episode-4:001", "作っ", "vocabulary", "作る:つくる")]],
    ["episode-4:002", [item("episode-4:002", "話し", "vocabulary", "話す:はなす")]],
    [
      "episode-4:003",
      [
        item(
          "episode-4:003",
          "最終目標",
          "vocabulary",
          "最終目標:さいしゅうもくひょう",
        ),
      ],
    ],
  ]);
