import { describe, expect, test } from "bun:test";
import { newSchedule, SCHEDULER_VERSION, scheduleAnswer } from "./scheduler.ts";

describe("FSRS adapter", () => {
  test("owns deterministic initial and answer transitions", () => {
    const now = new Date("2026-09-08T10:00:00.000Z");
    const initial = newSchedule(now);
    const first = scheduleAnswer(initial, "good", now);

    expect(SCHEDULER_VERSION).toContain("FSRS-6.0");
    expect(initial).toMatchObject({ dueAt: now.toISOString(), phase: "new", reps: 0 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.phase).toBe("learning");
      expect(first.value.reps).toBe(1);
      expect(new Date(first.value.dueAt).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});
