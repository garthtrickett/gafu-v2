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

const sameForm = (token: AnalyzedToken, known: KnownVocabularyEntry): boolean =>
  token.lemma === known.lemma &&
  token.reading === known.reading &&
  token.broadPartOfSpeech === known.partOfSpeech;

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
