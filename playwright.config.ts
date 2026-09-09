import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  // Browser journeys share one authoritative local SQLite server by design.
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "line",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-critical",
      testMatch: "**/zzzzz-phase6-compatibility.pw.ts",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-chromium",
      testMatch: "**/zzzzz-phase6-compatibility.pw.ts",
      use: { ...devices["Pixel 7"] },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "GAFU_DATABASE_PATH=:memory: GAFU_FAKE_AI=1 GAFU_KAISHI_SEED_PATH= GAFU_VITE_MODE=preview bun run dev",
    url: "http://127.0.0.1:4173",
    // Never attach destructive browser journeys to an arbitrary developer
    // server: these tests create, review, and delete durable learner data.
    reuseExistingServer: false,
  },
});
