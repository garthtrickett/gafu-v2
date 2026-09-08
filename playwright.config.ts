import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  // Browser journeys share one authoritative local SQLite server by design.
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "GAFU_DATABASE_PATH=:memory: GAFU_FAKE_AI=1 bun run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env["CI"],
  },
});
