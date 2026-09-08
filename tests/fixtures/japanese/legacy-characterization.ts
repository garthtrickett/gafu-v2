export type LegacyCharacterization = Readonly<{
  id: string;
  kind:
    | "degraded-token-success"
    | "sense-blind-identity"
    | "catalogue-only-grammar"
    | "normalization-span-drift"
    | "non-bmp-offset-drift"
    | "reading-reconstruction-mismatch"
    | "partial-target-match"
    | "silent-batch-omission";
  legacyBehavior: string;
  v2Requirement: string;
}>;

export const legacyCharacterizationCases: readonly LegacyCharacterization[] = [
  {
    id: "legacy-analyzer-load-fallback",
    kind: "degraded-token-success",
    legacyBehavior:
      "A dictionary load failure can yield coarse regex tokens that look usable.",
    v2Requirement: "Return a typed degraded failure with no trusted tokens.",
  },
  {
    id: "legacy-vocabulary-sense-collapse",
    kind: "sense-blind-identity",
    legacyBehavior:
      "Lemma, reading, and part of speech can collapse different meanings into one identity.",
    v2Requirement:
      "Preserve sense ambiguity as evidence until Card identity is decided.",
  },
  {
    id: "legacy-known-alias-only-grammar",
    kind: "catalogue-only-grammar",
    legacyBehavior:
      "Grammar matching can find only aliases already present in a catalogue.",
    v2Requirement:
      "Distinguish deterministic known matching from new-grammar proposals.",
  },
  {
    id: "legacy-nfkc-target-offset",
    kind: "normalization-span-drift",
    legacyBehavior:
      "A target span calculated before NFKC can point at the wrong text after it.",
    v2Requirement:
      "Version normalization and index every target span in normalized text.",
  },
  {
    id: "legacy-astral-character-offset",
    kind: "non-bmp-offset-drift",
    legacyBehavior:
      "Code-point counting around emoji disagrees with JavaScript string slicing.",
    v2Requirement:
      "Declare UTF-16 code units and reconstruct the exact surface at every span.",
  },
  {
    id: "legacy-furigana-reconstruction",
    kind: "reading-reconstruction-mismatch",
    legacyBehavior:
      "Generated reading segments can omit source text yet pass provider decoding.",
    v2Requirement:
      "Reject segments unless their written surfaces exactly rebuild the Japanese.",
  },
  {
    id: "legacy-partial-card-target",
    kind: "partial-target-match",
    legacyBehavior:
      "A surface or span can name only part of the requested vocabulary or grammar.",
    v2Requirement:
      "Map the complete observed target span back to the intended canonical Card.",
  },
  {
    id: "legacy-fixed-batch-truncation",
    kind: "silent-batch-omission",
    legacyBehavior:
      "A fixed candidate batch can succeed while later candidates are never issued.",
    v2Requirement: "Prove expected-input completeness before reporting a run complete.",
  },
];
