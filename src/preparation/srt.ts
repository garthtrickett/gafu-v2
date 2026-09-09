import { createHash } from "node:crypto";
import { err, ok, type Result } from "../result.ts";
import type {
  ImportEntryRejection,
  ParsedEpisode,
  SubtitleCue,
  SubtitleImportPolicy,
} from "./import-contracts.ts";

export type SrtFailure = Readonly<{
  reason: ImportEntryRejection;
  detail: string;
}>;

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const strictDecoder = (encoding: string): TextDecoder =>
  new TextDecoder(encoding, { fatal: true });

const decodeSubtitle = (bytes: Uint8Array): Result<string, SrtFailure> => {
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return ok(strictDecoder("utf-8").decode(bytes.subarray(3)));
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return ok(strictDecoder("utf-16le").decode(bytes.subarray(2)));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const body = bytes.subarray(2);
      if (body.byteLength % 2 !== 0) throw new TypeError("odd UTF-16BE byte count");
      const swapped = new Uint8Array(body.byteLength);
      for (let index = 0; index < body.byteLength; index += 2) {
        swapped[index] = body[index + 1] as number;
        swapped[index + 1] = body[index] as number;
      }
      return ok(strictDecoder("utf-16le").decode(swapped));
    }
    return ok(strictDecoder("utf-8").decode(bytes));
  } catch {
    return err({
      reason: "unsupportedEncoding",
      detail: "Use strict UTF-8, UTF-8 BOM, or BOM-labelled UTF-16.",
    });
  }
};

const timestamp =
  /^(\d+):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d+):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$/u;

const milliseconds = (parts: RegExpMatchArray, offset: number): number =>
  ((Number(parts[offset]) * 60 + Number(parts[offset + 1])) * 60 +
    Number(parts[offset + 2])) *
    1_000 +
  Number(parts[offset + 3]);

const analysisText = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, "")
    .replace(/\{\\[^}]*\}/gu, "")
    .normalize("NFKC")
    .trim();

const hasJapanese = (value: string): boolean =>
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);

const inferTitle = (displayName: string): string => {
  const base = displayName
    .replace(/\.[^.]+$/u, "")
    .replace(/[_.]+/gu, " ")
    .trim();
  return base === "" ? "Untitled episode" : base;
};

const cueKeys = (
  episodeKey: string,
  cues: readonly Omit<SubtitleCue, "cueKey">[],
): readonly SubtitleCue[] => {
  const occurrences = new Map<string, number>();
  return cues.map((cue, index) => {
    const previous = cues[index - 1]?.normalizedText ?? "";
    const next = cues[index + 1]?.normalizedText ?? "";
    const neighbourhood = JSON.stringify([previous, cue.normalizedText, next]);
    const ordinal = (occurrences.get(neighbourhood) ?? 0) + 1;
    occurrences.set(neighbourhood, ordinal);
    return {
      ...cue,
      cueKey: `cue-v1:sha256:${sha256(JSON.stringify([episodeKey, neighbourhood, ordinal]))}`,
    };
  });
};

export const parseSrt = (
  entryId: string,
  displayName: string,
  bytes: Uint8Array,
  policy: SubtitleImportPolicy,
): Result<ParsedEpisode, SrtFailure> => {
  if (bytes.byteLength > policy.maximumSrtBytes) {
    return err({
      reason: "fileTooLarge",
      detail: `File exceeds ${policy.maximumSrtBytes} bytes.`,
    });
  }
  const decoded = decodeSubtitle(bytes);
  if (!decoded.ok) return decoded;
  const normalizedLines = decoded.value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (normalizedLines === "") {
    return err({ reason: "malformedSrt", detail: "Subtitle file is empty." });
  }
  const blocks = normalizedLines.split(/\n[\t ]*\n+/u);
  if (blocks.length > policy.maximumCuesPerFile) {
    return err({
      reason: "malformedSrt",
      detail: `File exceeds ${policy.maximumCuesPerFile} cues.`,
    });
  }
  const cues: Omit<SubtitleCue, "cueKey">[] = [];
  let sourceLine = 1;
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = timestamp.test(lines[0] ?? "")
      ? 0
      : /^\s*\d+\s*$/u.test(lines[0] ?? "")
        ? 1
        : -1;
    if (timingIndex < 0) {
      return err({
        reason: "malformedSrt",
        detail: `Expected a numeric cue label or timing near line ${sourceLine}.`,
      });
    }
    const timingLine = lines[timingIndex];
    const match = timingLine?.match(timestamp) ?? null;
    if (match === null) {
      return err({
        reason: "malformedSrt",
        detail: `Invalid cue timing near line ${sourceLine}.`,
      });
    }
    const startMs = milliseconds(match, 1);
    const endMs = milliseconds(match, 5);
    if (
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(endMs) ||
      endMs <= startMs
    ) {
      return err({
        reason: "malformedSrt",
        detail: `Cue timestamps must be safe integers and end after their start near line ${sourceLine}.`,
      });
    }
    const textLines = lines.slice(timingIndex + 1);
    const rawText = textLines.join("\n").trim();
    const normalizedText = analysisText(rawText);
    if (normalizedText === "") {
      return err({
        reason: "malformedSrt",
        detail: `Cue text is empty near line ${sourceLine}.`,
      });
    }
    if (normalizedText.length > policy.maximumCueTextLength) {
      return err({
        reason: "malformedSrt",
        detail: `Cue near line ${sourceLine} exceeds ${policy.maximumCueTextLength} characters.`,
      });
    }
    cues.push({
      sourceLabel: timingIndex === 1 ? lines[0]?.trim() || null : null,
      startMs,
      endMs,
      rawText,
      normalizedText,
    });
    sourceLine += lines.length + 1;
  }
  if (!cues.some((cue) => hasJapanese(cue.normalizedText))) {
    return err({
      reason: "notJapanese",
      detail: "No Japanese script was found in the subtitle cues.",
    });
  }
  const episodeKey = `episode-v1:sha256:${sha256(JSON.stringify(cues.map((cue) => cue.normalizedText)))}`;
  const keyedCues = cueKeys(episodeKey, cues);
  const sourceDigest = `source-v1:sha256:${sha256(
    JSON.stringify(
      keyedCues.map((cue) => [cue.startMs, cue.endMs, cue.normalizedText]),
    ),
  )}`;
  return ok({
    entryId,
    displayName,
    inferredTitle: inferTitle(displayName),
    episodeKey,
    sourceDigest,
    cues: keyedCues,
    decodedBytes: new TextEncoder().encode(decoded.value).byteLength,
  });
};
