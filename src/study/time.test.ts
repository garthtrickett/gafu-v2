import { describe, expect, test } from "bun:test";
import { localDayKey, validateTimeZone } from "./time.ts";

const key = (iso: string, zone: string, startsAt?: number): string => {
  const result = localDayKey(new Date(iso), zone, startsAt);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
};

describe("which study day an instant falls in", () => {
  test("a zone, not the server's clock, decides the date", () => {
    // 03:39 UTC is already lunchtime in Bali and mid-afternoon in Sydney.
    expect(key("2026-09-15T03:39:00.000Z", "UTC")).toBe("2026-09-15");
    expect(key("2026-09-15T03:39:00.000Z", "Asia/Makassar")).toBe("2026-09-15");
    // ...and the evening before, in New York.
    expect(key("2026-09-15T03:39:00.000Z", "America/New_York")).toBe("2026-09-14");
  });

  test("a day that starts at four keeps the small hours with the day before", () => {
    // Bali is UTC+8, so 04:00 local is 20:00 UTC the day before.
    const bali = "Asia/Makassar";
    // 03:59 local on the 15th: still the 14th's study day.
    expect(key("2026-09-14T19:59:00.000Z", bali, 4)).toBe("2026-09-14");
    // 04:00 local: the 15th begins.
    expect(key("2026-09-14T20:00:00.000Z", bali, 4)).toBe("2026-09-15");
    // Midday on the 15th is plainly the 15th either way.
    expect(key("2026-09-15T04:00:00.000Z", bali, 4)).toBe("2026-09-15");
    // Midnight to four would have been a new day without the setting.
    expect(key("2026-09-14T17:00:00.000Z", bali, 0)).toBe("2026-09-15");
    expect(key("2026-09-14T17:00:00.000Z", bali, 4)).toBe("2026-09-14");
  });

  test("no hour given is midnight, as it always was", () => {
    expect(key("2026-09-15T03:39:00.000Z", "Asia/Makassar")).toBe(
      key("2026-09-15T03:39:00.000Z", "Asia/Makassar", 0),
    );
  });

  test("a zone must be one the platform knows", () => {
    expect(validateTimeZone("Asia/Makassar")).toMatchObject({ ok: true });
    expect(validateTimeZone("Nowhere/Nothing")).toMatchObject({ ok: false });
  });
});
