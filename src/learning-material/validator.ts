import { classifyKnownVocabulary } from "../analysis/known-vocabulary.ts";
import { normalizeJapanese } from "../analysis/normalization.ts";
import { err, ok } from "../result.ts";
import type {
  DecodedPresentation,
  DetectedGrammar,
  LearningMaterialValidator,
  ValidationDependencies,
  ValidationError,
} from "./contracts.ts";
import { decodePresentation } from "./decode.ts";

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

const sameSpan = (
  left: DecodedPresentation["targetSpan"],
  right: DecodedPresentation["targetSpan"],
): boolean => left.start === right.start && left.end === right.end;

const insideSpan = (
  inner: DecodedPresentation["targetSpan"],
  outer: DecodedPresentation["targetSpan"],
): boolean => inner.start >= outer.start && inner.end <= outer.end;

const grammarContainsTarget = (
  evidence: readonly DetectedGrammar[],
  canonicalForm: string,
  targetSpan: DecodedPresentation["targetSpan"],
): boolean =>
  evidence.some(
    (item) =>
      item.canonicalForm === canonicalForm &&
      item.spans.some((span) => sameSpan(span, targetSpan)),
  );

const analysisFailure = (kind: string, cause: string): ValidationError =>
  kind === "degraded"
    ? { kind: "analysisDegraded", cause }
    : { kind: "analysisUnavailable", cause };

export const createLearningMaterialValidator = (
  dependencies: ValidationDependencies,
): LearningMaterialValidator => ({
  validate: async (providerValue, target, knowledge) => {
    const decoded = decodePresentation(providerValue);
    if (!decoded.ok) return decoded;

    const presentation = decoded.value;
    const normalizedJapanese = normalizeJapanese(presentation.japanese);
    const reasons: ValidationError[] = [];
    const reconstructed = presentation.readingSegments
      .map((segment) => normalizeJapanese(segment.written))
      .join("");
    if (reconstructed !== normalizedJapanese) {
      reasons.push({ kind: "readingReconstructionMismatch" });
    }

    const span = presentation.targetSpan;
    const validSpan =
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      span.start >= 0 &&
      span.end > span.start &&
      span.end <= normalizedJapanese.length;
    if (!validSpan) {
      reasons.push({ kind: "invalidTargetSpan" });
    } else if (
      normalizedJapanese.slice(span.start, span.end) !== presentation.targetSurface
    ) {
      reasons.push({ kind: "targetSurfaceMismatch" });
    }

    const analyzed = await dependencies.analyzer.analyze(
      "learning-material",
      presentation.japanese,
    );
    if (!analyzed.ok) {
      const detail =
        "cause" in analyzed.error ? analyzed.error.cause : analyzed.error.kind;
      reasons.push(analysisFailure(analyzed.error.kind, detail));
      return err({ kind: "rejected", reasons });
    }

    const grammar = dependencies.grammar.detect(normalizedJapanese);
    if (target.kind === "vocabulary") {
      const observed = analyzed.value.tokens.find((token) =>
        sameSpan(token.span, span),
      );
      if (observed === undefined) {
        reasons.push({ kind: "targetAbsent" });
      } else {
        const formMatches =
          observed.lemma === target.lemma &&
          observed.reading === target.reading &&
          observed.broadPartOfSpeech === target.partOfSpeech;
        if (!formMatches) reasons.push({ kind: "wrongTargetIdentity" });
        const senses = dependencies.senses.resolve(observed, normalizedJapanese);
        if (senses.length !== 1) reasons.push({ kind: "ambiguousTargetIdentity" });
        else if (senses[0] !== target.senseId) {
          reasons.push({ kind: "wrongTargetIdentity" });
        }
      }
    } else if (!grammarContainsTarget(grammar, target.canonicalForm, span)) {
      reasons.push({ kind: "targetAbsent" });
    }

    const analysisWithSenses = {
      ...analyzed.value,
      tokens: analyzed.value.tokens.map((token) => ({
        ...token,
        senseCandidates: dependencies.senses.resolve(token, normalizedJapanese),
      })),
    };
    const classified = classifyKnownVocabulary(
      analysisWithSenses,
      knowledge.vocabulary,
    );
    const unknownVocabulary = classified
      .filter(({ token, status }) => {
        if (dependencies.policy.transparentPartOfSpeech.has(token.broadPartOfSpeech)) {
          return false;
        }
        const isVocabularyTarget =
          target.kind === "vocabulary" && sameSpan(token.span, presentation.targetSpan);
        const isGrammarTargetComponent =
          target.kind === "grammar" && insideSpan(token.span, presentation.targetSpan);
        return !isVocabularyTarget && !isGrammarTargetComponent && status !== "known";
      })
      .map(({ token }) => token.surface);
    if (unknownVocabulary.length > 0) {
      reasons.push({
        kind: "unknownVocabulary",
        surfaces: unique(unknownVocabulary),
      });
    }

    const unknownGrammar = grammar
      .filter(
        (item) =>
          !(target.kind === "grammar" && item.canonicalForm === target.canonicalForm) &&
          !knowledge.grammar.has(item.canonicalForm),
      )
      .map((item) => item.canonicalForm);
    if (unknownGrammar.length > 0) {
      reasons.push({ kind: "unknownGrammar", canonicalForms: unique(unknownGrammar) });
    }

    return reasons.length === 0
      ? ok({ presentation, normalizedJapanese, analyzer: dependencies.analyzer.name })
      : err({ kind: "rejected", reasons });
  },
});
