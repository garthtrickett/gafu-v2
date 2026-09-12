/**
 * Builds the teaching presentation a Card is first shown with.
 *
 * The sentence is written when the Card is made rather than generated at study
 * time, so first exposure is immediate and costs nothing. It passes the same
 * validator as generated material, which requires the analyzer to find the
 * target at the given span with the Card's exact lemma, reading and part of
 * speech. Building it with that same analyzer here means a sentence that
 * assembles locally will validate on the server.
 *
 * That constrains the sentence: `token.reading` is the reading of the surface,
 * not of the dictionary form, so a Card for 詰める (つめる) needs a sentence
 * with 詰める rather than 詰めて, whose reading is つめ.
 */
import type { BroadPartOfSpeech, JapaneseAnalyzer } from "../src/analysis/contracts.ts";
import { declaredGrammarDetector } from "../src/learning-material/declared-grammar.ts";
import {
  adjectiveLemma,
  normalizeReading,
} from "../src/learning-material/validator.ts";
import { alignFurigana } from "../src/study/furigana.ts";

export type AuthoredCard = Readonly<{
  type: "vocabulary" | "grammar";
  lemma?: string;
  reading?: string;
  partOfSpeech?: string;
  canonicalForm?: string;
  meaning: string;
  usageNotes: string;
  formation?: string;
  /** The sentence to teach from, using the word in the sense the Card means. */
  example: string;
}>;

export type BuildFailure = Readonly<{ reason: string }>;

/** What the learner already knows, as the validator will see it. */
export type Knowledge = Readonly<{
  vocabulary: readonly Readonly<{
    lemma: string;
    reading: string;
    partOfSpeech: string | null;
  }>[];
  grammar: ReadonlySet<string>;
}>;

// The validator ignores these when deciding whether the supporting language is
// known, so neither does this.
const transparent = new Set<BroadPartOfSpeech>([
  "particle",
  "auxiliary",
  "copula",
  "symbol",
]);

/**
 * Everything in the sentence besides the target that the learner does not
 * already know. A teaching sentence may only lean on language they have.
 *
 * Matched on lemma, reading and part of speech together, because the validator
 * does. `token.reading` is the reading of the surface, so a supporting word in
 * an inflected form will not match its own dictionary entry -- which is why
 * these sentences keep to plain forms.
 */
const unsupported = (
  tokens: readonly Readonly<{
    surface: string;
    lemma: string;
    reading: string | null;
    broadPartOfSpeech: BroadPartOfSpeech;
    span: Readonly<{ start: number; end: number }>;
  }>[],
  japanese: string,
  knowledge: Knowledge,
  targetSpan: Readonly<{ start: number; end: number }>,
): readonly string[] => {
  const known = new Set(
    knowledge.vocabulary.map(
      (word) => `${word.lemma}\u0000${word.reading}\u0000${word.partOfSpeech ?? ""}`,
    ),
  );
  const words = tokens
    .filter(
      (token) =>
        !transparent.has(token.broadPartOfSpeech) &&
        !(token.span.start >= targetSpan.start && token.span.end <= targetSpan.end) &&
        !known.has(
          `${token.lemma}\u0000${token.reading ?? ""}\u0000${token.broadPartOfSpeech}`,
        ),
    )
    .map((token) => token.surface);
  const forms = declaredGrammarDetector
    .detect(japanese)
    // Mirrors the validator: a pattern found only inside the target is the
    // target word's own morphology, not language the learner must already
    // have. 詰める is a plain る-verb whose める tail matches 可能形.
    .filter(
      (item) =>
        !item.spans.every(
          (span) => span.start >= targetSpan.start && span.end <= targetSpan.end,
        ),
    )
    .map((item) => item.canonicalForm)
    .filter((form) => !knowledge.grammar.has(form));
  return [...new Set([...words, ...forms])];
};

export const buildTeaching = async (
  analyzer: JapaneseAnalyzer,
  card: AuthoredCard,
  knowledge: Knowledge,
): Promise<{ value: Record<string, unknown> } | BuildFailure> => {
  const analyzed = await analyzer.analyze("authored-teaching", card.example);
  if (!analyzed.ok) return { reason: `the sentence could not be analyzed` };
  const japanese = analyzed.value.normalizedText;

  const readingSegments = analyzed.value.tokens.map((token) => ({
    written: token.surface,
    reading: token.reading ?? token.surface,
  }));
  if (readingSegments.map((segment) => segment.written).join("") !== japanese) {
    return { reason: "tokens do not rejoin into the sentence" };
  }

  const shared = {
    mode: "teach",
    japanese,
    readingSegments,
    // Every text field must be non-empty, so a Card without usage notes falls
    // back to its meaning rather than assembling material the decoder rejects.
    usageNote: card.usageNotes.trim() === "" ? card.meaning : card.usageNotes,
  };

  if (card.type === "vocabulary") {
    // The validator compares concatenated lemma and reading over whatever
    // tokens tile the span, so find the tiling that already agrees rather
    // than assuming the target is one token. A な-adjective stem lemmatizes
    // with its copula (肝心だ), which the validator strips for the
    // comparison; a compound (飼育員 as 飼育|員) matches by concatenation.
    const tokens = analyzed.value.tokens;
    let span: { start: number; end: number } | null = null;
    for (let begin = 0; begin < tokens.length && span === null; begin += 1) {
      const tiling: (typeof tokens)[number][] = [];
      for (let end = begin; end < tokens.length; end += 1) {
        const token = tokens[end];
        const previous = tiling[tiling.length - 1];
        if (token === undefined) break;
        if (previous !== undefined && token.span.start !== previous.span.end) break;
        tiling.push(token);
        const lemma = tiling
          .map((part) =>
            part.broadPartOfSpeech === "adjective"
              ? adjectiveLemma(part.lemma)
              : part.lemma,
          )
          .join("");
        const reading = tiling.map((part) => part.reading ?? part.surface).join("");
        if (lemma !== card.lemma) continue;
        const readingMatches =
          tiling.length === 1
            ? reading === card.reading
            : normalizeReading(reading) === normalizeReading(card.reading ?? "");
        if (!readingMatches) continue;
        if (tiling.length === 1) {
          const only = tiling[0];
          if (only === undefined || only.broadPartOfSpeech !== card.partOfSpeech)
            continue;
        }
        const first = tiling[0];
        if (first === undefined) continue;
        span = { start: first.span.start, end: token.span.end };
        break;
      }
    }
    if (span === null) {
      return {
        reason: `no token in the sentence reads as ${card.lemma}/${card.reading}/${card.partOfSpeech}`,
      };
    }
    const missing = unsupported(analyzed.value.tokens, japanese, knowledge, span);
    if (missing.length > 0) {
      return { reason: `leans on language not yet known: ${missing.join(", ")}` };
    }
    return {
      value: {
        ...shared,
        context: `${card.lemma} in use.`,
        prompt: `${card.lemma} (${card.reading}) — ${card.meaning}.`,
        targetKind: "vocabulary",
        targetSurface: japanese.slice(span.start, span.end),
        targetSpan: {
          start: span.start,
          end: span.end,
          unit: "utf16-code-unit",
          normalization: "nfkc-v1",
        },
        answer: `${card.lemma}（${card.reading}）— ${card.meaning}`,
        explanation: card.meaning,
        target: {
          lemma: card.lemma,
          reading: card.reading,
          partOfSpeech: card.partOfSpeech,
          meaning: card.meaning,
        },
      },
    };
  }

  const at = japanese.indexOf(card.canonicalForm ?? "");
  if (at < 0) return { reason: "the sentence does not contain the form" };
  const span = { start: at, end: at + (card.canonicalForm ?? "").length };
  const missingForGrammar = unsupported(
    analyzed.value.tokens,
    japanese,
    {
      ...knowledge,
      grammar: new Set([...knowledge.grammar, card.canonicalForm ?? ""]),
    },
    span,
  );
  if (missingForGrammar.length > 0) {
    return {
      reason: `leans on language not yet known: ${missingForGrammar.join(", ")}`,
    };
  }
  return {
    value: {
      ...shared,
      context: `${card.canonicalForm} in use.`,
      prompt: `${card.canonicalForm} — ${card.meaning}.`,
      targetKind: "grammar",
      targetSurface: card.canonicalForm,
      targetSpan: {
        start: at,
        end: at + (card.canonicalForm ?? "").length,
        unit: "utf16-code-unit",
        normalization: "nfkc-v1",
      },
      answer: `${card.canonicalForm} — ${card.meaning}`,
      explanation: card.meaning,
      target: {
        canonicalForm: card.canonicalForm,
        meaning: card.meaning,
        formationHint: card.formation ?? "",
      },
    },
  };
};

/** The sentence with its readings, for showing what was built. */
export const preview = (value: Record<string, unknown>): string =>
  (value["readingSegments"] as { written: string; reading: string }[])
    .map((segment) =>
      alignFurigana(segment.written, segment.reading)
        .map((piece) =>
          piece.reading === null ? piece.text : `${piece.text}[${piece.reading}]`,
        )
        .join(""),
    )
    .join("");
