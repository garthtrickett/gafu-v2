import { err, ok, type Result } from "../result.ts";
import type { SubtitleTiming } from "./timing.ts";

export type CueTime = Readonly<{ startMs: number; endMs: number }>;
export type TimingEstimate = Readonly<{
  timing: SubtitleTiming;
  reliable: boolean;
  correlation: number;
}>;
export type TimingFailure = Readonly<{
  kind: "insufficientSignal";
  detail: string;
}>;

// A 10 Hz activity trace is small even for a whole episode. Log RMS suppresses
// large volume differences; silence remains zero rather than becoming speech.
export const audioActivity = (pcm: Uint8Array): Float32Array => {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frames = Math.floor(pcm.byteLength / 1600); // mono 8 kHz, s16le
  const levels = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let power = 0;
    for (let sample = 0; sample < 800; sample += 1) {
      const value = view.getInt16(frame * 1600 + sample * 2, true) / 32768;
      power += value * value;
    }
    levels[frame] = Math.log1p(100 * Math.sqrt(power / 800));
  }
  const sorted = levels.slice().sort();
  const quiet = sorted[Math.floor(frames * 0.1)] ?? 0;
  const loud = sorted[Math.floor(frames * 0.95)] ?? 0;
  const range = loud - quiet;
  if (range < 0.001) return new Float32Array(frames);
  return levels.map((level) => Math.max(0, Math.min(1, (level - quiet) / range)));
};

// Correlate occupied subtitle intervals with audio activity. Text is never an
// input: Japanese and its Japanesified translation get the exact same result.
// Run this bounded search in a worker so playback and cancellation stay usable.
export const estimateSubtitleTiming = (
  activity: Float32Array,
  rawCues: readonly CueTime[],
): Result<TimingEstimate, TimingFailure> => {
  const useful = rawCues
    .filter(
      (cue) =>
        Number.isFinite(cue.startMs) &&
        Number.isFinite(cue.endMs) &&
        cue.startMs >= 0 &&
        cue.endMs - cue.startMs >= 200 &&
        cue.endMs - cue.startMs <= 12000,
    )
    .sort((a, b) => a.startMs - b.startMs);
  if (
    activity.length < 100 ||
    activity.length > 144000 ||
    useful.length < 8 ||
    activity.some((value) => !Number.isFinite(value))
  ) {
    return err({
      kind: "insufficientSignal",
      detail:
        "Alignment needs at least ten seconds of audio and eight dialogue cues (up to four hours of audio).",
    });
  }
  // Use evenly spread cues at series scale. Merging overlaps prevents double
  // counting simultaneous speakers in the subtitle occupancy measurement.
  const selected =
    useful.length <= 400
      ? useful
      : Array.from(
          { length: 400 },
          (_, index) => useful[Math.floor((index * useful.length) / 400)] as CueTime,
        );
  const spans: { start: number; end: number }[] = [];
  for (const cue of selected) {
    const last = spans.at(-1);
    if (last !== undefined && cue.startMs / 1000 <= last.end)
      last.end = Math.max(last.end, cue.endMs / 1000);
    else spans.push({ start: cue.startMs / 1000, end: cue.endMs / 1000 });
  }
  const sums = new Float64Array(activity.length + 1);
  let squares = 0;
  for (let index = 0; index < activity.length; index += 1) {
    const value = activity[index] as number;
    sums[index + 1] = (sums[index] as number) + value;
    squares += value * value;
  }
  const mean = (sums[activity.length] as number) / activity.length;
  const variance = squares / activity.length - mean * mean;
  if (variance < 0.0001)
    return err({
      kind: "insufficientSignal",
      detail:
        "The audio has too little changing activity to find a reliable offset. Use the manual offset.",
    });
  const score = (timing: SubtitleTiming): number => {
    let occupied = 0;
    let energy = 0;
    let included = 0;
    for (const span of spans) {
      const begin = Math.round((span.start * timing.scale + timing.offsetSeconds) * 10);
      const finish = Math.round((span.end * timing.scale + timing.offsetSeconds) * 10);
      const start = Math.max(0, Math.min(activity.length, begin));
      const end = Math.max(start, Math.min(activity.length, finish));
      if (end > start) included += 1;
      occupied += end - start;
      energy += (sums[end] as number) - (sums[start] as number);
    }
    const fraction = occupied / activity.length;
    if (included < spans.length * 0.85 || fraction <= 0 || fraction >= 1) return -1;
    return (
      (energy / activity.length - fraction * mean) /
      Math.sqrt(variance * fraction * (1 - fraction))
    );
  };
  type Fit = { timing: SubtitleTiming; correlation: number };
  const fits: Fit[] = [];
  const scales = new Set([1, 24 / 25, 25 / 24, 1000 / 1001, 1001 / 1000]);
  for (let index = 0; index <= 40; index += 1) scales.add(0.96 + index * 0.002);
  for (const scale of scales) {
    for (let offsetSeconds = -180; offsetSeconds <= 180; offsetSeconds += 0.5) {
      const timing = { scale, offsetSeconds };
      fits.push({ timing, correlation: score(timing) });
    }
  }
  fits.sort((a, b) => b.correlation - a.correlation);
  let best = fits[0] as Fit;
  for (const seed of fits.slice(0, 6)) {
    for (let step = -8; step <= 8; step += 1) {
      for (let tick = -10; tick <= 10; tick += 1) {
        const timing = {
          scale: seed.timing.scale + step * 0.00025,
          offsetSeconds: seed.timing.offsetSeconds + tick * 0.05,
        };
        const correlation = score(timing);
        if (correlation > best.correlation) best = { timing, correlation };
      }
    }
  }
  const lastTime = spans.at(-1)?.end ?? 0;
  const competing = fits.find(
    (fit) =>
      Math.abs(fit.timing.offsetSeconds - best.timing.offsetSeconds) > 2 ||
      Math.abs(
        (fit.timing.scale - best.timing.scale) * lastTime +
          fit.timing.offsetSeconds -
          best.timing.offsetSeconds,
      ) > 2,
  );
  return ok({
    timing: {
      offsetSeconds: Math.round(best.timing.offsetSeconds * 100) / 100,
      scale: Math.round(best.timing.scale * 1000000) / 1000000,
    },
    correlation: best.correlation,
    reliable:
      best.correlation >= 0.15 &&
      best.correlation - (competing?.correlation ?? 0) >= 0.025,
  });
};
