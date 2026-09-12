import { expect, test } from "@playwright/test";

test("manages durable typed Cards and settings through the local Study server", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Learn the Japanese your shows need." }),
  ).toBeVisible();
  await expect(page.getByText("Kaishi 1.5k is not installed.")).toBeVisible();

  const vocabulary = page.getByTestId("vocabulary-form");
  await vocabulary.getByLabel("Lemma").fill("開く");
  await vocabulary.getByLabel("Reading").fill("あく");
  await vocabulary.getByLabel("Part of speech").fill("intransitive verb");
  await vocabulary.getByLabel("One meaning").fill("to open");
  await vocabulary.getByRole("button", { name: "Create Vocabulary Card" }).click();
  await expect(page.getByRole("status")).toContainText("Vocabulary Card created");

  await vocabulary.getByLabel("Lemma").fill("開く");
  await vocabulary.getByLabel("Reading").fill("アク");
  await vocabulary.getByLabel("Part of speech").fill("INTRANSITIVE VERB");
  await vocabulary.getByLabel("One meaning").fill("To open.");
  await vocabulary.getByRole("button", { name: "Create Vocabulary Card" }).click();
  await expect(page.getByRole("status")).toContainText("already exists");

  const grammar = page.getByTestId("grammar-form");
  await grammar.getByLabel("Canonical form").fill("〜てしまう");
  await grammar.getByLabel("Meaning or function").fill("completion or regret");
  await grammar.getByLabel("Formation").fill("て-form + しまう");
  await grammar.getByRole("button", { name: "Create Grammar Card" }).click();
  await expect(page.getByRole("status")).toContainText("Grammar Card created");
  await expect(page.getByText("2 durable Cards")).toBeVisible();

  const vocabularyCard = page.locator(".bank-card", { hasText: "開く" });
  await vocabularyCard.getByRole("button", { name: "Support-ready" }).click();
  await expect(vocabularyCard).toContainText("support-ready");

  await page.getByLabel("New Cards per Day").fill("7");
  await page.getByLabel("Time zone").fill("Australia/Sydney");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Study settings saved");

  await page.reload();
  await expect(page.getByText("2 durable Cards")).toBeVisible();
  await expect(page.getByLabel("New Cards per Day")).toHaveValue("7");
  await expect(page.getByLabel("Time zone")).toHaveValue("Australia/Sydney");
  await expect(page.locator(".bank-card", { hasText: "開く" })).toContainText(
    "support-ready",
  );

  await page.getByLabel("Search").fill("completion");
  await expect(page.locator(".bank-card")).toHaveCount(1);
  await expect(page.locator(".bank-card")).toContainText("〜てしまう");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download SQLite backup" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(0);

  await expect(page.getByRole("button", { name: "Again" })).toHaveCount(0);
});
