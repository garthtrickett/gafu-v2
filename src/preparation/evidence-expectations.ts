import type { AnalyzedCue, CandidateEvidence } from "./batching-contracts.ts";

/**
 * Which broad parts of speech earn a vocabulary candidate. This is the one
 * copy: the provider payload, the per-batch check, and the run-level check all
 * read it, so a candidate the model was asked for cannot become one the
 * validator does not expect.
 */
export const contentParts: ReadonlySet<string> = new Set([
  "noun",
  "verb",
  "adjective",
  "adverb",
  "interjection",
]);

/**
 * Kuromoji files an unrecognised run of symbols under 名詞/サ変接続, so `!?`,
 * `...` and `...♪` arrive as nouns. They are not Japanese to learn, and their
 * canonicalKey -- `!?:`, a lemma of punctuation plus the empty-reading colon --
 * is exactly the kind of string a model tidies, which it did: it answered
 * `!? :` and rejected its whole batch. A token earns a candidate only if it
 * contains something a word is made of.
 */
const wordLike = /[\p{Letter}\p{Number}]/u;

export const earnsCandidate = (
  token: Readonly<{ surface: string; broadPartOfSpeech: string }>,
): boolean => contentParts.has(token.broadPartOfSpeech) && wordLike.test(token.surface);

/**
 * A null reading yields a trailing colon. The provider is given this string
 * rather than the rule, because "lemma:reading" does not describe the null
 * case and a model reading it will drop the colon or write "null".
 */
export const canonicalVocabulary = (lemma: string, reading: string | null): string =>
  `${lemma}:${reading ?? ""}`;

const vocabularyKey = (cueId: string, start: number, end: number): string =>
  `vocabulary\0${cueId}\0${start}\0${end}`;

const grammarKey = (
  cueId: string,
  start: number,
  end: number,
  canonicalForm: string,
): string => `grammar\0${cueId}\0${start}\0${end}\0${canonicalForm}`;

/** Every annotation the supplied cues oblige the provider to return. */
export const expectedAnnotations = (
  cues: readonly AnalyzedCue[],
): ReadonlyMap<string, string> => {
  const expected = new Map<string, string>();
  for (const cue of cues) {
    for (const token of cue.tokens) {
      if (!earnsCandidate(token)) continue;
      expected.set(
        vocabularyKey(cue.cueId, token.span.start, token.span.end),
        canonicalVocabulary(token.lemma, token.reading),
      );
    }
    for (const grammar of cue.grammarEvidence) {
      for (const span of grammar.spans) {
        expected.set(
          grammarKey(cue.cueId, span.start, span.end, grammar.canonicalForm),
          grammar.canonicalForm,
        );
      }
    }
  }
  return expected;
};

const observedKey = (candidate: CandidateEvidence): string =>
  candidate.kind === "grammar"
    ? grammarKey(
        candidate.cueId,
        candidate.span.start,
        candidate.span.end,
        candidate.canonicalKey,
      )
    : vocabularyKey(candidate.cueId, candidate.span.start, candidate.span.end);

/**
 * Compares an answer against what the supplied cues oblige, returning a
 * detail naming the first discrepancy, or null when they agree exactly.
 *
 * Cues partition into batches, so agreement on every batch is agreement on
 * the manifest. Checking a batch as it commits therefore costs one batch to
 * recover from, where checking only at the end costs the whole run.
 */
export const compareAnnotations = (
  cues: readonly AnalyzedCue[],
  candidates: readonly CandidateEvidence[],
): string | null => {
  const expected = expectedAnnotations(cues);
  const observed = new Map<string, string>();
  for (const candidate of candidates) {
    const key = observedKey(candidate);
    if (observed.has(key)) {
      return `provider duplicated evidence for ${candidate.kind} ${candidate.canonicalKey} in ${candidate.cueId}`;
    }
    observed.set(key, candidate.canonicalKey);
  }
  for (const [key, canonical] of expected) {
    const seen = observed.get(key);
    if (seen === undefined) {
      const [kind, cueId, start, end] = key.split("\0");
      return `provider omitted ${kind} evidence for ${canonical} at ${start}-${end} in ${cueId}`;
    }
    if (seen !== canonical) {
      return `provider returned canonicalKey ${seen} where ${canonical} was supplied`;
    }
  }
  if (observed.size !== expected.size) {
    for (const [key, canonical] of observed) {
      if (expected.has(key)) continue;
      const [kind, cueId, start, end] = key.split("\0");
      return `provider invented ${kind} evidence ${canonical} at ${start}-${end} in ${cueId}`;
    }
    return `expected ${expected.size} evidence annotations and received ${observed.size}`;
  }
  return null;
};
