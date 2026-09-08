import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env["CI"],
  },
});
