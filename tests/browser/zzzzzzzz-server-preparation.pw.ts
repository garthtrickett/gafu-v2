import { expect, test } from "@playwright/test";

const headers = { "X-Gafu-Request": "gafu-v2" };

test("Prepare batch explains that due Cards are held by a saved request", async ({
  page,
}) => {
  await page.route("**/api/study/preparation-status", (route) =>
    route.fulfill({
      json: {
        mode: "server",
        enabled: true,
        ready: 0,
        preparing: 0,
        waiting: 0,
        blocked: 1,
        readyCardIds: [],
        blockedReason: null,
        uncertainBatches: ["saved-request"],
        lastError: null,
        restorePaused: false,
      },
    }),
  );
  await page.route("**/api/study/review-batch", (route) =>
    route.fulfill({ status: 409, json: { error: { kind: "dispatchUncertain" } } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Prepare batch" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your Cards are still due. Use Recover request in Study",
  );
  await expect(page.getByRole("button", { name: "Recover request" })).toBeVisible();
});

test("server preparation completes with every page closed and a fresh browser opens stored material", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(60_000);
  await request.put("/api/study/preferences", {
    headers,
    data: { automaticPreparation: "off", speechEnabled: false, newCardsPerDay: 100 },
  });
  const created = await request.post("/api/study/cards", {
    headers,
    data: {
      type: "vocabulary",
      content: {
        lemma: "浜",
        reading: "はま",
        partOfSpeech: "noun",
        meaning: "beach; shore",
        usageNotes: "",
      },
    },
  });
  expect(created.ok()).toBe(true);
  const { card } = (await created.json()) as { card: { id: string } };
  await request.post("/api/study/admit", { headers, data: {} });
  try {
    await page.goto("/");
    await expect(page.getByLabel("Automatic sentence preparation")).toHaveValue("off");
    await page.getByLabel("Automatic sentence preparation").selectOption("server");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status")).toContainText("Study settings saved");
    await page.close();
    await expect
      .poll(
        async () => {
          const state = (await (
            await request.get("/api/study/preparation-status")
          ).json()) as { readyCardIds: string[] };
          return state.readyCardIds.includes(card.id);
        },
        { timeout: 40_000 },
      )
      .toBe(true);
    const fresh = await browser.newContext();
    try {
      const opened = await fresh.newPage();
      await opened.goto("http://127.0.0.1:4173/");
      await expect(opened.locator(".presentation")).toBeVisible();
      // Existing ready material opens without pressing Prepare or submitting another batch.
      await expect(opened.getByTestId("preparation-status")).toContainText("ready");
    } finally {
      await fresh.close();
    }
  } finally {
    await request.put("/api/study/preferences", {
      headers,
      data: { automaticPreparation: "whileOpen" },
    });
    await request.post(`/api/study/cards/${card.id}/state`, {
      headers,
      data: { action: "suspend" },
    });
  }
});
