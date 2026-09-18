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
 * Kuromoji lemmatizes a な-adjective stem with its copula (肝心だ), while a
 * Card claims the bare stem (肝心). Strip one trailing だ for the comparison
 * so the claim and the analysis can meet. Anything else compares verbatim.
 */
export const adjectiveLemma = (lemma: string): string =>
  lemma.length > 1 && lemma.endsWith("だ") ? lemma.slice(0, -1) : lemma;

const SURU = "する";

export type WordForm = Readonly<{
  lemma: string;
  partOfSpeech: BroadPartOfSpeech;
  /**
   * Whether the token carries a する the word itself does not, so its
   * reading runs past the word's own: びっくりし reads びっくりし where the
   * word reads びっくり.
   */
  inflectsWithSuru: boolean;
}>;

/**
 * The dictionary words a token can stand for, written as a Card writes them.
 *
 * Kuromoji tags a word by the job it is doing in the sentence; a Card records
 * what the word is. Two of those disagreements are systematic, and neither
 * is anybody's mistake.
 *
 * 失礼 is a noun that also serves as a な-adjective, and in 失礼な the
 * analyzer calls it 形容動詞語幹 and lemmatizes it 失礼だ. びっくり is a noun
 * that also takes する, and in びっくりしました the analyzer folds the noun
 * and the verb into one token lemmatized びっくりする. A learner holding
 * either Card has the word — and refusing the match means a sentence
 * teaching 失礼 may not say 失礼な, which is how the word is mostly used,
 * and one teaching びっくり may not say びっくりする, which is the only way
 * it is used at all.
 */
export const wordForms = (token: AnalyzedToken): readonly WordForm[] => {
  const bare =
    token.broadPartOfSpeech === "adjective" ? adjectiveLemma(token.lemma) : token.lemma;
  const forms: WordForm[] = [
    { lemma: bare, partOfSpeech: token.broadPartOfSpeech, inflectsWithSuru: false },
  ];
  const tags = token.partOfSpeech;
  if (token.broadPartOfSpeech === "adjective" && tags.includes("形容動詞語幹")) {
    forms.push({ lemma: bare, partOfSpeech: "noun", inflectsWithSuru: false });
  }
  if (
    token.broadPartOfSpeech === "verb" &&
    tags.includes("サ変接続") &&
    token.lemma.endsWith(SURU) &&
    token.lemma.length > SURU.length
  ) {
    forms.push({
      lemma: token.lemma.slice(0, -SURU.length),
      partOfSpeech: "noun",
      inflectsWithSuru: true,
    });
  }
  return forms;
};

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
  const written = (value: string): string =>
    value.length > 1 && value.endsWith("だ") ? value.slice(0, -1) : value;
  return wordForms(token).some((form) => {
    if (form.partOfSpeech !== known.partOfSpeech) return false;
    const lemma = written(form.lemma);
    if (lemma === written(known.lemma)) return true;
    return (
      known.reading !== null && kana.test(lemma) && lemma === written(known.reading)
    );
  });
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
