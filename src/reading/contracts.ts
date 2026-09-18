import type { TextSpan } from "../analysis/contracts.ts";
import type { ReadingSegment } from "../learning-material/contracts.ts";

/**
 * A word a tale cannot be told without.
 *
 * 桃太郎 needs 桃 and 鬼 however carefully the rest is kept to what the
 * learner knows; that is the i+1 the tale itself asks for, as against the
 * i+1 a Card asks for. Carries its own gloss so a reader can be told what a
 * word means where they meet it, with no lookup.
 */
export type TaleWord = Readonly<{
  lemma: string;
  reading: string;
  partOfSpeech: string;
  meaning: string;
}>;

/**
 * One step of a tale, and the one new word its sentence may use.
 *
 * A beat with no word is an i sentence: every content word in it is already
 * known, so it reads without effort and carries the story between the
 * sentences that teach. A beat with a word is i+1.
 */
export type TaleBeat = Readonly<{
  beat: string;
  word: TaleWord | null;
}>;

/**
 * A traditional tale, told as beats rather than as text.
 *
 * What is stored is the plot, in English, not a Japanese retelling: the
 * Japanese is written fresh for each reader against the words that reader
 * knows, which is the whole point. Two learners reading 桃太郎 get different
 * sentences, and neither gets a published translation.
 */
export type Tale = Readonly<{
  id: string;
  title: string;
  titleReading: string;
  titleEnglish: string;
  /** Where the tale comes from, for the reader who wants to go and find it. */
  provenance: string;
  beats: readonly TaleBeat[];
}>;

export type ReadingSentence = Readonly<{
  index: number;
  japanese: string;
  /** Written form and reading per run, for furigana over the kanji only. */
  segments: readonly ReadingSegment[];
  /** What the sentence says, for a reader who wants to check. */
  english: string;
  /** The new word, and where it sits, or null for a sentence of known words. */
  word: TaleWord | null;
  wordSpan: TextSpan | null;
  audioUrl: string | null;
}>;

export type Reading = Readonly<{
  taleId: string;
  title: string;
  titleReading: string;
  titleEnglish: string;
  provenance: string;
  generatedAt: string;
  sentences: readonly ReadingSentence[];
}>;

export type ReadingFailure =
  | { readonly kind: "taleNotFound"; readonly taleId: string }
  | { readonly kind: "readingNotFound"; readonly taleId: string }
  | { readonly kind: "providerCannotRead" }
  | {
      readonly kind: "beatRefused";
      readonly index: number;
      readonly reasons: readonly string[];
    }
  | { readonly kind: "readFailed"; readonly detail: string }
  | { readonly kind: "writeFailed"; readonly detail: string };
