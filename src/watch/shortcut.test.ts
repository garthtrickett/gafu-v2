import { describe, expect, test } from "bun:test";
import {
  defaultCaptureShortcut,
  isValidCaptureShortcut,
  matchesCaptureShortcut,
} from "./shortcut.ts";

describe("Watch capture shortcut", () => {
  test("uses a platform-specific exact chord", () => {
    expect(defaultCaptureShortcut("MacIntel")).toMatchObject({
      meta: true,
      control: false,
    });
    const shortcut = defaultCaptureShortcut("Linux x86_64");
    expect(
      matchesCaptureShortcut(
        {
          key: "G",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: true,
          repeat: false,
        },
        shortcut,
      ),
    ).toBe(true);
    expect(
      matchesCaptureShortcut(
        {
          key: "g",
          ctrlKey: true,
          metaKey: false,
          altKey: true,
          shiftKey: true,
          repeat: false,
        },
        shortcut,
      ),
    ).toBe(false);
    expect(
      isValidCaptureShortcut({
        control: true,
        meta: false,
        alt: false,
        shift: false,
        key: "g",
      }),
    ).toBe(false);
    expect(
      isValidCaptureShortcut({
        control: false,
        meta: false,
        alt: true,
        shift: true,
        key: "g",
      }),
    ).toBe(false);
  });

  test("never accepts the native copy chord", () => {
    expect(
      isValidCaptureShortcut({
        control: true,
        meta: false,
        alt: false,
        shift: false,
        key: "c",
      }),
    ).toBe(false);
  });
});
