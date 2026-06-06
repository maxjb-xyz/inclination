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
  // Auth routes are rate-limited (register 5/min/IP); run specs serially with a
  // couple of retries so the suite is deterministic rather than racing the limit.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
