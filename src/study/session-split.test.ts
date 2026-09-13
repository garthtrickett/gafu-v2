import { describe, expect, test } from "bun:test";
import type { Result } from "../result.ts";
import { err, ok } from "../result.ts";
import type { CardId, CardSummary } from "./contracts.ts";
import { countSessionModes, wantsTeaching } from "./session-split.ts";

const NOW = "2026-09-12T02:00:00.000Z";

const card = (
  id: string,
  overrides: Partial<Pick<CardSummary, "state" | "dueAt" | "schedulePhase">> = {},
): CardSummary => ({
  id: id as CardId,
  type: "vocabulary",
  content: {
    lemma: id,
    reading: id,
    partOfSpeech: "verb",
    meaning: id,
    usageNotes: "",
  },
  state: "active",
  supportReadyAt: null,
  stagedAt: "2026-09-01T00:00:00.000Z",
  admittedAt: "2026-09-02T00:00:00.000Z",
  dueAt: "2026-09-12T01:00:00.000Z",
  schedulePhase: "new",
  reviewCount: 0,
  ...overrides,
});

const taughtSet =
  (taught: readonly string[]) =>
  (cardId: CardId): Result<boolean, never> =>
    ok(taught.includes(cardId));

describe("which session mode a due Card belongs to", () => {
  test("a new Card nobody has been shown yet is for Learn", () => {
    expect(wantsTeaching({ schedulePhase: "new" }, false)).toBe(true);
  });

  test("acknowledging the teaching moves it to Review without any schedule change", () => {
    expect(wantsTeaching({ schedulePhase: "new" }, true)).toBe(false);
  });

  test("a Card past its first review is for Review even with no acknowledgement", () => {
    // Legacy or imported progress: graded before teaching existed.
    expect(wantsTeaching({ schedulePhase: "learning" }, false)).toBe(false);
    expect(wantsTeaching({ schedulePhase: "review" }, false)).toBe(false);
  });
});

describe("counting the two session queues", () => {
  test("splits the due set the way Learn and Review serve it", () => {
    const counts = countSessionModes(
      [
        card("untaught-new"),
        card("taught-new"),
        card("in-review", { schedulePhase: "review" }),
      ],
      taughtSet(["taught-new"]),
      NOW,
    );
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 2, laterCount: 0 },
    });
  });

  test("Seen it moves exactly one Card from Learn to Review", () => {
    const cards = [card("a"), card("b")];
    const before = countSessionModes(cards, taughtSet([]), NOW);
    const after = countSessionModes(cards, taughtSet(["a"]), NOW);
    expect(before).toEqual({
      ok: true,
      value: { learnCount: 2, reviewCount: 0, laterCount: 0 },
    });
    expect(after).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 1, laterCount: 0 },
    });
  });

  test("only active Cards are counted, and each lands in exactly one bucket", () => {
    const counts = countSessionModes(
      [
        card("staged", { state: "staged", dueAt: null, schedulePhase: null }),
        card("suspended", { state: "suspended" }),
        card("later", { dueAt: "2026-09-13T00:00:00.000Z" }),
        card("exactly-now", { dueAt: NOW }),
      ],
      taughtSet([]),
      NOW,
    );
    // learn + review + later is the whole active set: 2 of the 5 Cards.
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 0, laterCount: 1 },
    });
  });

  test("an active Card scheduled for later is neither learn nor review, taught or not", () => {
    const cards = [
      card("later-untaught", { dueAt: "2026-09-13T00:00:00.000Z" }),
      card("later-taught", {
        dueAt: "2026-09-13T00:00:00.000Z",
        schedulePhase: "review",
      }),
    ];
    const counts = countSessionModes(cards, taughtSet(["later-taught"]), NOW);
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 0, reviewCount: 0, laterCount: 2 },
    });
  });

  test("a failed teaching read fails the count rather than guessing", () => {
    const failure = { kind: "readFailed", detail: "locked" } as const;
    const counts = countSessionModes([card("a")], () => err(failure), NOW);
    expect(counts).toEqual({ ok: false, error: failure });
  });
});
