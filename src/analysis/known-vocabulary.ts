import type { AnalyzedText, AnalyzedToken, BroadPartOfSpeech } from "./contracts.ts";

export type KnownVocabularyEntry = Readonly<{
  lemma: string;
  reading: string | null;
  partOfSpeech: BroadPartOfSpeech;
  scope:
    | { readonly kind: "allSenses" }
    | { readonly kind: "oneSense"; readonly senseId: string };
}>;

export type VocabularyKnowledge = Readonly<{
  token: AnalyzedToken;
  status: "known" | "unresolved";
}>;

const kana = /^[ぁ-ゟ゠-ヿー]+$/u;

/**
 * Whether a token is the Known Word Bank entry, written either way.
 *
 * `token.reading` is the reading of the *surface*, so an inflected 分かる
 * arrives as `分かる` paired with `わかっ` and never equalled the entry's
 * `わかる`. Comparing the two as a pair therefore called known words new:
 * measured over ordinary conversational Japanese it missed 12 of 34.
 *
 * The written forms are compared instead, and a kana-written token is also
 * compared against the entry's reading, because ordinary words are commonly
 * written either way: かわいい is 可愛い, わかる is 分かる. A な-adjective
 * lemmatises with its copula (清潔だ for 清潔), which is the same word.
 */
const sameForm = (token: AnalyzedToken, known: KnownVocabularyEntry): boolean => {
  if (token.broadPartOfSpeech !== known.partOfSpeech) return false;
  const written = (value: string): string =>
    value.length > 1 && value.endsWith("だ") ? value.slice(0, -1) : value;
  const lemma = written(token.lemma);
  if (lemma === written(known.lemma)) return true;
  return known.reading !== null && kana.test(lemma) && lemma === written(known.reading);
};

export const classifyKnownVocabulary = (
  analysis: AnalyzedText,
  knownBank: readonly KnownVocabularyEntry[],
): readonly VocabularyKnowledge[] =>
  analysis.tokens.map((token) => {
    const matches = knownBank.filter((entry) => sameForm(token, entry));
    const allSensesKnown = matches.some((entry) => entry.scope.kind === "allSenses");
    const resolvedSenseKnown = matches.some(
      (entry) =>
        entry.scope.kind === "oneSense" &&
        token.senseCandidates.includes(entry.scope.senseId),
    );
    return {
      token,
      status: allSensesKnown || resolvedSenseKnown ? "known" : "unresolved",
    };
  });
