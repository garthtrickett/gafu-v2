import { err, ok, type Result } from "../result.ts";
import type {
  DecodedPresentation,
  ValidationError,
  ValidationRejection,
} from "./contracts.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

export const decodePresentation = (
  value: unknown,
): Result<DecodedPresentation, ValidationRejection> => {
  if (!isObject(value)) {
    return err({
      kind: "rejected",
      reasons: [{ kind: "malformedStructure", field: "$" }],
    });
  }

  const reasons: ValidationError[] = [];
  const japanese = value["japanese"];
  const targetSurface = value["targetSurface"];
  const targetSpan = value["targetSpan"];
  const readingSegments = value["readingSegments"];
  if (typeof japanese !== "string") {
    reasons.push({ kind: "malformedStructure", field: "japanese" });
  }
  if (typeof targetSurface !== "string") {
    reasons.push({ kind: "malformedStructure", field: "targetSurface" });
  }
  if (
    !isObject(targetSpan) ||
    typeof targetSpan["start"] !== "number" ||
    typeof targetSpan["end"] !== "number" ||
    targetSpan["unit"] !== "utf16-code-unit" ||
    targetSpan["normalization"] !== "nfkc-v1"
  ) {
    reasons.push({ kind: "malformedStructure", field: "targetSpan" });
  }
  if (
    !Array.isArray(readingSegments) ||
    readingSegments.some(
      (segment) =>
        !isObject(segment) ||
        typeof segment["written"] !== "string" ||
        typeof segment["reading"] !== "string",
    )
  ) {
    reasons.push({ kind: "malformedStructure", field: "readingSegments" });
  }
  if (reasons.length > 0) return err({ kind: "rejected", reasons });

  return ok({
    japanese: japanese as string,
    targetSurface: targetSurface as string,
    targetSpan: targetSpan as DecodedPresentation["targetSpan"],
    readingSegments: readingSegments as DecodedPresentation["readingSegments"],
  });
};
