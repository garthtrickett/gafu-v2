import { expect, test } from "@playwright/test";

const subtitles = `1
00:00:00,000 --> 00:00:10,000
昨日は泳いだ猫を見た。
`;

test("native copy is inert and the explicit shortcut captures one Card", async ({
  context,
  page,
}) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let watchRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/watch")) watchRequests += 1;
  });

  await page.goto("/?view=watch");
  await page.getByLabel("Choose video").setInputFiles({
    name: "local.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("browser-local-media-fixture"),
  });
  await expect(page.getByLabel("local.webm")).toHaveAttribute("src", /^blob:/u);
  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "episode.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(subtitles),
  });
  const subtitle = page.locator("[data-cue-key]");
  await expect(subtitle).toContainText("昨日は泳いだ猫を見た");
  await expect(page.getByText("Ctrl+Shift+G")).toBeVisible();

  const selectWord = async (): Promise<void> => {
    await subtitle.evaluate((element) => {
      const text = element.textContent ?? "";
      const start = text.indexOf("泳いだ");
      const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
      if (start < 0 || node === null) throw new Error("fixture word missing");
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "泳いだ".length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  };

  await selectWord();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("泳いだ");
  await page.evaluate(() => document.execCommand("copy"));
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("泳いだ");
  expect(watchRequests).toBe(0);

  await page.getByRole("button", { name: "Full screen player" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.fullscreenElement?.getAttribute("data-testid") ?? null,
      ),
    )
    .toBe("watch-stage");
  await expect(subtitle).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();

  await selectWord();
  await page.keyboard.press("Control+Shift+G");
  const panel = page.getByTestId("capture-panel");
  await expect(panel).toContainText("泳ぐ");
  await panel.getByLabel("Meaning you intend to learn").fill("to swim");
  await panel.getByRole("button", { name: "Add to SRS" }).click();
  await expect(page.getByRole("status")).toContainText("shared daily limit");

  await selectWord();
  await page.keyboard.press("Control+Shift+G");
  await expect(panel).toContainText("泳ぐ");
  await panel.getByLabel("Meaning you intend to learn").fill("to swim");
  await panel.getByRole("button", { name: "Add to SRS" }).click();
  await expect(page.getByRole("status")).toContainText(
    "already exists; its progress was kept",
  );
  expect(watchRequests).toBe(4);
});

test("a late capture response cannot replace newly loaded subtitles", async ({
  page,
}) => {
  let release = (): void => {};
  let intercepted = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/watch/capture/resolve", async (route) => {
    intercepted = true;
    await gate;
    await route.continue();
  });
  await page.goto("/?view=watch");
  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "old.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(subtitles),
  });
  const oldSubtitle = page.locator("[data-cue-key]");
  await expect(oldSubtitle).toContainText("昨日は泳いだ猫を見た");
  await oldSubtitle.evaluate((element) => {
    const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (node === null) throw new Error("subtitle node missing");
    const text = node.textContent ?? "";
    const start = text.indexOf("泳いだ");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "泳いだ".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Control+Shift+G");
  await expect.poll(() => intercepted).toBe(true);

  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "new.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(`1\n00:00:00,000 --> 00:00:10,000\n新しい字幕を読む。\n`),
  });
  release();
  await expect(page.locator("[data-cue-key]")).toContainText("新しい字幕を読む");
  await expect(page.getByTestId("capture-panel")).toHaveCount(0);
});

test("switching an ambiguous capture candidate clears the previous meaning", async ({
  page,
}) => {
  await page.goto("/?view=watch");
  await page.getByLabel("Choose Japanese SRT").setInputFiles({
    name: "ambiguous.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(subtitles),
  });
  const subtitle = page.locator("[data-cue-key]");
  await subtitle.evaluate((element) => {
    const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (node === null) throw new Error("subtitle node missing");
    const text = node.textContent ?? "";
    const start = text.indexOf("泳いだ猫");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "泳いだ猫".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Control+Shift+G");
  const panel = page.getByTestId("capture-panel");
  const choices = panel.getByRole("radio");
  await expect(choices).toHaveCount(2);
  const meaning = panel.getByLabel("Meaning you intend to learn");
  await meaning.fill("meaning for the first candidate");
  await choices.last().check();
  await expect(meaning).toHaveValue("");
});
