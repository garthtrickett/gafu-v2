import { describe, expect, test } from "bun:test";
import { parseWatchSrt } from "./subtitles.ts";
import {
  correctedSrt,
  originalTiming,
  sameSubtitleTimes,
  subtitleTime,
} from "./timing.ts";
import { audioActivity, estimateSubtitleTiming } from "./timing-alignment.ts";

const parse = async (text: string) => {
  const parsed = await parseWatchSrt(new TextEncoder().encode(text));
  if (!parsed.ok) throw new Error(parsed.error.detail);
  return parsed.value;
};

describe("subtitle timing", () => {
  test("rejects unavailable signal and ambiguous repeated activity", () => {
    const cues = Array.from({ length: 18 }, (_, i) => ({
      startMs: 20000 + i * 5000,
      endMs: 21000 + i * 5000,
    }));
    expect(estimateSubtitleTiming(new Float32Array(1400), cues).ok).toBe(false);
    expect(estimateSubtitleTiming(new Float32Array([Number.NaN]), cues).ok).toBe(false);
    const periodic = Float32Array.from({ length: 1400 }, (_, i) =>
      i % 50 < 10 ? 1 : 0,
    );
    const result = estimateSubtitleTiming(periodic, cues);
    expect(result.ok && result.value.reliable).toBe(false);
  });

  for (const [offsetSeconds, scale] of [
    [3.7, 1.001],
    [-4.2, 25 / 24],
  ] as const) {
    test(`recovers ${offsetSeconds}s offset and ${scale} drift independently of cue text`, () => {
      const cues = Array.from({ length: 64 }, (_, i) => ({
        startMs: Math.round((12 + i * 8.13 + (i % 7) * 0.63) * 1000),
        endMs: Math.round((13.2 + i * 8.13 + (i % 7) * 0.63 + (i % 4) * 0.39) * 1000),
      }));
      const activity = Float32Array.from(
        { length: 6000 },
        (_, i) => 0.03 + (i % 13) / 1000,
      );
      for (const cue of cues) {
        const start = Math.round(((cue.startMs / 1000) * scale + offsetSeconds) * 10);
        const end = Math.round(((cue.endMs / 1000) * scale + offsetSeconds) * 10);
        activity.fill(0.9, start, end);
      }
      const result = estimateSubtitleTiming(activity, cues);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.reliable).toBe(true);
      expect(Math.abs(result.value.timing.offsetSeconds - offsetSeconds)).toBeLessThan(
        0.25,
      );
      expect(Math.abs(result.value.timing.scale - scale)).toBeLessThan(0.001);
      const translated = cues.map((cue) => ({
        ...cue,
        text: "I は, cake を eat よ。",
      }));
      expect(estimateSubtitleTiming(activity, translated)).toEqual(result);
    });
  }

  test("PCM activity uses byte offsets, little endian, and preserves silence", () => {
    const pcm = new Uint8Array(16000 + 10);
    const view = new DataView(pcm.buffer);
    for (let i = 1600; i < 4800; i += 2) view.setInt16(i + 10, 12000, true);
    const trace = audioActivity(pcm.subarray(10));
    expect(trace.length).toBe(10);
    expect(trace[0]).toBe(0);
    expect(trace[1]).toBe(1);
    expect(trace[9]).toBe(0);
    expect([...audioActivity(new Uint8Array(16000))]).toEqual(Array(10).fill(0));
  });

  test("export transfers the same affine timing to kana translation without rewriting evidence", async () => {
    const japanese = await parse(
      "1\n00:00:02,000 --> 00:00:03,000\n猫は寝る。\n\n2\n00:00:04,000 --> 00:00:05,000\n魚を食べる。\n",
    );
    const translated = await parse(
      "1\n00:00:02,000 --> 00:00:03,000\nCat は, sleeps。\n\n2\n00:00:04,000 --> 00:00:05,000\nFish を\neats。\n",
    );
    const saved = structuredClone(japanese);
    expect(sameSubtitleTimes(japanese.cues, translated.cues)).toBe(true);
    const timing = { offsetSeconds: 0.3, scale: 1.025 };
    const exported = correctedSrt(translated, timing);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value).toContain("00:00:02,350 --> 00:00:03,375\nCat は, sleeps。");
    const corrected = await parse(exported.value);
    expect(corrected.episodeKey).toBe(translated.episodeKey);
    expect(corrected.cues.map((cue) => cue.cueKey)).toEqual(
      translated.cues.map((cue) => cue.cueKey),
    );
    expect(corrected.cues.map((cue) => cue.text)).toEqual(
      translated.cues.map((cue) => cue.text),
    );
    expect(sameSubtitleTimes(japanese.cues, corrected.cues)).toBe(false);
    expect(japanese).toEqual(saved);
    expect(subtitleTime(2.35, timing)).toBeCloseTo(2);
    expect(subtitleTime(5, originalTiming)).toBe(5);
    expect(correctedSrt(japanese, { offsetSeconds: -10, scale: 1 }).ok).toBe(false);
    expect(correctedSrt(japanese, { offsetSeconds: Number.NaN, scale: 1 }).ok).toBe(
      false,
    );
  });
});
