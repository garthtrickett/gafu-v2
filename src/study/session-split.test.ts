import { describe, expect, test } from "bun:test";
import type { Result } from "../result.ts";
import { err, ok } from "../result.ts";
import type { CardId, CardSummary } from "./contracts.ts";
import {
  countSessionModes,
  STUCK_ROTATION_LIMIT,
  stuckRotation,
  wantsTeaching,
} from "./session-split.ts";

const NOW = "2026-09-12T02:00:00.000Z";

const card = (
  id: string,
  overrides: Partial<
    Pick<
      CardSummary,
      "state" | "dueAt" | "schedulePhase" | "consecutiveFailures" | "consecutiveCorrect"
    >
  > = {},
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
  consecutiveFailures: 0,
  consecutiveCorrect: 0,
  ...overrides,
});

const taughtSet =
  (taught: readonly string[]) =>
  (cardId: CardId): Result<boolean, never> =>
    ok(taught.includes(cardId));

/** Nothing is banked, so every due Card counts as unprepared. */
const nothingBanked = (): boolean => false;

const bankedFor =
  (banked: readonly string[]) =>
  (cardId: CardId): boolean =>
    banked.includes(cardId);

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
      nothingBanked,
    );
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 2, laterCount: 0, unpreparedCount: 3 },
    });
  });

  test("Seen it moves exactly one Card from Learn to Review", () => {
    const cards = [card("a"), card("b")];
    const before = countSessionModes(cards, taughtSet([]), NOW, nothingBanked);
    const after = countSessionModes(cards, taughtSet(["a"]), NOW, nothingBanked);
    expect(before).toEqual({
      ok: true,
      value: { learnCount: 2, reviewCount: 0, laterCount: 0, unpreparedCount: 2 },
    });
    expect(after).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 1, laterCount: 0, unpreparedCount: 2 },
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
      nothingBanked,
    );
    // learn + review + later is the whole active set: 2 of the 5 Cards.
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 0, laterCount: 1, unpreparedCount: 1 },
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
    const counts = countSessionModes(
      cards,
      taughtSet(["later-taught"]),
      NOW,
      nothingBanked,
    );
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 0, reviewCount: 0, laterCount: 2, unpreparedCount: 0 },
    });
  });

  test("a failed teaching read fails the count rather than guessing", () => {
    const failure = { kind: "readFailed", detail: "locked" } as const;
    const counts = countSessionModes(
      [card("a")],
      () => err(failure),
      NOW,
      nothingBanked,
    );
    expect(counts).toEqual({ ok: false, error: failure });
  });
});

describe("how much of the due work still needs a sentence", () => {
  test("a due Card holding a reserve costs nothing to prepare", () => {
    const cards = [
      card("banked"),
      card("bare"),
      card("banked-review", { schedulePhase: "review" }),
    ];
    const counts = countSessionModes(
      cards,
      taughtSet(["banked-review"]),
      NOW,
      bankedFor(["banked", "banked-review"]),
    );
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 2, reviewCount: 1, laterCount: 0, unpreparedCount: 1 },
    });
  });

  test("a reserve in the wrong mode does not prepare the Card", () => {
    // The Card wants teaching; what is banked is a review sentence. Asking
    // by mode is the whole point: a review reserve cannot be a first look.
    const counts = countSessionModes(
      [card("untaught")],
      taughtSet([]),
      NOW,
      (_cardId, mode) => mode === "review",
    );
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 1, reviewCount: 0, laterCount: 0, unpreparedCount: 1 },
    });
  });

  test("Cards not yet due are never counted as unprepared", () => {
    const counts = countSessionModes(
      [card("later", { dueAt: "2026-09-13T00:00:00.000Z" })],
      taughtSet([]),
      NOW,
      nothingBanked,
    );
    expect(counts).toEqual({
      ok: true,
      value: { learnCount: 0, reviewCount: 0, laterCount: 1, unpreparedCount: 0 },
    });
  });
});

describe("only so many stuck Cards are worked at once", () => {
  const stuck = (id: string, dueAt: string) =>
    card(id, {
      dueAt,
      consecutiveFailures: 4,
      consecutiveCorrect: 0,
      schedulePhase: "review",
    });

  test("the oldest due take the slots, and the rest wait their turn", () => {
    const cards = Array.from({ length: STUCK_ROTATION_LIMIT + 4 }, (_, index) =>
      stuck(`c${index}`, `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    );
    const rotation = stuckRotation(cards, NOW);
    expect(rotation.size).toBe(STUCK_ROTATION_LIMIT);
    // Oldest due first, so a Card keeps its place rather than losing it to
    // whichever was answered last.
    const oldest = [...cards]
      .sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? ""))
      .slice(0, STUCK_ROTATION_LIMIT)
      .map((item) => item.id);
    expect([...rotation].sort()).toEqual([...oldest].sort());
  });

  test("a Card that is not yet due takes no slot", () => {
    const later = card("later", {
      dueAt: "2099-01-01T00:00:00.000Z",
      consecutiveFailures: 9,
      consecutiveCorrect: 0,
    });
    expect(stuckRotation([later], NOW).size).toBe(0);
  });

  test("a stuck Card past the rotation counts as later, not as due", () => {
    const cards = Array.from({ length: STUCK_ROTATION_LIMIT + 3 }, (_, index) =>
      stuck(`c${index}`, "2026-09-11T00:00:00.000Z"),
    );
    const counts = countSessionModes(cards, taughtSet([]), NOW, nothingBanked);
    expect(counts).toMatchObject({
      ok: true,
      value: { reviewCount: STUCK_ROTATION_LIMIT, laterCount: 3 },
    });
    // The tiles must agree with the queue: a Card counted due that the queue
    // will not hand out is work the learner is told to do and cannot.
    if (counts.ok) {
      expect(counts.value.reviewCount + counts.value.laterCount).toBe(cards.length);
    }
  });
});
