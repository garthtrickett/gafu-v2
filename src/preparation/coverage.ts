import type { AnalyzedToken, JapaneseAnalyzer } from "../analysis/contracts.ts";
import type { KnownVocabulary } from "../study/contracts.ts";

/**
 * What fraction of the words spoken in some subtitles the learner already
 * knows, and which unknown words would buy the most coverage.
 *
 * Comprehension tracks running words, not distinct words: the frequent words
 * carry most of the text, so a learner who knows half the vocabulary of an
 * episode still understands four fifths of what is said. Reporting distinct
 * words instead makes a watchable episode look hopeless.
 */
/** Sources are reported in the order given, so episodes stay in watch order. */
export type CoverageSource = Readonly<{ name: string; cues: readonly string[] }>;

export type CoverageWord = Readonly<{
  lemma: string;
  reading: string | null;
  partOfSpeech: string;
  count: number;
  sources: readonly string[];
  example: string;
}>;

export type CoverageMilestone = Readonly<{ coverage: number; words: number }>;

export type CoverageSourceReport = Readonly<{
  name: string;
  runningWords: number;
  coverage: number;
  wordsForTarget: number;
}>;

export type CoverageReport = Readonly<{
  runningWords: number;
  /** Particles, auxiliaries, bound forms, interjections, numbers: no Card needed. */
  grammarWords: number;
  /** Proper nouns: met once and free thereafter. */
  nameWords: number;
  knownWords: number;
  unknownWords: number;
  coverage: number;
  target: number;
  wordsForTarget: number;
  distinctUnknown: number;
  milestones: readonly CoverageMilestone[];
  sources: readonly CoverageSourceReport[];
  words: readonly CoverageWord[];
}>;

const MILESTONES = [0.9, 0.92, 0.95, 0.98] as const;
/** Enough of the list to act on; the count above it is reported separately. */
const MAXIMUM_WORDS = 500;

const grammarParts = new Set(["particle", "auxiliary", "copula", "symbol"]);
// Kuromoji tags a run of punctuation as a sa-hen noun; "..." is not a word.
const wordLike = /[\p{Letter}\p{Number}]/u;
const kana = /^[ぁ-ゟ゠-ヿー]+$/u;

export type TokenBucket = "grammar" | "name" | "free" | "content";

/**
 * Which words cost a Card. Bound forms (非自立) and suffixes are grammar
 * however kuromoji labels their part of speech: ん, てる and ちゃう are not
 * vocabulary, and counting them as unknown buries the words that are.
 */
export const bucketToken = (token: AnalyzedToken): TokenBucket => {
  if (!wordLike.test(token.surface)) return "free";
  if (grammarParts.has(token.broadPartOfSpeech)) return "grammar";
  const tags = token.partOfSpeech;
  if (tags.includes("非自立") || tags.includes("接尾")) return "grammar";
  if (token.broadPartOfSpeech === "interjection") return "free";
  if (tags.includes("数") || tags.includes("フィラー")) return "free";
  if (tags.includes("固有名詞")) return "name";
  return "content";
};

/**
 * Whether a word is already known, comparing the reading as well as the
 * written form. Subtitles write ordinary words in kana where the Known Word
 * Bank holds the kanji, so 分かる and わかる are the same word and matching
 * only on the written form reported hundreds of known words as new.
 */
export const createKnownLookup = (
  vocabulary: readonly KnownVocabulary[],
): ((lemma: string, partOfSpeech: string) => boolean) => {
  const byLemma = new Set<string>();
  const byReading = new Set<string>();
  for (const entry of vocabulary) {
    const part = entry.partOfSpeech ?? "";
    byLemma.add(`${entry.lemma}|${part}`);
    byReading.add(`${entry.reading}|${part}`);
  }
  return (lemma, partOfSpeech) =>
    byLemma.has(`${lemma}|${partOfSpeech}`) ||
    (kana.test(lemma) && byReading.has(`${lemma}|${partOfSpeech}`));
};

/** How many of the ranked words are needed to reach `target` of `runningWords`. */
const wordsToReach = (
  ranked: readonly { count: number }[],
  base: number,
  runningWords: number,
  target: number,
): number => {
  if (runningWords === 0 || base / runningWords >= target) return 0;
  let gained = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    gained += ranked[index]?.count ?? 0;
    if ((base + gained) / runningWords >= target) return index + 1;
  }
  return ranked.length;
};

export const measureCoverage = async (input: {
  analyzer: JapaneseAnalyzer;
  sources: readonly CoverageSource[];
  vocabulary: readonly KnownVocabulary[];
  target?: number;
}): Promise<CoverageReport> => {
  const target = input.target ?? 0.95;
  const isKnown = createKnownLookup(input.vocabulary);
  const unknown = new Map<
    string,
    { word: CoverageWord; count: number; sources: Set<string> }
  >();
  const perSource = new Map<
    string,
    { runningWords: number; base: number; counts: Map<string, number> }
  >();
  let runningWords = 0;
  let grammarWords = 0;
  let nameWords = 0;
  let knownWords = 0;

  for (const source of input.sources) {
    const stats = { runningWords: 0, base: 0, counts: new Map<string, number>() };
    perSource.set(source.name, stats);
    for (const [index, cue] of source.cues.entries()) {
      const analyzed = await input.analyzer.analyze(`${source.name}:${index}`, cue);
      if (!analyzed.ok) continue;
      for (const token of analyzed.value.tokens) {
        if (token.broadPartOfSpeech === "symbol") continue;
        runningWords += 1;
        stats.runningWords += 1;
        const bucket = bucketToken(token);
        if (bucket !== "content") {
          if (bucket === "name") nameWords += 1;
          else grammarWords += 1;
          stats.base += 1;
          continue;
        }
        if (isKnown(token.lemma, token.broadPartOfSpeech)) {
          knownWords += 1;
          stats.base += 1;
          continue;
        }
        const key = `${token.lemma}|${token.broadPartOfSpeech}`;
        stats.counts.set(key, (stats.counts.get(key) ?? 0) + 1);
        const hit = unknown.get(key);
        if (hit === undefined) {
          unknown.set(key, {
            count: 1,
            sources: new Set([source.name]),
            word: {
              lemma: token.lemma,
              reading: token.reading,
              partOfSpeech: token.broadPartOfSpeech,
              count: 1,
              sources: [],
              example: analyzed.value.normalizedText,
            },
          });
        } else {
          hit.count += 1;
          hit.sources.add(source.name);
        }
      }
    }
  }

  const ranked = [...unknown.values()]
    .sort((a, b) => b.count - a.count || a.word.lemma.localeCompare(b.word.lemma))
    .map(
      (item): CoverageWord => ({
        ...item.word,
        count: item.count,
        sources: [...item.sources].sort(),
      }),
    );
  const base = grammarWords + nameWords + knownWords;
  const unknownWords = runningWords - base;
  return {
    runningWords,
    grammarWords,
    nameWords,
    knownWords,
    unknownWords,
    coverage: runningWords === 0 ? 1 : base / runningWords,
    target,
    wordsForTarget: wordsToReach(ranked, base, runningWords, target),
    distinctUnknown: ranked.length,
    milestones: MILESTONES.map((coverage) => ({
      coverage,
      words: wordsToReach(ranked, base, runningWords, coverage),
    })),
    sources: [...perSource.entries()].map(([name, stats]): CoverageSourceReport => {
      const own = [...stats.counts.values()]
        .sort((a, b) => b - a)
        .map((count) => ({ count }));
      return {
        name,
        runningWords: stats.runningWords,
        coverage: stats.runningWords === 0 ? 1 : stats.base / stats.runningWords,
        wordsForTarget: wordsToReach(own, stats.base, stats.runningWords, target),
      };
    }),
    words: ranked.slice(0, MAXIMUM_WORDS),
  };
};
