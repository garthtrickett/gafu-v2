export type Certainty<Value> =
  | { readonly kind: "certain"; readonly value: Value }
  | { readonly kind: "ambiguous"; readonly allowed: readonly Value[] };

export type BroadPartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "particle"
  | "auxiliary"
  | "copula"
  | "interjection"
  | "symbol";

export type FixtureSpan = Readonly<{
  start: number;
  end: number;
  unit: "utf16-code-unit";
  normalization: "nfkc-v1";
}>;

export type FixtureToken = Readonly<{
  surface: string;
  span: FixtureSpan;
  lemma: Certainty<string>;
  reading: Certainty<string | null>;
  partOfSpeech: Certainty<BroadPartOfSpeech>;
  conjugation: Certainty<string | null>;
  sense: Certainty<string | null>;
  knownBehavior: "known" | "unknown" | "ambiguous" | "not-applicable";
  flags: readonly ("inflected-target" | "ambiguous-target")[];
}>;

export type GrammarEvidenceFixture = Readonly<{
  construction: string;
  spans: readonly FixtureSpan[];
}>;

export type JapaneseCueFixture = Readonly<{
  id: string;
  split: "calibration" | "holdout";
  rawText: string;
  expectedNormalized: string;
  expectedOutcome: "analyzable" | "unsupported";
  tokens: readonly FixtureToken[];
  grammar: readonly GrammarEvidenceFixture[];
  targetTokenIndex: number | null;
  riskSlices: readonly string[];
  annotationNote: string | null;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

export const fixtureSchemaErrors = (fixture: unknown): readonly string[] => {
  if (!isObject(fixture)) return ["fixture must be an object"];

  const errors: string[] = [];
  const requiredStrings = [
    "id",
    "split",
    "rawText",
    "expectedNormalized",
    "expectedOutcome",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof fixture[field] !== "string") errors.push(`${field} must be a string`);
  }
  if (!Array.isArray(fixture["tokens"])) errors.push("tokens must be an array");
  if (!Array.isArray(fixture["grammar"])) errors.push("grammar must be an array");
  if (!Array.isArray(fixture["riskSlices"])) errors.push("riskSlices must be an array");

  const tokens = Array.isArray(fixture["tokens"]) ? fixture["tokens"] : [];
  for (const [index, token] of tokens.entries()) {
    if (!isObject(token)) {
      errors.push(`tokens[${index}] must be an object`);
      continue;
    }
    if (typeof token["surface"] !== "string") {
      errors.push(`tokens[${index}].surface must be a string`);
    }
    if (!isObject(token["span"])) errors.push(`tokens[${index}].span is required`);
    for (const field of ["lemma", "reading", "partOfSpeech", "conjugation", "sense"]) {
      if (!isObject(token[field])) errors.push(`tokens[${index}].${field} is required`);
    }
    if (typeof token["knownBehavior"] !== "string") {
      errors.push(`tokens[${index}].knownBehavior is required`);
    }
  }
  return errors;
};
