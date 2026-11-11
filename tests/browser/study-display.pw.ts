import { expect, type Page, test } from "@playwright/test";
import type { PreparedMaterial } from "../../src/learning-material/generated-contracts.ts";
import { asCardId } from "../../src/study/contracts.ts";

// Exercise display changes with a saved session at the browser/server seam.
// These fixtures never write fake permits or Cards to the shared Study server.
const openSession = async (
  page: Page,
  mode: "teach" | "review" = "review",
): Promise<void> => {
  const items: PreparedMaterial[] = [1, 2].map((number) => ({
    id: `display-review-${number}`,
    cardId: asCardId(`display-card-${number}`),
    mode,
    source: "generated",
    audioUrl: null,
    permit:
      mode === "teach"
        ? null
        : {
            token: `display-permit-${number}`,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
    material: {
      mode,
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
      answer:
        mode === "teach"
          ? `Teaching answer ${number}`
          : "I wonder if the cat has already gone home.",
      explanation: "The speaker wonders where the cat has gone.",
      usageNote: "A familiar, conversational question.",
    },
  }));
  // This display fixture owns its saved session, independent of the shared ready cache.
  await page.route("**/api/study/preparation-status", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, ready: 0, readyCardIds: [] } });
  });
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
  if (mode === "teach") await expect(page.getByText("Teaching answer 1")).toBeVisible();
  else await expect(page.locator(".presentation .context")).toContainText("Scene 1:");
};

test("N advances a teaching Card once and ignores editing or repeated keys", async ({
  page,
}) => {
  const acknowledged: string[] = [];
  await page.route("**/api/study/session/teach", async (route) => {
    acknowledged.push(route.request().postDataJSON().cardId as string);
    await route.fulfill({ json: {} });
  });
  await openSession(page, "teach");
  const button = page.getByRole("button", { name: "Seen it — next Card", exact: true });
  await expect(button).toHaveAttribute("aria-keyshortcuts", "n");
  const search = page.getByLabel("Search", { exact: true });
  await search.fill("");
  await search.press("n");
  await expect(search).toHaveValue("n");
  await expect(page.getByText("Teaching answer 1")).toBeVisible();
  await page.evaluate(() => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    editable.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    editable.remove();
    for (const options of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }])
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", bubbles: true, ...options }),
      );
  });
  await expect(page.getByText("Teaching answer 1")).toBeVisible();
  await page.locator(".presentation .japanese").click();
  await page.keyboard.press("n");
  await expect(page.getByText("Teaching answer 2")).toBeVisible();
  await expect.poll(() => acknowledged.length).toBe(1);
  expect(acknowledged).toEqual(["display-card-1"]);
  await button.click();
  await expect.poll(() => acknowledged.length).toBe(2);
  expect(acknowledged).toEqual(["display-card-1", "display-card-2"]);
  await expect(page.getByTestId("syncing")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
});

test("N does not skip or grade a review", async ({ page }) => {
  await openSession(page);
  await page.locator(".presentation .context").click();
  await page.keyboard.press("n");
  await expect(page.locator(".presentation .context")).toContainText("Scene 1:");
  await expect(page.getByRole("button", { name: "Explanation" })).toBeVisible();
});

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

test("light theme is readable in maximised study and persists across views and reloads", async ({
  page,
}, testInfo) => {
  await openSession(page);
  const toggle = page.getByRole("button", { name: "Light theme", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Maximise study", exact: true }).click();
  await page.getByRole("button", { name: "Explanation", exact: true }).click();
  await expect(page.getByTestId("material-answer")).toBeVisible();
  const contrasts = await page.locator(".presentation").evaluate((presentation) => {
    const luminance = (color: string): number => {
      const rgb = (color.match(/[\d.]+/gu) ?? []).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
    };
    return [".context", ".japanese", ".target", "rt", ".answer-target strong"].map(
      (selector) => {
        const element = presentation.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        let ancestor: Element | null = element;
        while (
          ancestor &&
          getComputedStyle(ancestor).backgroundColor === "rgba(0, 0, 0, 0)"
        ) {
          ancestor = ancestor.parentElement;
        }
        if (!ancestor) throw new Error("No opaque study background");
        const a = luminance(getComputedStyle(element).color);
        const b = luminance(getComputedStyle(ancestor).backgroundColor);
        return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      },
    );
  });
  for (const { selector, ratio } of contrasts) {
    expect(
      ratio,
      `${selector} must stay readable on its light background`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({ path: testInfo.outputPath("light-study.png") });
  await page.getByRole("button", { name: "Exit maximised study", exact: true }).click();
  for (const view of ["read", "watch", "prepare"]) {
    await page.goto(`/?view=${view}`);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("theme still switches when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "gafu-theme")
        throw new DOMException("Storage blocked", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "gafu-theme")
        throw new DOMException("Storage blocked", "SecurityError");
      set.call(this, key, value);
    };
  });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Light theme", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
