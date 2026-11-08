import type { CardSummary, KnowledgeSnapshot, Study } from "../study/contracts.ts";
import type { PrepareMaterial } from "./generated-contracts.ts";

/** A synchronous final fence shared by publication and foreground consumption. */
export function currentMaterial(
  study: Study,
  input: PrepareMaterial,
  now: Date,
): boolean {
  const current = study.materialContext(input.card.id);
  return (
    current.ok &&
    current.value.card.state === "active" &&
    current.value.card.dueAt !== null &&
    current.value.card.dueAt <= now.toISOString() &&
    current.value.card.materialRevision === input.card.materialRevision &&
    current.value.knowledgeRevision === (input.knowledge.correctionRevision ?? 0) &&
    JSON.stringify(current.value.card.content) === JSON.stringify(input.card.content)
  );
}
export function cachedMaterialInput(
  study: Study,
  card: CardSummary,
  knowledge: KnowledgeSnapshot,
): PrepareMaterial {
  const input: PrepareMaterial = {
    card,
    knowledge,
    cachedOnly: true,
    isCurrent: () => currentMaterial(study, input, new Date()),
  };
  return input;
}
