import type { BroadPartOfSpeech, JapaneseAnalyzer } from "../analysis/contracts.ts";
import {
  classifyKnownVocabulary,
  type KnownVocabularyEntry,
} from "../analysis/known-vocabulary.ts";
import { normalizeJapanese, textSpan } from "../analysis/normalization.ts";
import type { ReadingSegment } from "../learning-material/contracts.ts";
import { parseBroadPartOfSpeech } from "../learning-material/generated-decode.ts";
import { isTargetToken, normalizeReading } from "../learning-material/validator.ts";
import { err, ok, type Result } from "../result.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import { readingFits } from "../study/furigana.ts";
import type {
  Reading,
  ReadingFailure,
  ReadingSentence,
  Tale,
  TaleBeat,
  TaleWord,
} from "./contracts.ts";

/** What a provider is asked for: one sentence of a tale, told in known words. */
export type ReadingBeatRequest = Readonly<{
  titleEnglish: string;
  beat: string;
  /** Japanese already written, so the sentence continues rather than restarts. */
  preceding: readonly string[];
  /** The one word this sentence may introduce, or null for all-known words. */
  target: TaleWord | null;
  knowledge: KnowledgeSnapshot;
  /** Words this tale has already taught, which may be used freely. */
  introduced: readonly TaleWord[];
  /** Why the last attempt was refused, so the next one can avoid it. */
  rejections: readonly string[];
}>;

export type ReadingBeatDraft = Readonly<{
  japanese: string;
  english: string;
  segments: readonly ReadingSegment[];
}>;

export type ReadingProvider = Readonly<{
  write: (
    request: ReadingBeatRequest,
    signal?: AbortSignal,
  ) => Promise<Result<ReadingBeatDraft, { kind: string; detail: string }>>;
}>;

/**
 * The learner's vocabulary in the shape the classifier wants.
 *
 * A word earned through review is known in the one sense its Card claims; a
 * baseline word is known outright. That distinction is the reason a sentence
 * may lean on 猫 the animal without being allowed 猫 the figurative sense.
 */
const knownBank = (knowledge: KnowledgeSnapshot): readonly KnownVocabularyEntry[] =>
  knowledge.vocabulary.flatMap((entry): readonly KnownVocabularyEntry[] => {
    const part =
      entry.partOfSpeech === null ? null : parseBroadPartOfSpeech(entry.partOfSpeech);
    if (part === null) return [];
    const base = {
      lemma: normalizeJapanese(entry.lemma),
      reading: normalizeReading(entry.reading),
      partOfSpeech: part,
    };
    if (entry.source !== "card") {
      return [{ ...base, scope: { kind: "allSenses" as const } }];
    }
    // A Card that claims particular senses is known in those senses only, so
    // 猫 the animal does not license 猫 the figurative use. A Card claiming
    // none — anything created by hand or imported without a dictionary
    // identity — is known outright: the learner has the Card, and there is
    // no sense here to narrow it to. Refusing it instead would make every
    // such Card useless as support, which is the opposite of earning it.
    return entry.senseIds.length === 0
      ? [{ ...base, scope: { kind: "allSenses" as const } }]
      : entry.senseIds.map((senseId) => ({
          ...base,
          scope: { kind: "oneSense" as const, senseId },
        }));
  });

export type ReadingDependencies = Readonly<{
  analyzer: JapaneseAnalyzer;
  provider: ReadingProvider;
  transparentPartOfSpeech: ReadonlySet<BroadPartOfSpeech>;
}>;

/**
 * Checks a drafted sentence is what a reading needs: the tale's one new word
 * if it was asked for, and nothing else the learner has not met.
 *
 * This is the i+1 rule applied to prose rather than to a Card, so it reuses
 * the same parts — the analyser, the known-word classifier, and the rule
 * that a target is itself in every form it takes. What it does not reuse is
 * the Card-shaped validator: a sentence of a tale has no Card, no permit and
 * no grade, and pretending otherwise would have meant inventing one.
 */
export const checkBeat = async (
  dependencies: ReadingDependencies,
  draft: ReadingBeatDraft,
  target: TaleWord | null,
  knowledge: KnowledgeSnapshot,
  /**
   * Words earlier beats already introduced.
   *
   * A word met once is met: a tale about a peach that may say 桃 in one
   * sentence and never again is not a tale, and meeting a new word
   * repeatedly across a page is most of what reading is for. Only the
   * sentence that *introduces* a word is i+1; afterwards it is i.
   */
  introduced: readonly TaleWord[] = [],
): Promise<Result<ReadingSentence, readonly string[]>> => {
  const reasons: string[] = [];
  const japanese = normalizeJapanese(draft.japanese);
  if (japanese.trim() === "") return err(["empty sentence"]);
  const rejoined = draft.segments.map((s) => normalizeJapanese(s.written)).join("");
  if (rejoined !== japanese) reasons.push("segments do not rejoin into the sentence");
  const unplaceable = draft.segments
    .filter((s) => !readingFits(s.written, s.reading))
    .map((s) => s.written);
  if (unplaceable.length > 0)
    reasons.push(`reading cannot be placed: ${unplaceable.join(", ")}`);
  if (!/[A-Za-z]/u.test(draft.english)) reasons.push("english is not English");

  const analyzed = await dependencies.analyzer.analyze("reading", draft.japanese);
  if (!analyzed.ok) return err([`analysis failed: ${analyzed.error.kind}`]);

  // The tale's word in the shape the identity rule wants, or nothing when
  // the beat is a sentence of words the learner already has.
  let wanted: Readonly<{
    lemma: string;
    reading: string;
    partOfSpeech: BroadPartOfSpeech;
  }> | null = null;
  if (target !== null) {
    const part = parseBroadPartOfSpeech(target.partOfSpeech);
    if (part === null) {
      return err([`tale word has an unusable part of speech: ${target.partOfSpeech}`]);
    }
    wanted = {
      lemma: normalizeJapanese(target.lemma),
      reading: normalizeReading(target.reading),
      partOfSpeech: part,
    };
  }

  const isWanted = (token: Parameters<typeof isTargetToken>[0]): boolean =>
    wanted !== null && isTargetToken(token, wanted);

  // The tale's own vocabulary so far, which the reader has already met.
  const met = introduced.flatMap((word) => {
    const part = parseBroadPartOfSpeech(word.partOfSpeech);
    return part === null
      ? []
      : [
          {
            lemma: normalizeJapanese(word.lemma),
            reading: normalizeReading(word.reading),
            partOfSpeech: part,
          },
        ];
  });
  const isMet = (token: Parameters<typeof isTargetToken>[0]): boolean =>
    met.some((word) => isTargetToken(token, word));

  let span: ReadingSentence["wordSpan"] = null;
  if (wanted !== null) {
    const hit = analyzed.value.tokens.find(isWanted);
    if (hit === undefined) reasons.push(`the sentence does not use ${target?.lemma}`);
    else span = textSpan(hit.span.start, hit.span.end);
  }

  // Every other content word has to be one the learner already has. This is
  // the whole promise of the page: one new word a sentence, never two.
  const classified = classifyKnownVocabulary(
    {
      ...analyzed.value,
      tokens: analyzed.value.tokens.map((t) => ({ ...t, senseCandidates: [] })),
    },
    knownBank(knowledge),
  );
  const strangers = classified
    .filter(({ token, status }) => {
      if (dependencies.transparentPartOfSpeech.has(token.broadPartOfSpeech))
        return false;
      if (token.broadPartOfSpeech === "interjection") return false;
      // Bound forms are grammar wearing a noun's tag: the nominaliser の in
      // 出るのが, and the suffixes. Asking the learner to have met one as
      // vocabulary asks them to have met a word that is not one. Coverage
      // has always bucketed these as grammar; this agrees with it.
      const tags = token.partOfSpeech;
      if (tags.includes("非自立") || tags.includes("接尾")) return false;
      if (isWanted(token) || isMet(token)) return false;
      return status !== "known";
    })
    .map(({ token }) => token.surface);
  if (strangers.length > 0) {
    reasons.push(
      `words the learner does not know: ${[...new Set(strangers)].join(", ")}`,
    );
  }

  if (reasons.length > 0) return err(reasons);
  return ok({
    index: 0,
    japanese: draft.japanese,
    segments: draft.segments,
    english: draft.english,
    word: target,
    wordSpan: span,
    audioUrl: null,
  });
};

/**
 * The tale's own words introduced before a given beat, and still new to the
 * learner. A word the learner already had never needed introducing.
 */
export const introducedBefore = (
  tale: Tale,
  index: number,
  knowledge: KnowledgeSnapshot,
): readonly TaleWord[] =>
  tale.beats
    .slice(0, index)
    .flatMap((beat) =>
      beat.word !== null && !alreadyHas(beat.word, knowledge) ? [beat.word] : [],
    );

/** Rounds allowed per beat before the reading gives up and says which beat. */
const MAX_BEAT_ROUNDS = 3;

/**
 * Whether the learner already has the word the tale meant to introduce.
 *
 * A tale declares the vocabulary it cannot avoid, not the vocabulary this
 * reader lacks. Once 鬼 has been learned, the beat that introduced it is an
 * ordinary sentence, and presenting it as new would be a small lie about
 * where the reader is.
 */
const kanaOnly = /^[ぁ-ゟ゠-ヿー]+$/u;

export const alreadyHas = (word: TaleWord, knowledge: KnowledgeSnapshot): boolean => {
  const lemma = normalizeJapanese(word.lemma);
  const reading = normalizeReading(word.reading);
  // Reading alone conflates homophones: 洗濯 and 選択 are both せんたく, and
  // matching on the reading reported 洗濯 as already known because the
  // Kaishi baseline holds 選択. A word written in kanji has to match the
  // writing; only a word written in kana can be matched by its sound.
  return knowledge.vocabulary.some((entry) => {
    if (normalizeJapanese(entry.lemma) === lemma) return true;
    return kanaOnly.test(lemma) && normalizeReading(entry.reading) === reading;
  });
};

/**
 * Writes a tale as a sequence of sentences the reader can actually read.
 *
 * Beat by beat, because that is the only way the promise holds: each
 * sentence is drafted, checked against the learner's vocabulary on its own,
 * and retried with the reasons attached if it smuggled in a word. A beat
 * that cannot be written in three rounds stops the reading and says which
 * beat it was, rather than handing over a tale with a hole in it.
 */
/**
 * Drafts one beat and keeps trying until it passes or the rounds run out.
 *
 * The reasons travel back into the next attempt, so a draft refused for a
 * word the learner lacks is told which word. Three rounds, because a model
 * that cannot tell one beat inside the vocabulary available will not manage
 * it on the tenth try either.
 */
export const draftBeat = async (
  dependencies: ReadingDependencies,
  tale: Tale,
  beat: TaleBeat,
  preceding: readonly string[],
  knowledge: KnowledgeSnapshot,
  introduced: readonly TaleWord[] = [],
  signal?: AbortSignal,
): Promise<Result<ReadingSentence, readonly string[]>> => {
  const target =
    beat.word !== null && !alreadyHas(beat.word, knowledge) ? beat.word : null;
  let rejections: readonly string[] = [];
  for (let round = 0; round < MAX_BEAT_ROUNDS; round += 1) {
    const draft = await dependencies.provider.write(
      {
        titleEnglish: tale.titleEnglish,
        beat: beat.beat,
        preceding,
        target,
        knowledge,
        introduced,
        rejections,
      },
      signal,
    );
    if (!draft.ok) return err([`${draft.error.kind}: ${draft.error.detail}`]);
    const checked = await checkBeat(
      dependencies,
      draft.value,
      target,
      knowledge,
      introduced,
    );
    if (checked.ok) return ok(checked.value);
    rejections = checked.error;
  }
  return err(rejections);
};

export const writeReading = async (
  dependencies: ReadingDependencies,
  tale: Tale,
  knowledge: KnowledgeSnapshot,
  now: Date,
  signal?: AbortSignal,
): Promise<Result<Reading, ReadingFailure>> => {
  const sentences: ReadingSentence[] = [];
  const preceding: string[] = [];
  for (const [index, beat] of tale.beats.entries()) {
    const written = await draftBeat(
      dependencies,
      tale,
      beat,
      preceding,
      knowledge,
      introducedBefore(tale, index, knowledge),
      signal,
    );
    if (!written.ok) {
      return err({ kind: "beatRefused", index, reasons: written.error });
    }
    sentences.push({ ...written.value, index });
    preceding.push(written.value.japanese);
  }
  return ok({
    taleId: tale.id,
    title: tale.title,
    titleReading: tale.titleReading,
    titleEnglish: tale.titleEnglish,
    provenance: tale.provenance,
    generatedAt: now.toISOString(),
    sentences,
  });
};
