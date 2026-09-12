import type { Result } from "../result.ts";
import { ok } from "../result.ts";
import type { CardSummary } from "./contracts.ts";

/**
 * The one rule that separates the two session modes: a due Card belongs to
 * Learn while it is still new and its teaching has never been acknowledged;
 * everything else due belongs to Review. Serving and the status tiles both
 * read this so the numbers on screen mean what the buttons do.
 */
export const wantsTeaching = (
  card: Pick<CardSummary, "schedulePhase">,
  taught: boolean,
): boolean => card.schedulePhase === "new" && !taught;

export type SessionCounts = Readonly<{ learnCount: number; reviewCount: number }>;

/**
 * Counts the due Cards each session mode would serve, from an already-read
 * Card listing. Due means active with a due time at or before `now`, the same
 * test the queue uses. Nothing is admitted or prepared here.
 */
export const countSessionModes = <Failure>(
  cards: readonly CardSummary[],
  hasTeaching: (cardId: CardSummary["id"]) => Result<boolean, Failure>,
  now: string,
): Result<SessionCounts, Failure> => {
  let learnCount = 0;
  let reviewCount = 0;
  for (const card of cards) {
    if (card.state !== "active" || card.dueAt === null || card.dueAt > now) continue;
    const taught = hasTeaching(card.id);
    if (!taught.ok) return taught;
    if (wantsTeaching(card, taught.value)) learnCount += 1;
    else reviewCount += 1;
  }
  return ok({ learnCount, reviewCount });
};
