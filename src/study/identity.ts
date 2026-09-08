import { err, ok, type Result } from "../result.ts";
import type {
  CreateCard,
  GrammarContent,
  StudyFailure,
  VocabularyContent,
} from "./contracts.ts";

const MAX_FIELD_LENGTH = 2_000;

const normalizeText = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");

const normalizeEnglish = (value: string): string =>
  normalizeText(value)
    .toLocaleLowerCase("en")
    .replace(/[.!?]+$/u, "");

const katakanaToHiragana = (value: string): string =>
  [...value]
    .map((character) => {
      const point = character.codePointAt(0);
      if (point !== undefined && point >= 0x30a1 && point <= 0x30f6) {
        return String.fromCodePoint(point - 0x60);
      }
      return character;
    })
    .join("");

const required = (field: string, value: string): Result<string, StudyFailure> => {
  const normalized = normalizeText(value);
  if (normalized.length === 0) {
    return err({ kind: "invalidCard", field, detail: "is required" });
  }
  if (normalized.length > MAX_FIELD_LENGTH) {
    return err({
      kind: "invalidCard",
      field,
      detail: `must be at most ${MAX_FIELD_LENGTH} characters`,
    });
  }
  return ok(normalized);
};

export type CanonicalCard = Readonly<{
  claimAuthority: "gafu-manual-v1";
  claimKey: string;
  searchableText: string;
  content: GrammarContent | VocabularyContent;
}>;

const canonicalGrammar = (
  input: Extract<CreateCard, { type: "grammar" }>,
): Result<CanonicalCard, StudyFailure> => {
  const canonicalForm = required("canonicalForm", input.content.canonicalForm);
  if (!canonicalForm.ok) return canonicalForm;
  const meaning = required("meaning", input.content.meaning);
  if (!meaning.ok) return meaning;
  const formation = required("formation", input.content.formation);
  if (!formation.ok) return formation;
  const usageNotes = normalizeText(input.content.usageNotes);
  const content: GrammarContent = {
    canonicalForm: canonicalForm.value,
    meaning: meaning.value,
    formation: formation.value,
    usageNotes,
  };
  return ok({
    claimAuthority: "gafu-manual-v1",
    claimKey: `grammar:${canonicalForm.value}`,
    searchableText: Object.values(content).join(" ").toLocaleLowerCase(),
    content,
  });
};

const canonicalVocabulary = (
  input: Extract<CreateCard, { type: "vocabulary" }>,
): Result<CanonicalCard, StudyFailure> => {
  const lemma = required("lemma", input.content.lemma);
  if (!lemma.ok) return lemma;
  const reading = required("reading", input.content.reading);
  if (!reading.ok) return reading;
  const partOfSpeech = required("partOfSpeech", input.content.partOfSpeech);
  if (!partOfSpeech.ok) return partOfSpeech;
  const meaning = required("meaning", input.content.meaning);
  if (!meaning.ok) return meaning;
  const normalizedReading = katakanaToHiragana(reading.value);
  const normalizedPartOfSpeech = normalizeEnglish(partOfSpeech.value);
  const normalizedMeaning = normalizeEnglish(meaning.value);
  const content: VocabularyContent = {
    lemma: lemma.value,
    reading: normalizedReading,
    partOfSpeech: partOfSpeech.value,
    meaning: meaning.value,
    usageNotes: normalizeText(input.content.usageNotes),
  };
  return ok({
    claimAuthority: "gafu-manual-v1",
    claimKey: `vocabulary:${JSON.stringify([
      lemma.value,
      normalizedReading,
      normalizedPartOfSpeech,
      normalizedMeaning,
    ])}`,
    searchableText: Object.values(content).join(" ").toLocaleLowerCase(),
    content,
  });
};

export const canonicalizeCard = (
  input: CreateCard,
): Result<CanonicalCard, StudyFailure> =>
  input.type === "grammar" ? canonicalGrammar(input) : canonicalVocabulary(input);

export const canonicalizeUpdatedContent = (
  type: CreateCard["type"],
  content: GrammarContent | VocabularyContent,
): Result<CanonicalCard, StudyFailure> =>
  type === "grammar"
    ? canonicalGrammar({ type, content: content as GrammarContent })
    : canonicalVocabulary({ type, content: content as VocabularyContent });
