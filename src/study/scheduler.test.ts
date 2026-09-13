import { describe, expect, test } from "bun:test";
import { newSchedule, SCHEDULER_VERSION, scheduleAnswer } from "./scheduler.ts";

describe("FSRS adapter", () => {
  test("owns deterministic initial and answer transitions", () => {
    const now = new Date("2026-09-08T10:00:00.000Z");
    const initial = newSchedule(now);
    const first = scheduleAnswer(initial, "good", now);

    expect(SCHEDULER_VERSION).toContain("FSRS-6.0");
    expect(SCHEDULER_VERSION).toContain("gafu-parameters-v2");
    expect(initial).toMatchObject({ dueAt: now.toISOString(), phase: "new", reps: 0 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      // No learning steps: a first success goes straight to review, tomorrow
      // at the earliest, never ten minutes from now.
      expect(first.value.phase).toBe("review");
      expect(first.value.reps).toBe(1);
      expect(new Date(first.value.dueAt).getTime()).toBeGreaterThanOrEqual(
        now.getTime() + 24 * 60 * 60 * 1_000,
      );
    }
  });

  test("a lapse is seen again tomorrow, not later today", () => {
    const now = new Date("2026-09-08T10:00:00.000Z");
    const first = scheduleAnswer(newSchedule(now), "good", now);
    if (!first.ok) throw new Error(first.error.kind);
    // A week on, the Card is forgotten.
    const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
    const lapsed = scheduleAnswer(first.value, "again", later);
    if (!lapsed.ok) throw new Error(lapsed.error.kind);
    expect(lapsed.value.lapses).toBe(1);
    const gapMs = new Date(lapsed.value.dueAt).getTime() - later.getTime();
    expect(gapMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1_000);
    // ...and not pushed far out either: a lapse restarts short.
    expect(gapMs).toBeLessThan(4 * 24 * 60 * 60 * 1_000);
  });
});
