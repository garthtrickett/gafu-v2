import { createHash } from "node:crypto";
import type { PrepareMaterial } from "./generated-contracts.ts";

export type MaterialContext = Readonly<{
  cardRevision: number;
  knowledgeRevision: number;
  targetHash: string;
}>;
export const materialContext = (input: PrepareMaterial): MaterialContext => ({
  cardRevision: input.card.materialRevision ?? 0,
  knowledgeRevision: input.knowledge.correctionRevision ?? 0,
  targetHash: createHash("sha256")
    .update(JSON.stringify(input.card.content))
    .digest("hex"),
});
export function readMaterialContext(raw: string | null): MaterialContext | null {
  if (raw === null) return null;
  try {
    const x = JSON.parse(raw) as MaterialContext;
    return Number.isSafeInteger(x.cardRevision) &&
      Number.isSafeInteger(x.knowledgeRevision) &&
      typeof x.targetHash === "string"
      ? x
      : null;
  } catch {
    return null;
  }
}
export const contextMatches = (raw: string | null, input: PrepareMaterial): boolean => {
  const actual = readMaterialContext(raw),
    expected = materialContext(input);
  return (
    !!actual &&
    actual.cardRevision === expected.cardRevision &&
    actual.knowledgeRevision === expected.knowledgeRevision &&
    actual.targetHash === expected.targetHash
  );
};
