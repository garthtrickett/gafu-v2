import { describe, expect, test } from "bun:test";
import { createLocalPlayback } from "./playback.ts";

describe("local Watch playback", () => {
  test("revokes replaced and disposed object URLs", () => {
    const revoked: string[] = [];
    let next = 0;
    const playback = createLocalPlayback({
      create: () => `blob:${++next}`,
      revoke: (url) => revoked.push(url),
    });
    expect(playback.replaceVideo({ name: "one.webm" } as File).url).toBe("blob:1");
    expect(playback.replaceVideo({ name: "two.mp4" } as File).url).toBe("blob:2");
    expect(playback.replaceAudio({ name: "one.ogg" } as File)).toBe("blob:3");
    expect(playback.replaceAudio({ name: "two.ogg" } as File)).toBe("blob:4");
    expect(playback.replaceVideo({ name: "three.mkv" } as File).url).toBe("blob:5");
    expect(playback.replaceAudio({ name: "three.ogg" } as File)).toBe("blob:6");
    playback.dispose();
    expect(revoked).toEqual([
      "blob:1",
      "blob:3",
      "blob:2",
      "blob:4",
      "blob:5",
      "blob:6",
    ]);
  });
});
