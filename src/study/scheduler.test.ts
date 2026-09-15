import { describe, expect, test } from "bun:test";
import { newSchedule, SCHEDULER_VERSION, scheduleAnswer } from "./scheduler.ts";

const hours = 60 * 60 * 1_000;
const days = 24 * hours;

/**
 * Answers Good at each due time until the Card leaves the learning steps.
 * `answeredAt` is when the graduating answer was given, so a caller can
 * measure the interval it earned.
 */
const graduate = (
  now: Date,
): { schedule: ReturnType<typeof newSchedule>; answeredAt: Date } => {
  let schedule = newSchedule(now);
  let at = now;
  for (let step = 0; step < 6; step += 1) {
    const next = scheduleAnswer(schedule, "good", at);
    if (!next.ok) throw new Error(next.error.kind);
    const answeredAt = at;
    schedule = next.value;
    at = new Date(schedule.dueAt);
    if (schedule.phase === "review") return { schedule, answeredAt };
  }
  throw new Error("Card never graduated");
};

describe("FSRS adapter", () => {
  test("owns deterministic initial and answer transitions", () => {
    const now = new Date("2026-09-08T10:00:00.000Z");
    const initial = newSchedule(now);
    const first = scheduleAnswer(initial, "good", now);

    expect(SCHEDULER_VERSION).toContain("FSRS-6.0");
    expect(SCHEDULER_VERSION).toContain("gafu-parameters-v3");
    expect(initial).toMatchObject({ dueAt: now.toISOString(), phase: "new", reps: 0 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.reps).toBe(1);
    }
  });

  test("a new Card is retrieved again within the hour, not in three days", () => {
    // One exposure and then nothing for days is a single massed trial: there
    // has been no successful retrieval yet for a gap to be spaced from.
    const now = new Date("2026-09-08T10:00:00.000Z");
    const first = scheduleAnswer(newSchedule(now), "good", now);
    if (!first.ok) throw new Error(first.error.kind);
    expect(first.value.phase).toBe("learning");
    const gapMs = new Date(first.value.dueAt).getTime() - now.getTime();
    expect(gapMs).toBeGreaterThan(0);
    expect(gapMs).toBeLessThanOrEqual(1 * hours);
  });

  test("a new Card graduates to the multi-day ladder once retrieved", () => {
    const now = new Date("2026-09-08T10:00:00.000Z");
    const { schedule, answeredAt } = graduate(now);
    expect(schedule.phase).toBe("review");
    // It leaves the same day behind: the first review interval is days.
    const gapMs = new Date(schedule.dueAt).getTime() - answeredAt.getTime();
    expect(gapMs).toBeGreaterThanOrEqual(1 * days);
  });

  test("a lapse on a learned Card is days away, never later today", () => {
    // Relearning is the case the learning steps do not apply to: a memory
    // that was consolidated and failed gains little from an hour's gap.
    const now = new Date("2026-09-08T10:00:00.000Z");
    const { schedule } = graduate(now);
    const later = new Date(new Date(schedule.dueAt).getTime() + 7 * days);
    const lapsed = scheduleAnswer(schedule, "again", later);
    if (!lapsed.ok) throw new Error(lapsed.error.kind);
    expect(lapsed.value.lapses).toBe(1);
    const gapMs = new Date(lapsed.value.dueAt).getTime() - later.getTime();
    expect(gapMs).toBeGreaterThanOrEqual(1 * days);
    // ...and not pushed far out either: a lapse restarts short.
    expect(gapMs).toBeLessThan(7 * days);
  });
});
