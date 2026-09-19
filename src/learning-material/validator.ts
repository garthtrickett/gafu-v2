import type { AnalyzedToken, BroadPartOfSpeech } from "../analysis/contracts.ts";
import {
  adjectiveLemma,
  classifyKnownVocabulary,
  wordForms,
} from "../analysis/known-vocabulary.ts";

export { adjectiveLemma };

import { dictionaryFormReading, normalizeJapanese } from "../analysis/normalization.ts";
import { err, ok } from "../result.ts";
import { readingFits } from "../study/furigana.ts";
import type {
  DecodedPresentation,
  DetectedGrammar,
  LearningMaterialValidator,
  ValidationDependencies,
  ValidationError,
} from "./contracts.ts";
import { decodePresentation } from "./decode.ts";

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

/** NFKC with katakana folded to hiragana: readings are phonological, so kana variant is irrelevant. Lemmas stay exact. */
export const normalizeReading = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/gu, (character) =>
      String.fromCodePoint((character.codePointAt(0) ?? 0) - 0x60),
    )
    .trim();

/**
 * Where the target surface sits, when the sentence says so beyond doubt.
 *
 * A model writes the target text well and counts UTF-16 offsets badly, so a
 * span that does not land on the surface it names is read as arithmetic gone
 * wrong rather than a different claim about the target, and the sentence is
 * searched instead. Only an unambiguous answer is taken: a surface appearing
 * twice leaves no way to tell which was meant, and a span pointed at the
 * wrong one of them is exactly what a careless or misleading model produces.
 * Null means the span cannot be reconciled and the material is refused.
 */
const locateSurface = (
  japanese: string,
  surface: string,
): Readonly<{ start: number; end: number }> | null => {
  if (surface === "") return null;
  const at = japanese.indexOf(surface);
  if (at < 0) return null;
  if (japanese.indexOf(surface, at + 1) >= 0) return null;
  return { start: at, end: at + surface.length };
};

/**
 * Whether a detected pattern begins among the target's own characters.
 *
 * Containment alone is not enough. かわいそう ends in そう, so 〜そうだ（様態）
 * is detected from inside the word across the copula that follows it —
 * 3..6 against a target at 0..5 — and a sentence teaching the word was
 * refused for leaning on grammar that is partly its own spelling. A pattern
 * whose first character belongs to the target is matching the word, so it
 * says nothing about what the learner must already know.
 */
const startsInsideSpan = (
  inner: DecodedPresentation["targetSpan"],
  outer: DecodedPresentation["targetSpan"],
): boolean => inner.start >= outer.start && inner.start < outer.end;

const insideSpan = (
  inner: DecodedPresentation["targetSpan"],
  outer: DecodedPresentation["targetSpan"],
): boolean => inner.start >= outer.start && inner.end <= outer.end;

/**
 * A canonical form, with the two tildes read as one.
 *
 * The declared patterns write the gap as ～ (U+FF5E); Cards imported from V1
 * write it as ~ (U+007E). Compared verbatim, すこしも~ない could never match
 * the pattern named すこしも～ない, so the Card was refused for not using the
 * construction it was entirely made of, every time, for ever.
 */
const sameCanonicalForm = (left: string, right: string): boolean =>
  left.replace(/[~～]/gu, "~") === right.replace(/[~～]/gu, "~");

const grammarContainsTarget = (
  evidence: readonly DetectedGrammar[],
  canonicalForm: string,
  targetSpan: DecodedPresentation["targetSpan"],
): boolean =>
  evidence.some(
    (item) =>
      sameCanonicalForm(item.canonicalForm, canonicalForm) &&
      // The model spans the whole target word; the detector only ever matches
      // the construction's suffix, so containment — not equality — is the
      // evidence the target is there.
      item.spans.some((span) => insideSpan(span, targetSpan)),
  );

/**
 * Whether one token is the target word, in any form it may take.
 *
 * The lemma settles the writing, but the reading must settle the word: 開く
 * is ひらく or あく and only the reading tells them apart. Kuromoji reads the
 * surface, so an inflected target reads as it is written — 聞き出し is
 * ききだし — and comparing that against the Card's ききだす rejected every
 * conjugated form. The dictionary-form reading is compared instead, with the
 * surface reading still accepted so that anything matching before matches
 * now, and irregular verbs, whose dictionary form cannot be derived, keep
 * the old behaviour rather than a wrong derivation.
 */
/**
 * Whether the token is the target word folded together with a する that the
 * word does not itself carry.
 *
 * びっくりしました analyzes as 私|は|びっくりし|まし|た: the noun and the verb
 * it forms are one token. A highlight over びっくり — which is the word, and
 * is what the learner should see coloured — therefore ends in the middle of
 * that token, and no tiling can end where it does.
 */
const isSuruHost = (
  token: AnalyzedToken,
  target: Readonly<{ lemma: string; reading: string; partOfSpeech: BroadPartOfSpeech }>,
): boolean =>
  wordForms(token).some(
    (form) =>
      form.inflectsWithSuru &&
      form.lemma === target.lemma &&
      form.partOfSpeech === target.partOfSpeech &&
      normalizeReading(token.reading ?? token.surface).startsWith(
        normalizeReading(target.reading),
      ),
  );

/**
 * The target's lemma as the analyzer writes one, with the copula removed.
 *
 * Kuromoji lemmatizes a な-adjective stem with its copula — 真剣 in 真剣な
 * comes back as 真剣だ — and the token side has always been stripped to meet
 * a Card claiming the bare stem. Cards claim it both ways: the CEJC import
 * writes 真剣, and a Kaishi entry staged by hand writes 真剣だ. Stripping
 * only the token left the second kind unable to match itself, so a Card made
 * from "I don't know this word" was refused for not containing its own word.
 */
const targetLemma = (
  target: Readonly<{ lemma: string; partOfSpeech: BroadPartOfSpeech }>,
): string =>
  target.partOfSpeech === "adjective" ? adjectiveLemma(target.lemma) : target.lemma;

export const isTargetToken = (
  token: AnalyzedToken,
  target: Readonly<{ lemma: string; reading: string; partOfSpeech: BroadPartOfSpeech }>,
): boolean => {
  const surfaceReading = token.reading ?? token.surface;
  const wanted = normalizeReading(target.reading);
  const lemma = targetLemma(target);
  return wordForms(token).some((form) => {
    if (form.lemma !== lemma) return false;
    if (form.partOfSpeech !== target.partOfSpeech) return false;
    if (normalizeReading(surfaceReading) === wanted) return true;
    // A noun folded into one token with its する reads past its own end:
    // 約束し is やくそくし where 約束 is やくそく. The する tail is the verb's,
    // not the word's, so the word is there if its reading opens the token's.
    if (form.inflectsWithSuru) {
      return normalizeReading(surfaceReading).startsWith(wanted);
    }
    const dictionary = dictionaryFormReading(token.surface, surfaceReading, form.lemma);
    return dictionary !== null && normalizeReading(dictionary) === wanted;
  });
};

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
    // A reading has to explain its writing: every kana the writing shows must
    // be said, so 相変わらず reads あいかわらず and never あいかわら. One that
    // cannot be placed over the kanji it belongs to is simply wrong, and
    // showing it would teach the wrong word — so it is refused here rather
    // than left for the renderer to make the best of.
    const unplaceable = presentation.readingSegments
      .filter((segment) => !readingFits(segment.written, segment.reading))
      .map((segment) => segment.written);
    if (unplaceable.length > 0) {
      reasons.push({ kind: "readingUnplaceable", written: unplaceable });
    }

    const claimed = presentation.targetSpan;
    const lands =
      Number.isInteger(claimed.start) &&
      Number.isInteger(claimed.end) &&
      claimed.start >= 0 &&
      claimed.end > claimed.start &&
      claimed.end <= normalizedJapanese.length &&
      normalizedJapanese.slice(claimed.start, claimed.end) ===
        presentation.targetSurface;
    const located = lands
      ? claimed
      : locateSurface(normalizedJapanese, presentation.targetSurface);
    if (located === null) {
      reasons.push({ kind: "targetSurfaceMismatch" });
    }
    // Everything below reads the repaired span, and it is the repaired span
    // that travels back: the learner's colouring lands on the word, not on
    // where the model counted it to be.
    const span = located === null ? claimed : { ...claimed, ...located };
    const spanned = { ...presentation, targetSpan: span };

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
      // Nothing tiles a highlight that stops inside a token, and a noun
      // highlighted without the する it takes always does. The token that
      // opens at the highlight and reaches past it is that word.
      const suruHost = analyzed.value.tokens.find(
        (token) =>
          token.span.start === span.start &&
          token.span.end > span.end &&
          isSuruHost(token, target),
      );
      const candidates =
        covering.length > 0 ? covering : suruHost === undefined ? [] : [[suruHost]];
      if (candidates.length === 0) {
        reasons.push({ kind: "targetAbsent" });
      } else {
        const matching = candidates.find((tiling) => {
          const head = tiling[0];
          // A conjugated target is one word to a learner and several tokens
          // to the analyzer: 聞き出した tiles as 聞き出し|た. The head carries
          // the word and the rest is its inflection, which is grammar and is
          // checked as grammar, so a span over the whole inflected form is
          // the target. Nothing is smuggled in: the tail may only be the
          // parts of speech that carry no vocabulary of their own.
          if (head !== undefined && isTargetToken(head, target)) {
            return tiling
              .slice(1)
              .every((token) =>
                dependencies.policy.transparentPartOfSpeech.has(
                  token.broadPartOfSpeech,
                ),
              );
          }
          // A compound target is the other shape: no single token is the
          // word, and the parts join to make it. It has no one part of
          // speech (間が悪い tiles noun, particle, adjective), so the joined
          // lemma and reading are the whole identity claim.
          if (tiling.length === 1) return false;
          const lemma = tiling
            .map((token) =>
              // A trailing だ on an adjective part is the copula the
              // analyzer lemmatizes with (清潔だ inside 清潔感); a null
              // reading is the surface itself (katakana モテ).
              token.broadPartOfSpeech === "adjective"
                ? adjectiveLemma(token.lemma)
                : token.lemma,
            )
            .join("");
          if (lemma !== targetLemma(target)) return false;
          // Readings are phonological, so a compound matches across kana
          // variants (モテる tiled as モテ|る).
          const reading = tiling
            .map((token) => token.reading ?? token.surface)
            .join("");
          return normalizeReading(reading) === normalizeReading(target.reading);
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
        // compound tiling the span. The target word is also itself wherever
        // it stands: a model that miscounts the span would otherwise have the
        // word it is teaching reported back as a word the learner does not
        // know, and the retry hint would tell it to avoid that very word.
        const isVocabularyTarget =
          target.kind === "vocabulary" &&
          (insideSpan(token.span, span) || isTargetToken(token, target));
        const isGrammarTargetComponent =
          target.kind === "grammar" && insideSpan(token.span, span);
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
          !(
            target.kind === "grammar" &&
            sameCanonicalForm(item.canonicalForm, target.canonicalForm)
          ) &&
          // A pattern found only within the target is the target word's own
          // morphology, not language the learner must already have. 詰める is
          // a plain る-verb, and the potential-form patterns match its める
          // tail, so a sentence teaching 詰める would be refused for leaning
          // on 可能形 it never used; a れた tail inside a passive span is the
          // same shape. かわいそう is the same shape again, reaching one
          // character past its own end into the copula.
          !(
            item.spans.length > 0 &&
            item.spans.every((found) => startsInsideSpan(found, span))
          ) &&
          !knowledge.grammar.has(item.canonicalForm),
      )
      .map((item) => item.canonicalForm);
    if (unknownGrammar.length > 0) {
      reasons.push({ kind: "unknownGrammar", canonicalForms: unique(unknownGrammar) });
    }

    return reasons.length === 0
      ? ok({
          presentation: spanned,
          normalizedJapanese,
          analyzer: dependencies.analyzer.name,
        })
      : err({ kind: "rejected", reasons });
  },
});
