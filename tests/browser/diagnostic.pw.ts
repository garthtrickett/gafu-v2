import { expect, test } from "@playwright/test";

test("boots the Phase 0 diagnostic route", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Gafu V2 diagnostics" }),
  ).toBeVisible();
  await expect(page.getByText("Executable skeleton is ready.")).toBeVisible();
});
