import { expect, test } from "@playwright/test";
import { episodeOne, episodeTwo } from "../fixtures/preparation/subtitles.ts";

test("a complete gap starts one durable plan and reports episode readiness", async ({
  page,
}) => {
  await page.goto("/?view=prepare");
  await page.getByLabel("Choose subtitles").setInputFiles([
    {
      name: "plan-01.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(episodeOne),
    },
    {
      name: "plan-02.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(episodeTwo),
    },
  ]);
  await page.getByRole("button", { name: "Inspect files" }).click();
  await page.getByLabel("Subtitle Set title").fill("Phase 4 browser plan");
  await page.getByRole("button", { name: "Save Subtitle Set" }).click();
  await page.getByRole("button", { name: "Review analysis scope" }).click();
  await page.getByRole("button", { name: "Analyze subtitle text" }).click();

  await page.getByRole("button", { name: "Review preparation plan" }).click();
  const draft = page.getByTestId("plan-draft");
  await expect(draft).toContainText("Preparation Plan Draft");
  await expect(draft).toContainText("selected targets have Card identity");
  await draft.getByRole("button", { name: "Start plan" }).click();

  const readiness = page.getByTestId("plan-readiness");
  await expect(readiness).toContainText("Phase 4 browser plan");
  await expect(readiness).toContainText("Episode 1");
  await expect(page.getByRole("status")).toContainText("Plan started atomically");
  await readiness.getByRole("button", { name: "Pause staging" }).click();
  await expect(readiness).toContainText("paused");

  await page.reload();
  await page.getByRole("button", { name: /Phase 4 browser plan/u }).click();
  await expect(page.getByTestId("plan-readiness")).toContainText("paused");

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete plan" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Cards and learning progress were kept",
  );
  await expect(page.getByTestId("plan-readiness")).toHaveCount(0);
});
