import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { err, ok, type Result } from "../result.ts";
import type { GeneratedMaterial } from "./generated-contracts.ts";

const broadParts: readonly BroadPartOfSpeech[] = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "particle",
  "auxiliary",
  "copula",
  "interjection",
  "symbol",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isString = (record: Record<string, unknown>, field: string): boolean =>
  typeof record[field] === "string" && (record[field] as string).trim() !== "";

export const decodeGeneratedMaterial = (
  value: unknown,
): Result<
  GeneratedMaterial,
  { readonly kind: "malformedResponse"; readonly detail: string }
> => {
  if (!isRecord(value) || !isRecord(value["target"])) {
    return err({ kind: "malformedResponse", detail: "material is not an object" });
  }
  const required = [
    "context",
    "prompt",
    "japanese",
    "targetSurface",
    "answer",
    "explanation",
    "usageNote",
  ];
  if (!required.every((field) => isString(value, field))) {
    return err({
      kind: "malformedResponse",
      detail: "material has a missing text field",
    });
  }
  if (value["mode"] !== "teach" && value["mode"] !== "review") {
    return err({ kind: "malformedResponse", detail: "material has an invalid mode" });
  }
  const span = value["targetSpan"];
  if (
    !isRecord(span) ||
    !Number.isInteger(span["start"]) ||
    !Number.isInteger(span["end"]) ||
    span["unit"] !== "utf16-code-unit" ||
    span["normalization"] !== "nfkc-v1"
  ) {
    return err({
      kind: "malformedResponse",
      detail: "material has an invalid target span",
    });
  }
  const segments = value["readingSegments"];
  if (
    !Array.isArray(segments) ||
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !isRecord(segment) ||
        typeof segment["written"] !== "string" ||
        typeof segment["reading"] !== "string",
    )
  ) {
    return err({
      kind: "malformedResponse",
      detail: "material has invalid reading segments",
    });
  }
  const target = value["target"];
  if (value["targetKind"] === "vocabulary") {
    if (
      !isString(target, "lemma") ||
      !isString(target, "reading") ||
      !isString(target, "meaning") ||
      !broadParts.includes(target["partOfSpeech"] as BroadPartOfSpeech)
    ) {
      return err({
        kind: "malformedResponse",
        detail: "material has invalid vocabulary target metadata",
      });
    }
  } else if (value["targetKind"] === "grammar") {
    if (
      !isString(target, "canonicalForm") ||
      !isString(target, "meaning") ||
      !isString(target, "formationHint")
    ) {
      return err({
        kind: "malformedResponse",
        detail: "material has invalid grammar target metadata",
      });
    }
  } else {
    return err({
      kind: "malformedResponse",
      detail: "material has an invalid target kind",
    });
  }
  return ok(value as GeneratedMaterial);
};

export const parseBroadPartOfSpeech = (value: string): BroadPartOfSpeech | null => {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase();
  const exact = broadParts.find((part) => normalized === part);
  if (exact !== undefined) return exact;
  // Prefer the most specific label when a provider includes explanatory text.
  // In particular, "adverb" contains "verb".
  return (
    [...broadParts]
      .sort((left, right) => right.length - left.length)
      .find((part) => normalized.includes(part)) ?? null
  );
};
