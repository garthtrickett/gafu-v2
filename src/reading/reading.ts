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
      if (isWanted(token)) return false;
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
const alreadyHas = (word: TaleWord, knowledge: KnowledgeSnapshot): boolean => {
  const lemma = normalizeJapanese(word.lemma);
  const reading = normalizeReading(word.reading);
  return knowledge.vocabulary.some(
    (entry) =>
      normalizeJapanese(entry.lemma) === lemma ||
      normalizeReading(entry.reading) === reading,
  );
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
        rejections,
      },
      signal,
    );
    if (!draft.ok) return err([`${draft.error.kind}: ${draft.error.detail}`]);
    const checked = await checkBeat(dependencies, draft.value, target, knowledge);
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
