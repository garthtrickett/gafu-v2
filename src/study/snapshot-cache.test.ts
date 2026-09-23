import { expect, test } from "bun:test";
import { isDrawableSnapshot } from "./snapshot-cache.ts";

/**
 * A snapshot cached in IndexedDB outlives a deploy. One written before a
 * field existed must be discarded, not drawn: the render reaches for the
 * field, throws inside the first paint, and the page never reaches the
 * server answer that would have replaced it.
 */
const complete = {
  cards: [],
  cardTotal: 0,
  cardOffset: 0,
  preferences: { speechEnabled: true },
  status: {},
  session: {},
  baseline: {},
  known: {},
};

test("a snapshot carrying every field the page draws is used", () => {
  expect(isDrawableSnapshot(complete)).toBe(true);
});

test("a snapshot cached before a field was added is discarded", () => {
  const { known: _dropped, ...stale } = complete;
  expect(isDrawableSnapshot(stale)).toBe(false);
});

test("a snapshot from before the voice setting is discarded", () => {
  expect(isDrawableSnapshot({ ...complete, preferences: {} })).toBe(false);
});

test("the old two-key guard is not enough on its own", () => {
  // What the guard used to ask for. Every stale cache passes this and then
  // breaks the render, which is exactly what happened in production.
  expect(isDrawableSnapshot({ baseline: {}, session: {} })).toBe(false);
});

test("nothing at all is not a snapshot", () => {
  expect(isDrawableSnapshot(undefined)).toBe(false);
  expect(isDrawableSnapshot(null)).toBe(false);
  expect(isDrawableSnapshot("snapshot")).toBe(false);
});
