import { describe, expect, test } from "bun:test";
import { attemptAsync, err, ok } from "./result.ts";

describe("Result", () => {
  test("constructs success and failure values", () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(err("nope")).toEqual({ ok: false, error: "nope" });
  });

  test("captures exceptions at an async boundary", async () => {
    const result = await attemptAsync(
      async () => {
        throw new Error("provider secret must not escape");
      },
      () => ({ kind: "unavailable" as const }),
    );

    expect(result).toEqual({ ok: false, error: { kind: "unavailable" } });
  });
});
