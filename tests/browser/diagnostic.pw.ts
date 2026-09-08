import { expect, test } from "@playwright/test";

test("boots the Phase 0 diagnostic route", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Gafu V2 diagnostics" }),
  ).toBeVisible();
  await expect(page.getByText("Executable skeleton is ready.")).toBeVisible();
});

test("analyzes Japanese off the browser main thread", async ({ page }) => {
  await page.goto("/");

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
