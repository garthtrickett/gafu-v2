import { expect, test } from "@playwright/test";

test("boots the Phase 0 diagnostic route", async ({ page }) => {
  await page.goto("/?diagnostic=phase0");

  await expect(
    page.getByRole("heading", { name: "Gafu V2 diagnostics" }),
  ).toBeVisible();
  await expect(page.getByText("Integrated Phase 0 proof passed.")).toBeVisible();
  const proof = page.getByTestId("phase0-proof");
  await expect(proof).toContainText("4 cues");
  await expect(proof).toContainText("4 batches");
  await expect(proof).toContainText("Final-batch target");
  await expect(proof).toContainText("retained");
  await expect(proof).toContainText("3 invalid rejected");
});

test("analyzes Japanese off the browser main thread", async ({ page }) => {
  await page.goto("/?diagnostic=phase0");

  const result = await page.evaluate(() =>
    window.gafuDiagnostics.analyzeJapanese("犬がいる。"),
  );

  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) {
    expect(result.value.normalizedText).toBe("犬がいる。");
    expect(result.value.tokens.map((token) => token.lemma)).toContain("犬");
    expect(result.value.tokens.map((token) => token.reading)).toContain("いぬ");
  }
});
