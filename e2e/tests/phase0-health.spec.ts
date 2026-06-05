import { expect, test } from "@playwright/test";

/**
 * Phase 0 "Done when" gate: docker compose up boots all services healthy and
 * /health + /ready pass for API and sync. Exercised end to end through Caddy.
 */

test("API health and readiness pass through Caddy", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });

  const ready = await request.get("/api/ready");
  expect(ready.status()).toBe(200);
  const body = await ready.json();
  expect(body.status).toBe("ok");
  const states = Object.fromEntries(
    body.checks.map((c: { name: string; state: string }) => [c.name, c.state]),
  );
  expect(states.postgres).toBe("up");
  expect(states.minio).toBe("up");
});

test("sync health and readiness pass through Caddy", async ({ request }) => {
  const health = await request.get("/sync/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });

  const ready = await request.get("/sync/ready");
  expect(ready.status()).toBe(200);
  expect((await ready.json()).status).toBe("ok");
});

test("web SPA loads and shows live API health as ok", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inclination" })).toBeVisible();
  await expect(page.getByTestId("api-status")).toHaveText("ok");
});
