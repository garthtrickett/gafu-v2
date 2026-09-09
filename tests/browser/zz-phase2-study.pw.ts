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

  // The deterministic teach/review sentences use background particles the
  // learner is expected to know. A real learner marks them known first; the
  // journey does the same through the public card bank. 鳥 stays due first
  // because it was created before these background cards.
  const grammar = page.getByTestId("grammar-form");
  for (const form of [
    "か",
    "な",
    "かな",
    "で",
    "も",
    "だ",
    "よ",
    "ね",
    "〜て",
    "って",
    "だけ",
    "でも",
  ]) {
    await grammar.getByLabel("Canonical form").fill(form);
    await grammar.getByLabel("Meaning or function").fill(`background ${form}`);
    await grammar.getByLabel("Formation").fill(form);
    await grammar.getByRole("button", { name: "Create Grammar Card" }).click();
    await expect(page.getByRole("status")).toContainText("Grammar Card created");
    // :text-is matches the card title exactly; substring hasText would confuse
    // か with かな, だ with だけ, and も with でも.
    const background = page.locator(`.bank-card:has(h3:text-is("${form}"))`);
    await background.getByRole("button", { name: "Mark known" }).click();
    await expect(background).toContainText("support-ready");
  }

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
  let releaseAnswer = (): void => {};
  const answerGate = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  await page.route("**/api/study/session/answer", async (route) => {
    await answerGate;
    await route.continue();
  });
  await review.getByRole("button", { name: "good" }).click();
  await expect(review.getByRole("button", { name: "again" })).toBeDisabled();
  await expect(review.getByRole("button", { name: "hard" })).toBeDisabled();
  await expect(review.getByRole("button", { name: "good" })).toBeDisabled();
  await expect(review.getByRole("button", { name: "easy" })).toBeDisabled();
  releaseAnswer();
  await expect(page.getByRole("status")).toContainText("Review recorded once");
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");

  await page.reload();
  await expect(page.getByText("No API key configured.")).toHaveCount(0);
  await expect(page.locator(".bank-card", { hasText: "鳥" })).toContainText("1 review");
});
