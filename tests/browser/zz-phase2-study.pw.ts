import { expect, test } from "@playwright/test";

test("configures a key and teaches before the first generated review", async ({
  page,
}) => {
  await page.goto("/");

  const earlierStagedGrammar = page.locator(".bank-card", { hasText: "〜てしまう" });
  if ((await earlierStagedGrammar.count()) > 0) {
    await earlierStagedGrammar.getByRole("button", { name: "Mark known" }).click();
  }

  await page.getByLabel("OpenAI API key").fill("browser-test-key");
  await page.getByRole("button", { name: "Verify and use key" }).click();
  await expect(page.getByRole("status")).toContainText("verified");
  await expect(
    page.getByText("API key configured until server restart."),
  ).toBeVisible();

  const vocabulary = page.getByTestId("vocabulary-form");
  await vocabulary.getByLabel("Lemma").fill("鳥");
  await vocabulary.getByLabel("Reading").fill("とり");
  await vocabulary.getByLabel("Part of speech").fill("noun");
  await vocabulary.getByLabel("One meaning").fill("bird");
  await vocabulary.getByLabel("Usage notes").fill("A general word for a bird.");
  await vocabulary.getByRole("button", { name: "Create Vocabulary Card" }).click();

  const review = page.getByTestId("review-panel");
  await review.getByRole("button", { name: "Start next Card" }).click();
  await expect(review.getByText("teach", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(review.getByTestId("material-answer")).toContainText("bird");
  await expect(review.getByRole("button", { name: "good" })).toHaveCount(0);

  await review
    .getByRole("button", { name: "I've studied this — start recall" })
    .click();
  await expect(review.getByText("review", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(review.getByTestId("material-answer")).toHaveCount(0);
  await review.getByRole("button", { name: "Reveal answer" }).click();
  await expect(review.getByTestId("material-answer")).toContainText("bird");
  await review.getByRole("button", { name: "good" }).click();
  await expect(page.getByRole("status")).toContainText("Review recorded once");
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");

  await page.reload();
  await expect(page.getByText("No API key configured.")).toHaveCount(0);
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");
});
