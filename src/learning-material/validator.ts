import type { AnalyzedToken } from "../analysis/contracts.ts";
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
      // The model spans the whole target word; the detector only ever matches
      // the construction's suffix, so containment — not equality — is the
      // evidence the target is there.
      item.spans.some((span) => insideSpan(span, targetSpan)),
  );

/**
 * Kuromoji lemmatizes a な-adjective stem with its copula (肝心だ), while a
 * Card claims the bare stem (肝心). Strip one trailing だ for the comparison
 * so the claim and the analysis can meet. Anything else compares verbatim.
 */
export const adjectiveLemma = (lemma: string): string =>
  lemma.length > 1 && lemma.endsWith("だ") ? lemma.slice(0, -1) : lemma;

/**
 * Token sequences tiling the target span exactly: first starts where the
 * span starts, each next starts where the previous ends, last ends where the
 * span ends. A compound target (飼育員 as 飼育|員) tiles; a span cutting
 * through a token admits no tiling at all. Exported for the cards CLI, which
 * locates the target with the same rule before sending.
 */
export const tilings = (
  tokens: readonly AnalyzedToken[],
  span: DecodedPresentation["targetSpan"],
): AnalyzedToken[][] => {
  const found: AnalyzedToken[][] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const first = tokens[index];
    if (first === undefined || first.span.start !== span.start) continue;
    const tiling = [first];
    let end = first.span.end;
    if (end === span.end) found.push([...tiling]);
    for (let next = index + 1; next < tokens.length && end < span.end; next += 1) {
      const token = tokens[next];
      if (token === undefined || token.span.start !== end) break;
      tiling.push(token);
      end = token.span.end;
      if (end === span.end) found.push([...tiling]);
      if (end > span.end) break;
    }
  }
  return found;
};

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
      const covering = tilings(analyzed.value.tokens, span);
      if (covering.length === 0) {
        reasons.push({ kind: "targetAbsent" });
      } else {
        const matching = covering.find((tiling) => {
          const lemma = tiling
            .map((token) =>
              target.partOfSpeech === "adjective"
                ? adjectiveLemma(token.lemma)
                : token.lemma,
            )
            .join("");
          const reading = tiling.map((token) => token.reading ?? "").join("");
          if (lemma !== target.lemma || reading !== target.reading) return false;
          // One token keeps the old part-of-speech check. A compound has no
          // single part of speech across its parts (間が悪い tiles noun,
          // particle, adjective), so its concatenated lemma and reading are
          // the whole identity claim.
          if (tiling.length !== 1) return true;
          const only = tiling[0];
          return only !== undefined && only.broadPartOfSpeech === target.partOfSpeech;
        });
        if (matching === undefined) {
          reasons.push({ kind: "wrongTargetIdentity" });
        } else if (matching.length === 1) {
          const observed = matching[0];
          if (observed === undefined) {
            reasons.push({ kind: "targetAbsent" });
          } else {
            const senses = dependencies.senses.resolve(observed, normalizedJapanese);
            if (senses.length !== 1) reasons.push({ kind: "ambiguousTargetIdentity" });
            else if (senses[0] !== target.senseId) {
              reasons.push({ kind: "wrongTargetIdentity" });
            }
          }
        }
        // A multi-token tiling carries no per-component sense: the Card's
        // identity claim covers the whole, and components resolve no
        // independent sense. Form equality above is the whole check.
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
        // A token inside the target span is the target word's own morphology,
        // not supporting language — whether the target is one token or a
        // compound tiling the span.
        const isVocabularyTarget =
          target.kind === "vocabulary" &&
          insideSpan(token.span, presentation.targetSpan);
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
          // A pattern found only inside the target is the target word's own
          // morphology, not language the learner must already have. 詰める is
          // a plain る-verb, and the potential-form patterns match its める
          // tail, so a sentence teaching 詰める would be refused for leaning
          // on 可能形 it never used; a れた tail inside a passive span is the
          // same shape. A pattern found only inside the target says nothing
          // about what the learner must already know.
          !(
            item.spans.length > 0 &&
            item.spans.every((span) => insideSpan(span, presentation.targetSpan))
          ) &&
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
