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
