import { err, ok, type Result } from "../result.ts";
import type { WatchCue, WatchSubtitleTrack } from "./subtitles.ts";

export type SubtitleTiming = Readonly<{ offsetSeconds: number; scale: number }>;
export const originalTiming: SubtitleTiming = { offsetSeconds: 0, scale: 1 };

export const validSubtitleTiming = (timing: SubtitleTiming): boolean =>
  Number.isFinite(timing.offsetSeconds) &&
  Math.abs(timing.offsetSeconds) <= 600 &&
  Number.isFinite(timing.scale) &&
  timing.scale >= 0.9 &&
  timing.scale <= 1.1;

export const subtitleTime = (mediaSeconds: number, timing: SubtitleTiming): number =>
  (mediaSeconds - timing.offsetSeconds) / timing.scale;

// Translation may change every word. Matching source times let a replacement
// language track share the correction without pretending its text is identical.
export const sameSubtitleTimes = (
  left: readonly WatchCue[],
  right: readonly WatchCue[],
): boolean =>
  left.length === right.length &&
  left.every(
    (cue, index) =>
      cue.startMs === right[index]?.startMs && cue.endMs === right[index]?.endMs,
  );

const timestamp = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export const correctedSrt = (
  track: WatchSubtitleTrack,
  timing: SubtitleTiming,
): Result<string, Readonly<{ kind: "timingInvalid"; detail: string }>> => {
  if (!validSubtitleTiming(timing))
    return err({
      kind: "timingInvalid",
      detail: "Use an offset within ten minutes and a speed between 0.9 and 1.1.",
    });
  const blocks: string[] = [];
  for (const [index, cue] of track.cues.entries()) {
    const start = Math.max(
      0,
      Math.round(cue.startMs * timing.scale + timing.offsetSeconds * 1000),
    );
    const end = Math.round(cue.endMs * timing.scale + timing.offsetSeconds * 1000);
    if (!Number.isSafeInteger(end) || end <= start)
      return err({
        kind: "timingInvalid",
        detail:
          "A cue would end before the video starts. Adjust the offset before downloading.",
      });
    blocks.push(`${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${cue.text}`);
  }
  return ok(`${blocks.join("\n\n")}\n`);
};
