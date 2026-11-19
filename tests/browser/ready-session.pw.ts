import { expect, test } from "@playwright/test";

test("ready Cards open while dashboard reads wait, and intent overlaps the readiness read", async ({
  page,
}) => {
  let starting = false;
  let intentReceived = false;
  let releaseReadiness = () => {};
  let releaseDashboard = () => {};
  const readiness = new Promise<void>((resolve) => {
    releaseReadiness = resolve;
  });
  const dashboard = new Promise<void>((resolve) => {
    releaseDashboard = resolve;
  });
  await page.route("**/api/study/preparation-status", async (route) => {
    if (starting) await readiness;
    await route.fulfill({
      json: {
        mode: "off",
        enabled: true,
        ready: starting ? 1 : 0,
        readyCardIds: starting ? ["ready-card"] : [],
        preparing: 0,
        waiting: 0,
        blocked: 0,
        blockedReason: null,
        uncertainBatches: [],
        lastError: null,
        restorePaused: false,
      },
    });
  });
  await page.route("**/api/study/review-batch/active", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/study/review-batch", async (route) => {
    intentReceived = true;
    await route.fulfill({ status: 202, json: { batchId: "ready-batch", total: 1 } });
  });
  await page.route("**/api/study/review-batch/ready-batch", (route) =>
    route.fulfill({
      json: {
        batchId: "ready-batch",
        pending: 1,
        completed: [],
        failed: [],
        done: false,
        round: 1,
        requestInFlight: false,
      },
    }),
  );
  await page.route("**/api/study/status", async (route) => {
    if (starting) await dashboard;
    await route.continue();
  });
  await page.route("**/api/study/session/review-all", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "ready-presentation",
            cardId: "ready-card",
            mode: "review",
            source: "reserve",
            audioUrl: null,
            permit: { token: "fixture", expiresAt: "2099-01-01T00:00:00.000Z" },
            material: {
              mode: "review",
              targetKind: "vocabulary",
              target: {
                lemma: "猫",
                reading: "ねこ",
                partOfSpeech: "noun",
                meaning: "cat",
              },
              context: "A cat is outside.",
              japanese: "猫です。",
              targetSpan: { start: 0, end: 1 },
              readingSegments: [
                { written: "猫", reading: "ねこ" },
                { written: "です。", reading: "です。" },
              ],
              prompt: "What does this mean?",
              answer: "It is a cat.",
              explanation: "猫 means cat.",
              usageNote: "An everyday noun.",
            },
          },
        ],
      },
    }),
  );
  try {
    await page.goto("/");
    const prepare = page.getByRole("button", { name: "Prepare batch", exact: true });
    await expect(prepare).toBeEnabled();
    starting = true;
    await prepare.click();
    // The readiness GET is held. The independent POST must already arrive.
    await expect.poll(() => intentReceived).toBe(true);
    releaseReadiness();
    // Both the batch start and the subsequent opening have dashboard refreshes.
    // Neither may keep a banked presentation or its controls waiting.
    await expect(page.locator(".presentation")).toContainText("猫");
    await expect(page.getByRole("button", { name: "Suspend this Card" })).toBeEnabled();
  } finally {
    releaseReadiness();
    releaseDashboard();
  }
});
