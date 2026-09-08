export type CaptureShortcut = Readonly<{
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}>;

export const defaultCaptureShortcut = (platform: string): CaptureShortcut => ({
  control: !/Mac|iPhone|iPad/u.test(platform),
  meta: /Mac|iPhone|iPad/u.test(platform),
  alt: false,
  shift: true,
  key: "g",
});

export const shortcutLabel = (shortcut: CaptureShortcut): string =>
  [
    shortcut.control ? "Ctrl" : "",
    shortcut.meta ? "Cmd" : "",
    shortcut.alt ? "Alt" : "",
    shortcut.shift ? "Shift" : "",
    shortcut.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+");

export const isValidCaptureShortcut = (shortcut: CaptureShortcut): boolean =>
  /^[a-z0-9]$/u.test(shortcut.key) &&
  (shortcut.control || shortcut.meta) &&
  (shortcut.shift || shortcut.alt) &&
  !new Set([
    "a",
    "c",
    "f",
    "i",
    "j",
    "l",
    "n",
    "p",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
  ]).has(shortcut.key);

export const shortcutFromKeyboardEvent = (
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key">,
): CaptureShortcut => ({
  control: event.ctrlKey,
  meta: event.metaKey,
  alt: event.altKey,
  shift: event.shiftKey,
  key: event.key.toLocaleLowerCase(),
});

export const matchesCaptureShortcut = (
  event: Pick<
    KeyboardEvent,
    "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key" | "repeat"
  >,
  shortcut: CaptureShortcut,
): boolean =>
  !event.repeat &&
  event.ctrlKey === shortcut.control &&
  event.metaKey === shortcut.meta &&
  event.altKey === shortcut.alt &&
  event.shiftKey === shortcut.shift &&
  event.key.toLocaleLowerCase() === shortcut.key;
