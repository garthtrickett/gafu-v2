import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import type { KnownVocabularyEntry } from "../analysis/known-vocabulary.ts";
import { normalizeJapanese } from "../analysis/normalization.ts";
import { err, ok, type Result } from "../result.ts";
import type { CardSummary } from "../study/contracts.ts";
import type { ValidationDependencies } from "./contracts.ts";
import { supportsGrammarTarget } from "./declared-grammar.ts";
import type {
  GeneratedMaterial,
  MaterialFailure,
  MaterialValidationInput,
} from "./generated-contracts.ts";
import { decodeGeneratedMaterial, parseBroadPartOfSpeech } from "./generated-decode.ts";
import {
  adjectiveLemma,
  createLearningMaterialValidator,
  normalizeReading,
} from "./validator.ts";

const normalizeMeaning = (value: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!?]+$/u, "");

const metadataMatches = (
  material: GeneratedMaterial,
  card: CardSummary,
  broadPartOfSpeech: BroadPartOfSpeech | null,
): boolean => {
  if (
    card.type === "vocabulary" &&
    "lemma" in card.content &&
    material.targetKind === "vocabulary"
  ) {
    return (
      normalizeJapanese(material.target.lemma) ===
        normalizeJapanese(card.content.lemma) &&
      normalizeReading(material.target.reading) ===
        normalizeReading(card.content.reading) &&
      material.target.partOfSpeech === broadPartOfSpeech &&
      normalizeMeaning(material.target.meaning) ===
        normalizeMeaning(card.content.meaning)
    );
  }
  if (
    card.type === "grammar" &&
    "canonicalForm" in card.content &&
    material.targetKind === "grammar"
  ) {
    return (
      normalizeJapanese(material.target.canonicalForm) ===
        normalizeJapanese(card.content.canonicalForm) &&
      normalizeMeaning(material.target.meaning) ===
        normalizeMeaning(card.content.meaning) &&
      normalizeJapanese(material.target.formationHint) ===
        normalizeJapanese(card.content.formation)
    );
  }
  return false;
};

/** English prose with at most incidental Japanese: Latin letters lead. */
export const readsAsEnglish = (text: string): boolean => {
  const latin = (text.match(/[A-Za-z]/gu) ?? []).length;
  const japanese = (text.match(/[぀-ヿ一-鿿々〆]/gu) ?? []).length;
  return latin > 0 && latin >= japanese;
};

export const createGeneratedMaterialValidator = (
  dependencies: ValidationDependencies,
): ((
  input: MaterialValidationInput,
) => Promise<Result<GeneratedMaterial, MaterialFailure>>) => {
  return async ({ value, mode, card, knowledge }) => {
    const decoded = decodeGeneratedMaterial(value);
    if (!decoded.ok) return decoded;
    if (decoded.value.mode !== mode) {
      return err({ kind: "validationRejected", reasons: ["wrongMode"] });
    }
    // The scene, the answer, and the explanations are English prose; Japanese
    // belongs in them only as the target word or a short quoted form. A model
    // that writes them in Japanese has produced a card the learner cannot read
    // yet, so it is refused before anything deeper is checked.
    // The usage note may quote a subtitle cue at length, so it need only
    // contain some English; the other three must read as English.
    const notEnglish: string[] = (["context", "answer", "explanation"] as const).filter(
      (field) => !readsAsEnglish(decoded.value[field]),
    );
    if (!/[A-Za-z]/u.test(decoded.value.usageNote)) notEnglish.push("usageNote");
    if (notEnglish.length > 0) {
      return err({
        kind: "validationRejected",
        reasons: notEnglish.map((field) => `notEnglish: ${field}`),
      });
    }

    if (card.type === "grammar" && "canonicalForm" in card.content) {
      if (!supportsGrammarTarget(card.content.canonicalForm)) {
        return err({
          kind: "unsupportedGrammarTarget",
          canonicalForm: card.content.canonicalForm,
        });
      }
    }
    const broadPartOfSpeech =
      card.type === "vocabulary" && "partOfSpeech" in card.content
        ? parseBroadPartOfSpeech(card.content.partOfSpeech)
        : null;
    if (
      card.type === "vocabulary" &&
      "partOfSpeech" in card.content &&
      broadPartOfSpeech === null
    ) {
      return err({
        kind: "unsupportedVocabularyPartOfSpeech",
        value: card.content.partOfSpeech,
      });
    }
    if (!metadataMatches(decoded.value, card, broadPartOfSpeech)) {
      return err({ kind: "validationRejected", reasons: ["targetMetadataMismatch"] });
    }

    const knownVocabulary: KnownVocabularyEntry[] = knowledge.vocabulary.flatMap(
      (word): readonly KnownVocabularyEntry[] => {
        const part =
          word.partOfSpeech === null ? null : parseBroadPartOfSpeech(word.partOfSpeech);
        if (part === null) return [];
        if (word.source === "card") {
          return word.senseIds.map((senseId) => ({
            lemma: normalizeJapanese(word.lemma),
            reading: normalizeReading(word.reading),
            partOfSpeech: part,
            scope: { kind: "oneSense" as const, senseId },
          }));
        }
        return [
          {
            lemma: normalizeJapanese(word.lemma),
            reading: normalizeReading(word.reading),
            partOfSpeech: part,
            scope: { kind: "allSenses" as const },
          },
        ];
      },
    );
    const target =
      card.type === "vocabulary" &&
      "lemma" in card.content &&
      broadPartOfSpeech !== null
        ? {
            kind: "vocabulary" as const,
            lemma: normalizeJapanese(card.content.lemma),
            reading: normalizeReading(card.content.reading),
            partOfSpeech: broadPartOfSpeech,
            senseId: `gafu-manual:${normalizeMeaning(card.content.meaning)}`,
          }
        : card.type === "grammar" && "canonicalForm" in card.content
          ? {
              kind: "grammar" as const,
              canonicalForm: normalizeJapanese(card.content.canonicalForm),
            }
          : null;
    if (target === null) {
      return err({ kind: "validationRejected", reasons: ["cardTypeMismatch"] });
    }

    const targetSense =
      target.kind === "vocabulary" ? target.senseId : "not-a-vocabulary-target";
    const scopedValidator = createLearningMaterialValidator({
      ...dependencies,
      senses: {
        resolve: (token) =>
          target.kind === "vocabulary" &&
          (target.partOfSpeech === "adjective"
            ? adjectiveLemma(token.lemma)
            : token.lemma) === target.lemma &&
          normalizeReading(token.reading ?? "") === target.reading &&
          token.broadPartOfSpeech === target.partOfSpeech
            ? [targetSense]
            : dependencies.senses.resolve(token, decoded.value.japanese),
      },
    });
    const checked = await scopedValidator.validate(decoded.value, target, {
      vocabulary: knownVocabulary,
      grammar: new Set(knowledge.grammar.map((item) => item.canonicalForm)),
    });
    if (!checked.ok) {
      // The words at fault travel with the reason: a retry that knows which
      // word was unknown can avoid it, where a bare kind teaches nothing.
      return err({
        kind: "validationRejected",
        reasons: checked.error.reasons.map((reason) =>
          reason.kind === "unknownVocabulary"
            ? `unknownVocabulary: ${reason.surfaces.join(", ")}`
            : reason.kind === "unknownGrammar"
              ? `unknownGrammar: ${reason.canonicalForms.join(", ")}`
              : reason.kind,
        ),
      });
    }
    return ok(decoded.value);
  };
};
