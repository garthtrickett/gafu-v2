import { expect, test } from "@playwright/test";

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

test("Study, Watch, and Prepare stay reachable on the supported critical surface", async ({
  page,
}) => {
  const started = performance.now();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Learn the Japanese your shows need." }),
  ).toBeVisible();
  expect(performance.now() - started).toBeLessThan(3_000);
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
