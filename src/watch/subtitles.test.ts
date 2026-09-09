import { describe, expect, test } from "bun:test";
import { episodeOne } from "../../tests/fixtures/preparation/subtitles.ts";
import { activeWatchCues, parseWatchSrt } from "./subtitles.ts";

describe("Watch subtitles", () => {
  test("uses Phase 3 content identities and inclusive active boundaries", async () => {
    const parsed = await parseWatchSrt(new TextEncoder().encode(episodeOne));
    if (!parsed.ok) throw new Error(parsed.error.detail);
    expect(parsed.value.episodeKey).toStartWith("episode-v1:sha256:");
    expect(
      parsed.value.cues.every((cue) => cue.cueKey.startsWith("cue-v1:sha256:")),
    ).toBe(true);
    const first = parsed.value.cues[0];
    if (first === undefined) throw new Error("fixture has no cue");
    expect(activeWatchCues(parsed.value.cues, first.startMs)).toContain(first);
    expect(activeWatchCues(parsed.value.cues, first.endMs)).toContain(first);
  });

  test("preserves multiline text but never markup", async () => {
    const source = `1\n00:00:01,000 --> 00:00:03,000\n<b>猫</b>です。\n二行目。\n`;
    const parsed = await parseWatchSrt(new TextEncoder().encode(source));
    expect(parsed).toMatchObject({
      ok: true,
      value: { cues: [{ text: "猫です。\n二行目。" }] },
    });
  });

  test("rejects malformed and non-Japanese files", async () => {
    expect(await parseWatchSrt(new TextEncoder().encode("bad"))).toMatchObject({
      ok: false,
      error: { kind: "subtitleInvalid" },
    });
    expect(
      await parseWatchSrt(
        new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nhello\n"),
      ),
    ).toMatchObject({ ok: false, error: { kind: "subtitleInvalid" } });
    expect(
      await parseWatchSrt(
        new TextEncoder().encode(
          "1\n9999999999:00:00,000 --> 10000000000:00:00,000\n日本語\n",
        ),
      ),
    ).toMatchObject({ ok: false, error: { kind: "subtitleInvalid" } });
  });

  test("finds overlapping cues through the indexed playback query", async () => {
    const parsed = await parseWatchSrt(
      new TextEncoder().encode(
        "1\n00:00:01,000 --> 00:00:10,000\n長い字幕\n\n2\n00:00:05,000 --> 00:00:06,000\n短い字幕\n",
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error.detail);
    expect(activeWatchCues(parsed.value.cues, 5_500).map((cue) => cue.text)).toEqual([
      "長い字幕",
      "短い字幕",
    ]);
    expect(activeWatchCues(parsed.value.cues, 9_000).map((cue) => cue.text)).toEqual([
      "長い字幕",
    ]);
  });
});
