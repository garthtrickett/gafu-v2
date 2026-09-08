import { err, ok, type Result } from "../result.ts";

export type WatchCue = Readonly<{
  cueKey: string;
  startMs: number;
  endMs: number;
  text: string;
}>;

export type WatchSubtitleTrack = Readonly<{
  episodeKey: string;
  cues: readonly WatchCue[];
}>;

export type WatchSubtitleFailure = Readonly<{
  kind: "subtitleInvalid";
  detail: string;
}>;

const maximumBytes = 4 * 1024 * 1024;
const maximumCues = 20_000;
const maximumCueText = 4_096;

const decode = (bytes: Uint8Array): Result<string, WatchSubtitleFailure> => {
  try {
    if (bytes.byteLength > maximumBytes) {
      return err({ kind: "subtitleInvalid", detail: "SRT exceeds 4 MiB." });
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return ok(new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const body = bytes.subarray(2);
      if (body.byteLength % 2 !== 0) throw new Error("invalid UTF-16BE");
      const swapped = new Uint8Array(body.byteLength);
      for (let index = 0; index < body.byteLength; index += 2) {
        swapped[index] = body[index + 1] as number;
        swapped[index + 1] = body[index] as number;
      }
      return ok(new TextDecoder("utf-16le", { fatal: true }).decode(swapped));
    }
    const body =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        ? bytes.subarray(3)
        : bytes;
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return err({
      kind: "subtitleInvalid",
      detail: "Use strict UTF-8 or BOM-labelled UTF-16 SRT.",
    });
  }
};

const timing =
  /^(\d+):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d+):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$/u;
const ms = (value: RegExpMatchArray, offset: number): number =>
  ((Number(value[offset]) * 60 + Number(value[offset + 1])) * 60 +
    Number(value[offset + 2])) *
    1_000 +
  Number(value[offset + 3]);
const normalizedText = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, "")
    .replace(/\{\\[^}]*\}/gu, "")
    .normalize("NFKC")
    .trim();

const hash = async (value: unknown): Promise<string> => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
};

export const parseWatchSrt = async (
  bytes: Uint8Array,
): Promise<Result<WatchSubtitleTrack, WatchSubtitleFailure>> => {
  const decoded = decode(bytes);
  if (!decoded.ok) return decoded;
  const source = decoded.value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (source === "") {
    return err({ kind: "subtitleInvalid", detail: "SRT is empty." });
  }
  const blocks = source.split(/\n[\t ]*\n+/u);
  if (blocks.length > maximumCues) {
    return err({ kind: "subtitleInvalid", detail: "SRT has too many cues." });
  }
  const bare: { startMs: number; endMs: number; text: string }[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = timing.test(lines[0] ?? "")
      ? 0
      : /^\s*\d+\s*$/u.test(lines[0] ?? "")
        ? 1
        : -1;
    const match = lines[timingIndex]?.match(timing) ?? null;
    const text = normalizedText(lines.slice(timingIndex + 1).join("\n"));
    if (
      timingIndex < 0 ||
      match === null ||
      text === "" ||
      text.length > maximumCueText
    ) {
      return err({ kind: "subtitleInvalid", detail: "SRT contains a malformed cue." });
    }
    const startMs = ms(match, 1);
    const endMs = ms(match, 5);
    if (endMs <= startMs) {
      return err({ kind: "subtitleInvalid", detail: "Cue end must follow its start." });
    }
    bare.push({ startMs, endMs, text });
  }
  if (
    !bare.some((cue) =>
      /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(cue.text),
    )
  ) {
    return err({ kind: "subtitleInvalid", detail: "No Japanese text was found." });
  }
  const episodeKey = `episode-v1:sha256:${await hash(bare.map((cue) => cue.text))}`;
  const occurrences = new Map<string, number>();
  const cues: WatchCue[] = [];
  for (const [index, cue] of bare.entries()) {
    const neighbourhood = JSON.stringify([
      bare[index - 1]?.text ?? "",
      cue.text,
      bare[index + 1]?.text ?? "",
    ]);
    const ordinal = (occurrences.get(neighbourhood) ?? 0) + 1;
    occurrences.set(neighbourhood, ordinal);
    cues.push({
      ...cue,
      cueKey: `cue-v1:sha256:${await hash([episodeKey, neighbourhood, ordinal])}`,
    });
  }
  return ok({ episodeKey, cues });
};

export const activeWatchCues = (
  cues: readonly WatchCue[],
  timeMs: number,
): readonly WatchCue[] =>
  cues.filter((cue) => cue.startMs <= timeMs && cue.endMs >= timeMs);
