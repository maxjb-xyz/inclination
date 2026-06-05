import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Tests run against an already-running stack (the phase gate script
 * brings `docker compose up` before invoking Playwright). Override the target
 * with BASE_URL.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
