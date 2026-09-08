import { expect, test } from "@playwright/test";
import { buildZip, episodeOne, episodeTwo } from "../fixtures/preparation/subtitles.ts";

test("direct and ZIP sets analyze equivalently, correct, reload, and delete safely", async ({
  page,
}) => {
  await page.goto("/?view=prepare");
  await expect(
    page.getByRole("heading", {
      name: "Find the Japanese between you and the show.",
    }),
  ).toBeVisible();

  await page.getByLabel("Choose subtitles").setInputFiles([
    {
      name: "show-01.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(episodeOne),
    },
    {
      name: "show-02.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(episodeTwo),
    },
  ]);
  await page.getByRole("button", { name: "Inspect files" }).click();
  const report = page.getByTestId("import-report");
  await expect(report).toContainText("2 accepted");
  await expect(page.getByRole("status")).toContainText("2 accepted");

  await report.getByLabel("Subtitle Set title").fill("Browser fixture series");
  await report.getByRole("button", { name: "Save Subtitle Set" }).click();
  await expect(page.getByRole("status")).toContainText("No provider request");
  await expect(page.getByTestId("current-subtitle-set")).toContainText(
    "Browser fixture series",
  );

  await page.getByRole("button", { name: "Review analysis scope" }).click();
  const preflight = page.getByTestId("analysis-preflight");
  await expect(preflight).toContainText("deterministic-fake");
  await expect(preflight).toContainText("Video, audio, filenames");
  await expect(page.getByRole("status")).toContainText("Nothing was sent yet");
  await preflight.getByRole("button", { name: "Analyze subtitle text" }).click();

  const gap = page.getByTestId("preparation-gap");
  await expect(gap).toContainText("complete");
  await expect(gap.getByTestId("gap-finding").first()).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Preparation Gap complete");
  const directMetrics = await gap.locator(".metrics").innerText();

  const first = gap.getByTestId("gap-finding").first();
  await first.getByText("Correct meaning or sense").click();
  await first.getByLabel("Meaning").fill("learner-corrected meaning");
  await first.getByLabel("Sense ID").fill("learner:browser:1");
  await first.getByRole("button", { name: "Save identity" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved");
  await first.getByRole("button", { name: "Known for this set" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved");

  await page.reload();
  await page.getByRole("button", { name: /Browser fixture series/u }).click();
  await expect(page.getByRole("status")).toContainText("re-compared locally");
  await expect(page.getByTestId("preparation-gap")).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete local media data" }).click();
  await expect(page.getByRole("status")).toContainText("Study data was kept");
  await expect(page.getByText("No saved sets yet.")).toBeVisible();

  await page.getByLabel("Choose subtitles").setInputFiles({
    name: "show.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      buildZip([
        { name: "show-02.srt", text: episodeTwo },
        { name: "show-01.srt", text: episodeOne },
      ]),
    ),
  });
  await page.getByRole("button", { name: "Inspect files" }).click();
  await expect(page.getByTestId("import-report")).toContainText("2 accepted");
  await page.getByLabel("Subtitle Set title").fill("ZIP fixture series");
  await page.getByRole("button", { name: "Save Subtitle Set" }).click();
  await page.getByRole("button", { name: "Review analysis scope" }).click();
  await page.getByRole("button", { name: "Analyze subtitle text" }).click();
  const zipGap = page.getByTestId("preparation-gap");
  await expect(zipGap).toContainText("complete");
  expect(await zipGap.locator(".metrics").innerText()).toBe(directMetrics);
});
