import type { BrowserSnapshot } from "./browser.ts";

/**
 * Every field the page draws from a restored snapshot.
 *
 * A cached snapshot outlives a deploy, so one written before a field was
 * added arrives without it, and a render that reaches for that field throws
 * during the first paint — before the server's fresh answer can replace it.
 * The page then sits on "Loading your Card bank…" for ever, because the
 * throw happens inside the restore, and a reload only repeats it.
 *
 * Checking two keys by hand is what allowed that: the old guard asked for
 * `baseline` and `session`, which a stale snapshot has, and then the render
 * asked for `known`, which it does not. This is a record over the snapshot's
 * own keys instead, so adding a field to BrowserSnapshot fails the type
 * check until it is listed here, and a cache written before it is discarded
 * rather than half-trusted.
 */
const REQUIRED: Record<keyof BrowserSnapshot, true> = {
  cards: true,
  cardTotal: true,
  cardOffset: true,
  preferences: true,
  status: true,
  session: true,
  baseline: true,
  known: true,
};

/** Whether a value from the cache carries everything the page will read. */
export const isDrawableSnapshot = (value: unknown): value is BrowserSnapshot =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(REQUIRED).every((key) => key in value);
