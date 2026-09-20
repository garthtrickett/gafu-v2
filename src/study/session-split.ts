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
  const rotation = stuckRotation(cards, now);
  for (const card of cards) {
    if (card.state !== "active") continue;
    if (card.dueAt === null || card.dueAt > now) {
      laterCount += 1;
      continue;
    }
    // A stuck Card past the rotation is due and waiting, not due and owed:
    // counting it here would ask for work the queue will not hand out.
    if (isStuck(card) && !rotation.has(card.id)) {
      laterCount += 1;
      continue;
    }
    const taught = hasTeaching(card.id);
    if (!taught.ok) return taught;
    const mode = wantsTeaching(card, taught.value) ? "teach" : "review";
    if (mode === "teach") learnCount += 1;
    else reviewCount += 1;
    // A word Card is served from the Card itself, so there is nothing to
    // prepare and nothing preparing it would buy.
    if (card.stage !== "word" && !hasReserve(card.id, mode)) unpreparedCount += 1;
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
export const STUCK_AFTER_FAILURES = 3;

export const isStuck = (card: { consecutiveFailures: number }): boolean =>
  card.consecutiveFailures >= STUCK_AFTER_FAILURES;

/**
 * How many stuck Cards may be worked at once.
 *
 * A Card that keeps failing needs to be met several times a day, and meeting
 * thirty of them several times a day is how a day stops being study. Weak
 * traces also compete: a small set worked hard is the shape intensive
 * language therapy takes, and the evidence there is that the same hours
 * spread thinner do worse. The rest are not suspended and not lost — they
 * wait, and take a slot as the ones ahead of them come right.
 */
export const STUCK_ROTATION_LIMIT = 8;

type Rotatable = Readonly<{
  id: string;
  state: string;
  dueAt: string | null;
  consecutiveFailures: number;
}>;

/**
 * Which stuck Cards may be worked right now, by id.
 *
 * Deterministic on the Cards and the instant, so the queue and the tiles
 * agree without sharing a query: both apply this to the same deck and get
 * the same answer. Oldest due first, so a Card waits its turn rather than
 * losing its place to whichever was answered last.
 */
export const stuckRotation = (
  cards: readonly Rotatable[],
  now: string,
): ReadonlySet<string> => {
  const waiting = cards
    .filter(
      (card) =>
        card.state === "active" &&
        card.dueAt !== null &&
        card.dueAt <= now &&
        isStuck(card),
    )
    .sort((left, right) =>
      left.dueAt === right.dueAt
        ? left.id.localeCompare(right.id)
        : (left.dueAt ?? "").localeCompare(right.dueAt ?? ""),
    );
  return new Set(waiting.slice(0, STUCK_ROTATION_LIMIT).map((card) => card.id));
};
