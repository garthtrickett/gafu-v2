import { expect, type Page, test } from "@playwright/test";

// The tab prepares while nobody is watching it, so the work is done by the
// time the learner comes back. Generation is local and instant here; what
// the journey is really timing is the settle before a hidden tab starts.
test.setTimeout(90_000);

const MUTATION = { "X-Gafu-Request": "gafu-v2" };

/** What the tiles say, read straight from the route the page reads. */
const counts = async (page: Page): Promise<{ unpreparedCount: number }> => {
  const body = (await (await page.request.get("/api/study/status")).json()) as {
    session: { unpreparedCount: number };
  };
  return body.session;
};

/**
 * Whether a first exposure is banked for the Card this journey owns.
 *
 * The count alone cannot carry the assertion: journeys share a server, and
 * an earlier one may leave Cards that no provider can write a sentence for.
 * This Card is this journey's own, and nothing but the hidden tab prepares it.
 */
const preparedMonkey = async (page: Page): Promise<boolean> => {
  const body = (await (
    await page.request.get(`/api/study?search=${encodeURIComponent("猿")}`)
  ).json()) as {
    cards: { content: { lemma?: string }; teachable: boolean }[];
  };
  return body.cards.find((card) => card.content.lemma === "猿")?.teachable === true;
};

/**
 * Creates a Card if it is not there already and returns its id. Journeys
 * share one server, so an earlier one may have made it; either way the Card
 * exists when this returns.
 */
const ensureCard = async (
  page: Page,
  type: "grammar" | "vocabulary",
  title: string,
  content: Record<string, string>,
): Promise<string> => {
  const made = await page.request.post("/api/study/cards", {
    headers: MUTATION,
    data: { type, content },
  });
  if (made.ok()) return ((await made.json()) as { card: { id: string } }).card.id;
  const listed = (await (
    await page.request.get(`/api/study?search=${encodeURIComponent(title)}`)
  ).json()) as {
    cards: { id: string; content: { lemma?: string; canonicalForm?: string } }[];
  };
  const found = listed.cards.find(
    (card) => (card.content.lemma ?? card.content.canonicalForm) === title,
  );
  if (found === undefined) throw new Error(`no Card for ${title}`);
  return found.id;
};

test("a tab left in the background writes the sentences that are due", async ({
  page,
}) => {
  // The deterministic first exposure is `猿かな。`, `でも猿。`, `猿だけだ。`, so
  // its background words have to be known before any of it validates. A real
  // learner has them from the baseline; this journey states them outright.
  for (const form of ["か", "な", "かな", "で", "も", "でも", "だ", "だけ"]) {
    const id = await ensureCard(page, "grammar", form, {
      canonicalForm: form,
      meaning: `background ${form}`,
      formation: form,
      usageNotes: "",
    });
    await page.request.post(`/api/study/cards/${id}/state`, {
      headers: MUTATION,
      data: { action: "markSupportReady" },
    });
  }
  await ensureCard(page, "vocabulary", "猿", {
    lemma: "猿",
    reading: "さる",
    partOfSpeech: "noun",
    meaning: "monkey",
    usageNotes: "A general word for a monkey.",
  });

  await page.goto("/");
  // Admit whatever is staged on the spot: the point is the preparing, not
  // the daily limit.
  await page.getByLabel("New Cards per Day").fill("100");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Study settings saved");

  // The setting is on by default, and this is the only place it is read.
  await expect(
    page.getByLabel("Prepare while this tab is in the background"),
  ).toBeChecked();

  // A due Card with nothing banked for it is one generation away from being
  // servable, and that is what the count means.
  const unprepared = (await counts(page)).unpreparedCount;
  expect(unprepared).toBeGreaterThan(0);
  expect(await preparedMonkey(page)).toBe(false);

  // Chrome will not hide a tab under test, so the page is told it is hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Nothing was pressed, no session was opened, and the sentence gets written.
  await expect.poll(() => preparedMonkey(page), { timeout: 60_000 }).toBe(true);
  expect((await counts(page)).unpreparedCount).toBeLessThan(unprepared);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("status")).toContainText(
    "while this tab was in the background",
  );

  // And the work is real: the batch that follows opens a Card without asking
  // the provider for anything, because the sentences are already banked.
  await page.getByRole("button", { name: "Prepare batch" }).click();
  await expect(page.locator(".presentation")).toBeVisible({ timeout: 30_000 });
});

/**
 * A poll that settles nothing must not be asked again immediately.
 *
 * The provider in front of a real deployment writes a whole batch as one
 * background job, so a poll while that job runs returns at once with nothing
 * settled. Chaining the next poll straight onto it — which is right when
 * each poll advances a Card — turns that into a tight loop against the
 * provider for as long as the job takes. The responses here are stubbed, so
 * what is measured is purely the page's pacing.
 */
test("polls that settle nothing are paced, not chained", async ({ page }) => {
  let polls = 0;
  await page.route("**/api/study/review-batch", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ batchId: "paced-batch", total: 1 }),
    });
  });
  await page.route("**/api/study/review-batch/paced-batch", async (route) => {
    polls += 1;
    // Always pending, and always the same: a job that has not finished.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        batchId: "paced-batch",
        done: false,
        pending: 1,
        completed: [],
        failed: [],
        round: 1,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Prepare batch" }).click();
  // Six seconds of a job that never finishes. Paced at one poll per three
  // seconds that is a handful; chained it is however many round trips fit,
  // which is hundreds.
  await page.waitForTimeout(6_000);
  expect(polls).toBeGreaterThan(0);
  expect(polls).toBeLessThan(10);
});

/**
 * Preparation survives a tab being looked at and left again.
 *
 * The lock that stops two tabs buying the same sentences used to be held for
 * the whole run, including the waits between rounds. A run that had gone
 * stale still held it, so the run that replaced it was turned away with
 * nothing left to wake it, and the tab sat hidden preparing nothing.
 *
 * What is asserted is that the second leaving dispatches a batch at all.
 * Whether that batch can write a sentence depends on Cards other journeys
 * left behind; whether it is even attempted does not.
 */
test("a tab looked at and left again still prepares", async ({ page }) => {
  const id = await ensureCard(page, "vocabulary", "鳥", {
    lemma: "鳥",
    reading: "とり",
    partOfSpeech: "noun",
    meaning: "bird",
    usageNotes: "A general word for a bird.",
  });
  expect(id).not.toBe("");

  let dispatches = 0;
  await page.route("**/api/study/review-batch", async (route) => {
    dispatches += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ batchId: "relock-batch", total: 1 }),
    });
  });
  await page.route("**/api/study/review-batch/relock-batch", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        batchId: "relock-batch",
        done: true,
        pending: 0,
        completed: ["stub"],
        failed: [],
        round: 1,
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("New Cards per Day").fill("100");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Study settings saved");

  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => value,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  // Something has to be worth preparing, or a tab correctly does nothing.
  expect((await counts(page)).unpreparedCount).toBeGreaterThan(0);

  // Hide, look back before the settle is over, then leave again. The second
  // leaving is the one that has to work: the first run is still asleep
  // holding whatever it holds.
  await setVisibility("hidden");
  await page.waitForTimeout(1_000);
  await setVisibility("visible");
  await page.waitForTimeout(1_000);
  await setVisibility("hidden");

  await expect.poll(() => dispatches, { timeout: 30_000 }).toBeGreaterThan(0);
});
