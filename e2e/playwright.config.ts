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
    // HTTPS-first (Phase 9): Caddy serves TLS on https://localhost:8443 with a
    // self-signed ("Caddy internal" CA) cert and redirects HTTP->HTTPS. The whole
    // suite runs over https/wss; `ignoreHTTPSErrors` accepts the self-signed
    // localhost cert (test-only allowance — the cert is real TLS, just not
    // publicly trusted). Override the target with BASE_URL.
    baseURL: process.env.BASE_URL ?? "https://localhost:8443",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
