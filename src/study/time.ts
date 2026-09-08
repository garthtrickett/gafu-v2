import { err, ok, type Result } from "../result.ts";
import type { StudyFailure } from "./contracts.ts";

export const validateTimeZone = (timeZone: string): Result<string, StudyFailure> => {
  const normalized = timeZone.trim();
  if (normalized.length === 0) {
    return err({
      kind: "invalidPreference",
      field: "timeZone",
      detail: "is required",
    });
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: normalized }).format(0);
    return ok(normalized);
  } catch {
    return err({
      kind: "invalidPreference",
      field: "timeZone",
      detail: "must be a valid IANA time zone",
    });
  }
};

export const localDayKey = (
  instant: Date,
  timeZone: string,
): Result<string, StudyFailure> => {
  if (!Number.isFinite(instant.getTime())) {
    return err({ kind: "clockFailed", detail: "clock returned an invalid date" });
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((part) => part.type === type)?.value;
    const year = read("year");
    const month = read("month");
    const day = read("day");
    if (year === undefined || month === undefined || day === undefined) {
      return err({ kind: "clockFailed", detail: "could not resolve local day" });
    }
    return ok(`${year}-${month}-${day}`);
  } catch (cause) {
    return err({
      kind: "clockFailed",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
