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

/**
 * Every active Card lands in exactly one bucket: due and awaiting its first
 * look (learn), due and awaiting a quiz (review), or scheduled for later.
 * The three sum to the active count, so the tiles partition the deck.
 */
export type SessionCounts = Readonly<{
  learnCount: number;
  reviewCount: number;
  laterCount: number;
  /**
   * How many due Cards have no sentence banked for the mode they want.
   *
   * This is the only honest measure of what preparing would cost: a Card
   * holding a reserve is served without asking the provider for anything.
   * A background tab prepares while this is above zero and stops when it is
   * not, so an idle tab spends nothing.
   */
  unpreparedCount: number;
}>;

/**
 * Buckets the active Cards from an already-read Card listing. Due means a
 * due time at or before `now`, the same test the queue uses. Nothing is
 * admitted or prepared here.
 */
export const countSessionModes = <Failure>(
  cards: readonly CardSummary[],
  hasTeaching: (cardId: CardSummary["id"]) => Result<boolean, Failure>,
  now: string,
  /** Whether a sentence is already banked for that Card in that mode. */
  hasReserve: (cardId: CardSummary["id"], mode: "teach" | "review") => boolean,
): Result<SessionCounts, Failure> => {
  let learnCount = 0;
  let reviewCount = 0;
  let laterCount = 0;
  let unpreparedCount = 0;
  for (const card of cards) {
    if (card.state !== "active") continue;
    if (card.dueAt === null || card.dueAt > now) {
      laterCount += 1;
      continue;
    }
    const taught = hasTeaching(card.id);
    if (!taught.ok) return taught;
    const mode = wantsTeaching(card, taught.value) ? "teach" : "review";
    if (mode === "teach") learnCount += 1;
    else reviewCount += 1;
    if (!hasReserve(card.id, mode)) unpreparedCount += 1;
  }
  return ok({ learnCount, reviewCount, laterCount, unpreparedCount });
};

/**
 * Answers of Again in a row after which a Card is worth a look.
 *
 * A Card that keeps failing is either too hard for where the learner is or
 * broken in a way the validator cannot see — a wrong sense, a meaning that
 * does not match the word. Either way the queue is not the place to find
 * out, and six sessions of failing is enough to say so. Nothing is
 * suspended automatically: which of the two it is, only a person can tell.
 */
export const STUCK_AFTER_FAILURES = 6;

export const isStuck = (card: { consecutiveFailures: number }): boolean =>
  card.consecutiveFailures >= STUCK_AFTER_FAILURES;
