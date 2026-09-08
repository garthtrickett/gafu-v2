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
    playback.dispose();
    expect(revoked).toEqual(["blob:1", "blob:2"]);
  });
});
