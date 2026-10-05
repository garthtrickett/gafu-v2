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

test("repairs MKV audio in the browser without uploading media", async ({ page }) => {
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET") uploads += 1;
  });
  await page.goto("/?view=watch");
  await page
    .getByLabel("Choose video")
    .setInputFiles(
      fileURLToPath(new URL("./fixtures/firefox-mkv.mkv", import.meta.url)),
    );
  await page.getByRole("button", { name: "Fix audio in Firefox" }).click();
  await expect(
    page.getByRole("button", { name: "Audio fixed", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  const audio = page.locator("[data-watch-audio]");
  await expect(audio).toHaveAttribute("src", /^blob:/u);
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).duration),
  ).toBeGreaterThan(1.9);
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).readyState),
  ).toBeGreaterThanOrEqual(1);
  expect(
    await page
      .locator("video")
      .evaluate((element) => (element as HTMLVideoElement).muted),
  ).toBe(true);
  // Loading metadata alone cannot prove that Firefox decodes and plays audio.
  // Measure PCM from the converted tone while both media clocks advance.
  await page.evaluate(async () => {
    const video = document.querySelector("video");
    const audio = document.querySelector<HTMLAudioElement>("[data-watch-audio]");
    if (video === null || audio === null) throw new Error("media elements missing");
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaElementSource(audio).connect(analyser);
    analyser.connect(context.destination);
    Object.assign(window, { repairedAudioAnalyser: analyser });
    await context.resume();
    await video.play();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const analyser = (window as unknown as { repairedAudioAnalyser: AnalyserNode })
          .repairedAudioAnalyser;
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map(Math.abs));
      }),
    )
    .toBeGreaterThan(0.01);
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0.2);
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).error),
  ).toBeNull();
  await page.locator("video").evaluate((video) => (video as HTMLVideoElement).pause());
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).paused))
    .toBe(true);
  expect(uploads).toBe(0);
});

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
