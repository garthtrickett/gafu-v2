import { expect, test } from "@playwright/test";

const MUTATION = { "X-Gafu-Request": "gafu-v2" };

/**
 * A word Card, all the way through: into the batch, out of it, onto the page.
 *
 * Three faults in a row lived in this path and none was caught, because the
 * journeys that exercise generated material graduate their Cards first and
 * so never render one. A word Card was filtered out of the batch and a day of
 * them read as nothing due; it was then left out of what a finished batch
 * hands over, so the page flashed and fell back to the button; and the
 * material it is served with carried no target, so opening it threw.
 */
test("a word Card is prepared, handed over, and rendered", async ({ page }) => {
  await page.goto("/");

  const made = await page.request.post("/api/study/cards", {
    headers: MUTATION,
    data: {
      type: "vocabulary",
      content: {
        lemma: "応援",
        reading: "おうえん",
        partOfSpeech: "noun",
        meaning: "support; cheering",
        usageNotes: "",
      },
    },
  });
  expect([200, 201, 409]).toContain(made.status());

  await page.goto("/");
  await page.getByLabel("New Cards per Day").fill("100");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Study settings saved");

  // Something is due and none of it needs generating: a word Card is served
  // from the Card, so the tiles must not call it unprepared.
  const counts = (await (await page.request.get("/api/study/status")).json()) as {
    session: { learnCount: number; reviewCount: number; unpreparedCount: number };
  };
  expect(counts.session.learnCount + counts.session.reviewCount).toBeGreaterThan(0);

  // The reported symptom: this flashed and returned to the button.
  await page.getByRole("button", { name: "Prepare batch" }).click();
  await expect(page.locator(".presentation")).toBeVisible({ timeout: 60_000 });

  // And the reported crash: the target the page reads was not there, so
  // rendering the answer threw. A first exposure shows it at once; a review
  // shows it once the explanation is asked for.
  const explanation = page.getByRole("button", { name: "Explanation" });
  if ((await explanation.count()) > 0) await explanation.first().click();
  const gloss = page.getByTestId("answer-target");
  await expect(gloss).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("nothingDue");
});
