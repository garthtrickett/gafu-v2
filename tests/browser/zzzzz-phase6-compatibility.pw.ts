import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const silentWav = (): Buffer => {
  const samples = 16_000;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
};

const subtitles = `1
00:00:00,000 --> 00:00:10,000
昨日は泳いだ猫を見た。
`;

const expectNoHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
};

// Walks three surfaces in three browsers, importing subtitles on the way, and
// Firefox is the slow one. It fits Playwright's 30s default unloaded and does
// not when anything shares the machine; the work is legitimately long.
test.setTimeout(90_000);

test("Study, Watch, and Prepare stay reachable on the supported critical surface", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Learn the Japanese your shows need." }),
  ).toBeVisible();
  const initialRenderMs = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    return navigation.domContentLoadedEventEnd - navigation.startTime;
  });
  // Keep a real browser-side ceiling without coupling the gate to Playwright's
  // cross-process polling delay on a cold Firefox launch.
  expect(initialRenderMs).toBeLessThan(5_000);
  await expectNoHorizontalOverflow(page);

  const watchLink = page.getByRole("link", { name: "Watch" });
  await watchLink.focus();
  await expect(watchLink).toBeFocused();
  expect(
    await watchLink.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await watchLink.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Watch locally. Capture deliberately." }),
  ).toBeVisible();

  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "episode.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(subtitles),
  });
  const subtitle = page.locator("[data-cue-key]");
  await expect(subtitle).toContainText("昨日は泳いだ猫を見た");
  expect(
    await subtitle.evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");
  const selected = await subtitle.evaluate((element) => {
    const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (node === null) throw new Error("subtitle node missing");
    const text = node.textContent ?? "";
    const start = text.indexOf("泳いだ");
    if (start < 0) throw new Error("fixture selection missing");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "泳いだ".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  expect(selected).toBe("泳いだ");

  const changeShortcut = page.getByRole("button", { name: "Change shortcut" });
  await changeShortcut.focus();
  await expect(changeShortcut).toBeFocused();
  await changeShortcut.press("Enter");
  await page.keyboard.press("Control+Alt+K");
  await expect(page.getByRole("status")).toContainText(
    "Capture shortcut changed to Ctrl+Alt+K",
  );
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Prepare" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Find the Japanese between you and the show.",
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Study" }).click();
  await expect(
    page.getByRole("heading", { name: "Learn the Japanese your shows need." }),
  ).toBeVisible();
});

test("local MKV sidecar audio follows seeking, speed, volume, and video replacement", async ({
  page,
}) => {
  await page.goto("/?view=watch");
  await page.getByLabel("Choose video").setInputFiles({
    name: "episode.mkv",
    mimeType: "video/x-matroska",
    buffer: Buffer.from("local-mkv-fixture"),
  });
  await expect(page.getByText("Silent MKV in Firefox?")).toBeVisible();
  await page.getByText("Choose an existing audio track").click();
  await page.getByLabel("Choose repaired audio").setInputFiles({
    name: "audio.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  await expect(page.getByRole("status")).toContainText(
    "Firefox-compatible audio is ready",
  );
  const state = await page.evaluate(() => {
    const video = document.querySelector("video");
    const audio = document.querySelector<HTMLAudioElement>("[data-watch-audio]");
    if (video === null || audio === null) throw new Error("media elements missing");
    video.currentTime = 0.6;
    video.dispatchEvent(new Event("seeking"));
    video.playbackRate = 1.5;
    video.volume = 0.4;
    return {
      videoMuted: video.muted,
      audioTime: audio.currentTime,
    };
  });
  expect(state.videoMuted).toBe(true);
  expect(state.audioTime).toBeCloseTo(0.6, 1);
  await expect
    .poll(() =>
      page
        .locator("[data-watch-audio]")
        .evaluate((audio) => (audio as HTMLAudioElement).playbackRate),
    )
    .toBe(1.5);
  await expect
    .poll(() =>
      page
        .locator("[data-watch-audio]")
        .evaluate((audio) => (audio as HTMLAudioElement).volume),
    )
    .toBe(0.4);

  await page.getByLabel("Choose video").setInputFiles({
    name: "next.mkv",
    mimeType: "video/x-matroska",
    buffer: Buffer.from("next-local-mkv-fixture"),
  });
  await expect(page.locator("[data-watch-audio]")).toHaveCount(0);
  expect(
    await page.locator("video").evaluate((video) => (video as HTMLVideoElement).muted),
  ).toBe(false);
});

for (const fixture of [
  { name: "AAC", file: "firefox-mkv.mkv", channels: 1 },
  { name: "stereo FLAC", file: "firefox-stereo-flac.mkv", channels: 2 },
]) {
  test(`repairs ${fixture.name} MKV audio in the browser without uploading media`, async ({
    page,
  }) => {
    let uploads = 0;
    page.on("request", (request) => {
      if (request.method() !== "GET") uploads += 1;
    });
    await page.goto("/?view=watch");
    await page
      .getByLabel("Choose video")
      .setInputFiles(
        fileURLToPath(new URL(`./fixtures/${fixture.file}`, import.meta.url)),
      );
    const video = page.locator("video");
    const videoDigest = () =>
      video.evaluate(async (element) => {
        const bytes = await (
          await fetch((element as HTMLVideoElement).src)
        ).arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest)).join(",");
      });
    const originalDigest = await videoDigest();
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 0.4;
    });
    await page.getByRole("button", { name: "Fix audio in Firefox" }).click();
    await expect(
      page.getByRole("button", { name: "Audio fixed", exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("[data-watch-audio]")).toHaveCount(0);
    await expect(video).toHaveAttribute("src", /^blob:/u);
    expect(
      await video.evaluate((element) => (element as HTMLVideoElement).duration),
    ).toBeGreaterThan(1.9);
    expect(await video.evaluate((element) => (element as HTMLVideoElement).muted)).toBe(
      false,
    );
    expect(
      await video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    ).toBeCloseTo(0.4, 1);
    // Require real playback and independently audible channels. A successful
    // encoder or loaded metadata alone misses the Firefox FLAC buffering bug.
    await page.evaluate(async () => {
      const video = document.querySelector("video");
      if (video === null) throw new Error("video missing");
      const context = new AudioContext();
      const splitter = context.createChannelSplitter(2);
      const merger = context.createChannelMerger(2);
      const analysers = [context.createAnalyser(), context.createAnalyser()];
      context.createMediaElementSource(video).connect(splitter);
      for (const [channel, analyser] of analysers.entries()) {
        splitter.connect(analyser, channel);
        analyser.connect(merger, 0, channel);
      }
      merger.connect(context.destination);
      Object.assign(window, { repairedAudioAnalysers: analysers });
      await context.resume();
      await video.play();
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const analysers = (
            window as unknown as { repairedAudioAnalysers: AnalyserNode[] }
          ).repairedAudioAnalysers;
          return analysers.map((analyser) => {
            const samples = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(samples);
            return samples.some((sample) => Math.abs(sample) > 0.01);
          });
        }),
      )
      .toEqual([true, fixture.channels === 2]);
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(0.6);
    expect(
      await video.evaluate((element) => (element as HTMLVideoElement).error),
    ).toBeNull();
    await video.evaluate((element) => (element as HTMLVideoElement).pause());
    expect(
      await video.evaluate((element) => (element as HTMLVideoElement).paused),
    ).toBe(true);
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 1;
    });
    await page.getByRole("button", { name: "Use original audio", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Fix audio in Firefox", exact: true }),
    ).toBeEnabled();
    await expect.poll(videoDigest).toBe(originalDigest);
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBeCloseTo(1, 1);
    expect(uploads).toBe(0);
  });
}

test("failed audio repair shows its reason beside the retry button", async ({
  page,
}) => {
  await page.goto("/?view=watch");
  await page.getByLabel("Choose video").setInputFiles({
    name: "invalid.mkv",
    mimeType: "video/x-matroska",
    buffer: Buffer.from("invalid media"),
  });
  const repair = page.getByRole("button", { name: "Fix audio in Firefox" });
  await repair.click();
  await expect(page.locator("[data-audio-repair-status]")).toContainText(
    "Audio conversion failed",
    { timeout: 45_000 },
  );
  await expect(repair).toBeEnabled();
  await page.getByText("Audio repair details", { exact: true }).click();
  await expect(
    page.getByText(/Invalid data found when processing input/u),
  ).toBeVisible();
  await page.getByText("Choose an existing audio track", { exact: true }).click();
  await page.getByLabel("Choose repaired audio").setInputFiles({
    name: "invalid.ogg",
    mimeType: "audio/ogg",
    buffer: Buffer.from("invalid audio"),
  });
  await expect(page.locator("[data-audio-repair-status]")).toContainText(
    "Firefox could not play the audio",
  );
  await expect(page.locator("[data-watch-audio]")).toHaveCount(0);
  await expect(page.getByText("Audio repair details", { exact: true })).toBeVisible();
});

test.describe("audio repair cancellation", () => {
  test.use({ serviceWorkers: "block" });

  test("audio repair can be cancelled during module loading and retried", async ({
    page,
  }) => {
    let moduleRequested = false;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*audio-repair*.js", async (route) => {
      moduleRequested = true;
      await gate;
      await route.continue().catch(() => {});
    });
    await page.goto("/?view=watch");
    await page
      .getByLabel("Choose video")
      .setInputFiles(
        fileURLToPath(new URL("./fixtures/firefox-mkv.mkv", import.meta.url)),
      );
    const repair = page.getByRole("button", { name: "Fix audio in Firefox" });
    expect(moduleRequested).toBe(false);
    await repair.click();
    await expect.poll(() => moduleRequested).toBe(true);
    await page.getByRole("button", { name: "Cancel audio repair" }).click();
    await expect(repair).toBeEnabled();
    await expect(page.locator("[data-watch-audio]")).toHaveCount(0);
    release();
    await repair.click();
    await expect(
      page.getByRole("button", { name: "Audio fixed", exact: true }),
    ).toBeVisible({ timeout: 45_000 });
  });
});

const timingBursts = [
  [6.3, 1.2],
  [9.75, 2.3],
  [15.1, 0.8],
  [18.6, 1.7],
  [23.8, 1.1],
  [27.3, 2.1],
  [33.4, 1.4],
  [38.2, 2.4],
  [42.6, 0.9],
  [47.7, 1.6],
  [51.3, 2.2],
  [56.8, 1.3],
  [60.4, 1.9],
  [65.7, 1.1],
  [70.2, 2],
  [74.8, 1.4],
] as const;
const timingSrt = (text: string, shift = 0): string =>
  timingBursts
    .map(([start, length], i) => {
      const stamp = (seconds: number): string => {
        const ms = Math.round(seconds * 1000);
        return `00:${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
      };
      return `${i + 1}\n${stamp(start - 3.3 + shift)} --> ${stamp(start + length - 3.3 + shift)}\n${text} ${i + 1}`;
    })
    .join("\n\n");

test("local subtitle analysis shares correction with Japanesified cues and exports it", async ({
  page,
}) => {
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET") uploads += 1;
  });
  await page.goto("/?view=watch");
  await page
    .getByLabel("Choose video")
    .setInputFiles(
      fileURLToPath(new URL("./fixtures/subtitle-timing.mkv", import.meta.url)),
    );
  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "japanese.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(timingSrt("猫は寝る。")),
  });
  const analyze = page.getByRole("button", {
    name: "Analyze subtitle timing",
    exact: true,
  });
  await analyze.click();
  await expect(page.locator("[data-subtitle-timing-status]")).toContainText(
    "Timing applied:",
    { timeout: 45000 },
  );
  const offset = page.getByLabel("Subtitle offset (seconds)");
  const scale = page.getByLabel("Subtitle timing scale");
  expect(Math.abs(Number(await offset.inputValue()) - 3.3)).toBeLessThan(0.3);
  expect(Math.abs(Number(await scale.inputValue()) - 1)).toBeLessThan(0.004);
  const correction = [await offset.inputValue(), await scale.inputValue()];
  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "japanesified.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(timingSrt("Cat は, sleeps よ。")),
  });
  await expect(page.locator("[data-subtitle-timing-status]")).toContainText(
    "kept the current subtitle correction",
  );
  expect([await offset.inputValue(), await scale.inputValue()]).toEqual(correction);
  await page.locator("video").evaluate((element) => {
    (element as HTMLVideoElement).currentTime = 6.6;
  });
  await expect(page.locator("[data-cue-key]")).toContainText("Cat は, sleeps よ。 1");
  await page.getByRole("button", { name: "Later 0.1s", exact: true }).click();
  expect(Number(await offset.inputValue())).toBeCloseTo(Number(correction[0]) + 0.1, 2);
  await offset.fill("1.5");
  await offset.dispatchEvent("change");
  await scale.fill("1");
  await scale.dispatchEvent("change");
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download corrected SRT" }).click();
  const download = await downloadPending;
  expect(download.suggestedFilename()).toBe("japanesified-aligned.srt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  if (stream === null) throw new Error("download stream missing");
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const output = Buffer.concat(chunks).toString("utf8");
  expect(output).toContain("00:00:04,500 --> 00:00:05,700\nCat は, sleeps よ。 1");
  expect(output.split(" --> ")).toHaveLength(17);
  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "different.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(timingSrt("犬が走る。", 1)),
  });
  await expect(offset).toHaveValue("0");
  await expect(scale).toHaveValue("1");
  await expectNoHorizontalOverflow(page);
  expect(uploads).toBe(0);
});

test.describe("subtitle analysis recovery", () => {
  test.use({ serviceWorkers: "block" });
  test("cancelled and failed analysis preserve the manual correction", async ({
    page,
  }) => {
    let moduleRequested = false;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*audio-analysis*.js", async (route) => {
      moduleRequested = true;
      await gate;
      await route.continue().catch(() => {});
    });
    await page.goto("/?view=watch");
    await page.getByLabel("Choose video").setInputFiles({
      name: "silent.mkv",
      mimeType: "video/x-matroska",
      buffer: silentWav(),
    });
    await page.getByLabel("Choose Japanese SRT").setInputFiles({
      name: "episode.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(timingSrt("猫は寝る。")),
    });
    const offset = page.getByLabel("Subtitle offset (seconds)");
    await offset.fill("0.5");
    await offset.dispatchEvent("change");
    const analyze = page.getByRole("button", {
      name: "Analyze subtitle timing",
      exact: true,
    });
    await analyze.click();
    await expect.poll(() => moduleRequested).toBe(true);
    await page.getByRole("button", { name: "Cancel subtitle analysis" }).click();
    await expect(analyze).toBeEnabled();
    release();
    await analyze.click();
    await expect(page.locator("[data-subtitle-timing-status]")).toContainText(
      "at least ten seconds",
      { timeout: 45000 },
    );
    await expect(offset).toHaveValue("0.5");
    await expect(analyze).toBeEnabled();
    await page.getByRole("button", { name: "Reset subtitle timing" }).click();
    await expect(offset).toHaveValue("0");
  });
});
