import { describe, expect, test } from "bun:test";
import {
  buildZip,
  episodeOne,
  episodeTwo,
} from "../../tests/fixtures/preparation/subtitles.ts";
import { createSubtitleImportInspector } from "./import.ts";
import { phase3ImportPolicy } from "./import-contracts.ts";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const inspect = createSubtitleImportInspector(phase3ImportPolicy);

describe("safe Subtitle Set import inspection", () => {
  test("direct files and equivalent ZIP produce identical episode evidence", async () => {
    const direct = await inspect.inspect(
      {
        mode: "direct",
        files: [
          { name: "show-01.srt", bytes: encode(episodeOne) },
          { name: "show-02.srt", bytes: encode(episodeTwo) },
        ],
      },
      "direct-token",
      new Date("2026-09-08T00:00:00Z"),
    );
    const archive = await inspect.inspect(
      {
        mode: "zip",
        archive: {
          name: "show.zip",
          bytes: buildZip([
            { name: "show-01.srt", text: episodeOne },
            { name: "show-02.srt", text: episodeTwo },
          ]),
        },
      },
      "zip-token",
      new Date("2026-09-08T00:00:00Z"),
    );
    expect(direct.ok).toBe(true);
    expect(archive.ok).toBe(true);
    if (!direct.ok || !archive.ok) return;
    expect(
      archive.value.episodes.map(({ entryId: _entryId, ...episode }) => episode),
    ).toEqual(
      direct.value.episodes.map(({ entryId: _entryId, ...episode }) => episode),
    );
  });

  test("orders episodes naturally instead of trusting upload order", async () => {
    const result = await inspect.inspect(
      {
        mode: "direct",
        files: [
          { name: "show-10.srt", bytes: encode(episodeTwo) },
          { name: "show-2.srt", bytes: encode(episodeOne) },
        ],
      },
      "order-token",
      new Date("2026-09-08T00:00:00Z"),
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value.episodes.map((episode) => episode.displayName)).toEqual([
      "show-2.srt",
      "show-10.srt",
    ]);
  });

  test("renaming, renumbering, and shifted timing preserve cue identity", async () => {
    const shifted = episodeOne
      .replace(/^1$/mu, "88")
      .replace(/^2$/mu, "99")
      .replace("00:00:01,000 --> 00:00:03,000", "00:01:01,000 --> 00:01:03,000")
      .replace("00:00:04,000 --> 00:00:06,000", "00:01:04,000 --> 00:01:06,000");
    const first = await inspect.inspect(
      { mode: "direct", files: [{ name: "old.srt", bytes: encode(episodeOne) }] },
      "a",
      new Date(),
    );
    const second = await inspect.inspect(
      { mode: "direct", files: [{ name: "renamed.srt", bytes: encode(shifted) }] },
      "b",
      new Date(),
    );
    if (!first.ok || !second.ok) throw new Error("fixture import failed");
    expect(second.value.episodes[0]?.episodeKey).toBe(
      first.value.episodes[0]?.episodeKey,
    );
    expect(second.value.episodes[0]?.sourceDigest).not.toBe(
      first.value.episodes[0]?.sourceDigest,
    );
    expect(second.value.episodes[0]?.cues.map((cue) => cue.cueKey)).toEqual(
      first.value.episodes[0]?.cues.map((cue) => cue.cueKey),
    );
  });

  test("reports bad siblings and semantic duplicates without losing valid files", async () => {
    const result = await inspect.inspect(
      {
        mode: "direct",
        files: [
          { name: "good.srt", bytes: encode(episodeOne) },
          { name: "copy.srt", bytes: encode(episodeOne) },
          { name: "notes.txt", bytes: encode("not subtitles") },
          { name: "bad.srt", bytes: encode("not an srt") },
        ],
      },
      "token",
      new Date(),
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value.report.acceptedCount).toBe(1);
    expect(result.value.report.duplicateCount).toBe(1);
    expect(result.value.report.rejectedCount).toBe(2);
    expect(result.value.episodes).toHaveLength(1);
  });

  test("rejects corrupt and encrypted archive entries independently", async () => {
    const result = await inspect.inspect(
      {
        mode: "zip",
        archive: {
          name: "mixed.zip",
          bytes: buildZip([
            { name: "good.srt", text: episodeOne },
            { name: "corrupt.srt", text: episodeTwo, corruptCrc: true },
            { name: "encrypted.srt", text: episodeTwo, flags: 1 },
            { name: "readme.txt", text: "metadata" },
          ]),
        },
      },
      "token",
      new Date(),
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value.report.acceptedCount).toBe(1);
    expect(result.value.report.rejectedCount).toBe(3);
    const reasons = result.value.report.entries.flatMap((entry) =>
      entry.outcome === "accepted" ? [] : [entry.reason],
    );
    expect(reasons).toContain("corruptArchiveEntry");
    expect(reasons).toContain("encrypted");
  });

  test("accepts data descriptors and isolates inconsistent local headers", async () => {
    const result = await inspect.inspect(
      {
        mode: "zip",
        archive: {
          name: "headers.zip",
          bytes: buildZip([
            { name: "descriptor.srt", text: episodeOne, dataDescriptor: true },
            { name: "mismatch.srt", text: episodeTwo, localFlags: 4 },
          ]),
        },
      },
      "header-token",
      new Date(),
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value.report.acceptedCount).toBe(1);
    expect(result.value.report.rejectedCount).toBe(1);
    expect(result.value.report.entries[1]).toMatchObject({
      outcome: "rejected",
      reason: "corruptArchiveEntry",
    });
  });

  test("strict decoding rejects replacement-character evidence", async () => {
    const result = await inspect.inspect(
      {
        mode: "direct",
        files: [{ name: "legacy.srt", bytes: Uint8Array.of(0xff, 0x00, 0xff) }],
      },
      "token",
      new Date(),
    );
    expect(result).toEqual({ ok: false, error: { kind: "noAcceptedFiles" } });
  });

  test("enforces archive and entry-count bounds before parsing", async () => {
    const tinyPolicy = {
      ...phase3ImportPolicy,
      maximumArchiveBytes: 10,
      maximumEntries: 1,
    };
    const tiny = createSubtitleImportInspector(tinyPolicy);
    const archive = await tiny.inspect(
      { mode: "zip", archive: { name: "show.zip", bytes: new Uint8Array(11) } },
      "token",
      new Date(),
    );
    expect(archive).toEqual({
      ok: false,
      error: { kind: "archiveTooLarge", maximumBytes: 10 },
    });
    const direct = await tiny.inspect(
      {
        mode: "direct",
        files: [
          { name: "one.srt", bytes: encode(episodeOne) },
          { name: "two.srt", bytes: encode(episodeTwo) },
        ],
      },
      "token",
      new Date(),
    );
    expect(direct).toEqual({
      ok: false,
      error: { kind: "entryLimitExceeded", maximum: 1 },
    });
  });

  test("keeps bounded malformed archive fuzz cases inside typed failures", async () => {
    let state = 0x5eed1234;
    const nextByte = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state & 0xff;
    };
    for (let caseNumber = 0; caseNumber < 128; caseNumber += 1) {
      const bytes = Uint8Array.from({ length: caseNumber * 2 }, () => nextByte());
      const result = await inspect.inspect(
        { mode: "zip", archive: { name: "fuzz.zip", bytes } },
        `fuzz-${caseNumber}`,
        new Date("2026-09-08T00:00:00Z"),
      );
      expect(result.ok).toBe(false);
    }
  });
});
