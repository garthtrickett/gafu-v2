import type {
  BroadPartOfSpeech,
  Certainty,
  FixtureSpan,
  FixtureToken,
  JapaneseCueFixture,
} from "./schema.ts";

export type TokenSeed = Omit<FixtureToken, "span">;
export type CuePiece = TokenSeed | string;

export const certain = <Value>(value: Value): Certainty<Value> => ({
  kind: "certain",
  value,
});

export const ambiguous = <Value>(...allowed: readonly Value[]): Certainty<Value> => ({
  kind: "ambiguous",
  allowed,
});

export const word = (
  surface: string,
  lemma: string,
  reading: string,
  partOfSpeech: BroadPartOfSpeech,
  options: Readonly<{
    conjugation?: string;
    known?: "known" | "unknown" | "ambiguous";
    senses?: readonly string[];
    flags?: readonly ("inflected-target" | "ambiguous-target")[];
  }> = {},
): TokenSeed => ({
  surface,
  lemma: certain(lemma),
  reading: certain(reading),
  partOfSpeech: certain(partOfSpeech),
  conjugation: certain(options.conjugation ?? null),
  sense:
    options.senses === undefined
      ? certain(null)
      : options.senses.length === 1
        ? certain(options.senses[0] ?? null)
        : ambiguous(...options.senses),
  knownBehavior: options.known ?? "known",
  flags: options.flags ?? [],
});

export const punctuation = (surface: string): TokenSeed => ({
  surface,
  lemma: certain(surface),
  reading: certain(null),
  partOfSpeech: certain("symbol"),
  conjugation: certain(null),
  sense: certain(null),
  knownBehavior: "not-applicable",
  flags: [],
});

const isToken = (piece: CuePiece): piece is TokenSeed => typeof piece !== "string";

const span = (start: number, end: number): FixtureSpan => ({
  start,
  end,
  unit: "utf16-code-unit",
  normalization: "nfkc-v1",
});

export const cue = (
  input: Readonly<{
    id: string;
    split: "calibration" | "holdout";
    pieces: readonly CuePiece[];
    construction?: string;
    grammarTokenRange?: readonly [start: number, endExclusive: number];
    targetTokenIndex?: number;
    rawText?: string;
    riskSlices?: readonly string[];
    annotationNote?: string;
  }>,
): JapaneseCueFixture => {
  let offset = 0;
  const tokens: FixtureToken[] = [];
  let normalized = "";

  for (const piece of input.pieces) {
    if (isToken(piece)) {
      const start = offset;
      normalized += piece.surface;
      offset += piece.surface.length;
      tokens.push({ ...piece, span: span(start, offset) });
    } else {
      normalized += piece;
      offset += piece.length;
    }
  }

  const rawText = input.rawText ?? normalized;
  if (rawText.normalize("NFKC") !== normalized) {
    throw new Error(`${input.id}: raw text does not normalize to expected text`);
  }

  const grammar = (() => {
    if (input.construction === undefined || input.grammarTokenRange === undefined)
      return [];
    const [startIndex, endIndex] = input.grammarTokenRange;
    const first = tokens[startIndex];
    const last = tokens[endIndex - 1];
    if (first === undefined || last === undefined) {
      throw new Error(`${input.id}: grammar token range is outside the cue`);
    }
    return [
      {
        construction: input.construction,
        spans: [span(first.span.start, last.span.end)],
      },
    ];
  })();

  return {
    id: input.id,
    split: input.split,
    rawText,
    expectedNormalized: normalized,
    expectedOutcome: "analyzable",
    tokens,
    grammar,
    targetTokenIndex: input.targetTokenIndex ?? null,
    riskSlices: input.riskSlices ?? [],
    annotationNote: input.annotationNote ?? null,
  };
};

export const unsupportedCue = (
  id: string,
  rawText: string,
  note: string,
): JapaneseCueFixture => ({
  id,
  split: "calibration",
  rawText,
  expectedNormalized: rawText.normalize("NFKC"),
  expectedOutcome: "unsupported",
  tokens: [],
  grammar: [],
  targetTokenIndex: null,
  riskSlices: ["unsupported"],
  annotationNote: note,
});
