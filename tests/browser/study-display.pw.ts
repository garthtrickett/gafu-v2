import { expect, type Page, test } from "@playwright/test";
import type { PreparedMaterial } from "../../src/learning-material/generated-contracts.ts";
import { asCardId } from "../../src/study/contracts.ts";

// Exercise display changes with a saved session at the browser/server seam.
// These fixtures never write fake permits or Cards to the shared Study server.
const openSession = async (page: Page): Promise<void> => {
  const items: PreparedMaterial[] = [1, 2].map((number) => ({
    id: `display-review-${number}`,
    cardId: asCardId(`display-card-${number}`),
    mode: "review",
    source: "generated",
    audioUrl: null,
    permit: {
      token: `display-permit-${number}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    material: {
      mode: "review",
      targetKind: "vocabulary",
      context: `Scene ${number}: Two friends are looking for their cat near the river. One friend asks whether it has already gone home.`,
      prompt: "What does the sentence mean?",
      japanese: "猫はもう家に帰ったかな。",
      targetSurface: "猫",
      targetSpan: {
        start: 0,
        end: 1,
        unit: "utf16-code-unit",
        normalization: "nfkc-v1",
      },
      readingSegments: [
        { written: "猫", reading: "ねこ" },
        { written: "はもう", reading: "はもう" },
        { written: "家", reading: "いえ" },
        { written: "に", reading: "に" },
        { written: "帰った", reading: "かえった" },
        { written: "かな。", reading: "かな。" },
      ],
      target: { lemma: "猫", reading: "ねこ", partOfSpeech: "noun", meaning: "cat" },
      answer: "I wonder if the cat has already gone home.",
      explanation: "The speaker wonders where the cat has gone.",
      usageNote: "A familiar, conversational question.",
    },
  }));
  await page.route("**/api/study/review-batch/active", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/study/session/resume", (route) =>
    route.fulfill({ json: { eligibleIds: items.map((item) => item.id) } }),
  );
  await page.route("**/api/study/session/answer", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/dictionary/jisho?*", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("tile-review")).toBeVisible();
  await page.evaluate(async (saved) => {
    const opened = indexedDB.open("gafu-v2-study", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("kv", "readwrite");
      transaction.objectStore("kv").put({ items: saved, index: 0 }, "session");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, items);
  await page.reload();
  await expect(page.locator(".presentation .context")).toContainText("Scene 1:");
};

const expectViewportLayout = async (page: Page): Promise<void> => {
  const layout = await page.locator(".study-shell").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      contentWidth: element.scrollWidth,
    };
  });
  expect(layout.x).toBe(0);
  expect(layout.y).toBe(0);
  expect(layout.width).toBeCloseTo(layout.viewportWidth, 0);
  expect(layout.height).toBeCloseTo(layout.viewportHeight, 0);
  expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
};

test("maximised study works when browser fullscreen is denied and stays open through a batch", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { get: () => true });
    HTMLElement.prototype.requestFullscreen = async () => {
      throw new DOMException("Fullscreen unavailable", "NotAllowedError");
    };
  });
  await openSession(page);
  const shell = page.locator(".study-shell");
  const hero = page.getByRole("heading", {
    name: "Learn the Japanese your shows need.",
  });
  await expect(page.getByText("Highlight a word, then press Alt")).toHaveCount(0);
  const gap = await page.locator(".presentation").evaluate((element) => {
    const heading = element.querySelector(".presentation-heading");
    const context = element.querySelector(".context");
    if (!heading || !context) throw new Error("Missing study heading/context");
    return context.getBoundingClientRect().top - heading.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(23);
  expect(
    await page
      .locator(".study-display-toggle path")
      .evaluate((path) => path.namespaceURI),
  ).toBe("http://www.w3.org/2000/svg");

  await page.getByRole("button", { name: "Maximise study", exact: true }).click();
  await expect(shell).toHaveClass(/study-shell--maximised/u);
  await expectViewportLayout(page);
  await expect(hero).toBeHidden();
  await expect(page.getByLabel("New Cards per Day")).toBeHidden();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await page.screenshot({ path: testInfo.outputPath("maximised-study.png") });

  // The dictionary remains available. Its Escape closes only the lookup.
  await page.locator(".japanese .target").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Alt");
  await expect(page.getByTestId("jisho-lookup")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("jisho-lookup")).toHaveCount(0);
  await expect(shell).toHaveClass(/study-shell--maximised/u);

  await page.keyboard.press("e");
  await expect(page.getByTestId("material-answer")).toBeVisible();
  await page.getByRole("button", { name: "Correct", exact: true }).click();
  await expect(page.locator(".presentation .context")).toContainText("Scene 2:");
  await expect(shell).toHaveClass(/study-shell--maximised/u);
  await expect(page.getByTestId("material-answer")).toHaveCount(0);
  await page.route("**/api/study/session/answer", (route) =>
    route.fulfill({ status: 401, json: { error: { kind: "authenticationRequired" } } }),
  );
  await page.getByRole("button", { name: "Explanation", exact: true }).click();
  await page.getByRole("button", { name: "Incorrect", exact: true }).click();
  await expect(page.getByTestId("sync-auth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare batch" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Exit maximised study" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shell).not.toHaveClass(/study-shell--maximised/u);
  await expect(hero).toBeVisible();
});

test("maximised review starts at the card when batch messages arrive", async ({
  page,
}) => {
  await openSession(page);
  await page.getByRole("button", { name: "Maximise study", exact: true }).click();

  // A batch can report failures while a review is already open. Exercise the
  // real fullscreen CSS without changing the session's own state.
  await page.evaluate(() => {
    const panel = document.querySelector(".review-panel");
    const presentation = panel?.querySelector(".presentation");
    const notice = document.querySelector(".study-session-notices > .notice");
    if (!panel || !presentation || !notice) throw new Error("Missing review UI");
    notice.textContent = "No Cards were prepared.";
    notice.classList.add("notice--error");
    const failures = document.createElement("ul");
    failures.className = "batch-failures";
    failures.textContent = "A Card stays due.";
    panel.insertBefore(failures, presentation);
    const progress = document.createElement("p");
    progress.dataset["testid"] = "batch-progress";
    progress.textContent = "Batch ready: 18 to review, 2 failed.";
    panel.insertBefore(progress, presentation);
    const sync = document.createElement("p");
    sync.className = "notice notice--error notice--sync";
    sync.textContent = "Your sign-in expired.";
    document.querySelector(".study-session-notices")?.append(sync);
  });
  await expect(page.getByText("No Cards were prepared.")).toBeHidden();
  await expect(page.locator(".batch-failures")).toBeHidden();
  await expect(page.getByTestId("batch-progress")).toBeHidden();
  await expect(page.getByText("Your sign-in expired.")).toBeVisible();
  const positions = await page.evaluate(() => ({
    header: document.querySelector(".presentation-heading")?.getBoundingClientRect(),
    sync: document.querySelector(".notice--sync")?.getBoundingClientRect(),
  }));
  expect(positions.header?.top).toBeLessThan(80);
  expect(positions.sync?.top).toBeGreaterThan(positions.header?.bottom ?? 0);
});

test("native fullscreen and short viewports keep study and its exit reachable", async ({
  page,
}) => {
  await openSession(page);
  await page.setViewportSize({ width: 740, height: 360 });
  const supported = await page.evaluate(() => document.fullscreenEnabled);
  await page.getByRole("button", { name: "Maximise study", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Exit maximised study" }),
  ).toBeVisible();
  if (supported) {
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.fullscreenElement?.classList.contains("study-shell"),
        ),
      )
      .toBe(true);
    // Browser UI exits fullscreen without dispatching our key handler.
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator(".study-shell")).not.toHaveClass(
      /study-shell--maximised/u,
    );
    await page.getByRole("button", { name: "Maximise study", exact: true }).click();
  }
  await expectViewportLayout(page);
  await page.getByRole("button", { name: "Explanation", exact: true }).click();
  await page.getByTestId("suspend-current").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("suspend-current")).toBeInViewport();
  const exit = page.getByRole("button", { name: "Exit maximised study" });
  await exit.click();
  await expect(page.locator(".study-shell")).not.toHaveClass(/study-shell--maximised/u);
  await expect(
    page.getByRole("button", { name: "Maximise study", exact: true }),
  ).toBeFocused();
});
