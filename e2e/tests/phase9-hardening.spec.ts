import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authHeader, registerVerifyLogin, type PublicUser, type Tokens } from "./helpers";

/**
 * Phase 9 GATE (spec §8): a fresh clone → configure `.env` → `docker compose up`
 * yields a working, TLS-secured instance per the README; backup + restore
 * verified. Plus the Phase 9 polish smoke (dark mode + favorites).
 *
 * HTTPS-FIRST: the whole stack now serves TLS on https://localhost:8443 (Caddy
 * "internal" CA self-signed cert for localhost) and redirects HTTP→HTTPS. The
 * entire e2e suite runs over https/wss (playwright.config baseURL + the phase6
 * wss collab), so TLS is implicitly proven by every passing spec; the explicit
 * checks below assert it directly.
 *
 * The DESTRUCTIVE backup→wipe→restore test is gated behind RUN_BACKUP_RESTORE=1
 * so it does not tear down the stack out from under the rest of the serial suite
 * (it runs `docker compose down -v` + `up`). The gate runs it as a dedicated,
 * final invocation. See the gate report for how it was driven.
 */

const BASE = process.env.BASE_URL ?? "https://localhost:8443";
const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// ---------------------------------------------------------------------------
// TLS — the app + API are served over HTTPS (self-signed accepted).
// ---------------------------------------------------------------------------

test("API is served over HTTPS (health 200 over TLS)", async ({ request }) => {
  expect(BASE.startsWith("https://")).toBe(true);
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
});

test("web root loads over HTTPS", async ({ page }) => {
  await page.goto("/");
  expect(page.url().startsWith("https://")).toBe(true);
  await expect(page.getByRole("heading", { name: "Inclination" })).toBeVisible();
});

test("HTTP is redirected to HTTPS", async ({ request }) => {
  // Caddy redirects :80 → :443. The HTTP port (8080) is the redirect entrypoint.
  const httpBase = BASE.replace(/^https:/, "http:").replace(/:8443\b/, ":8080");
  const res = await request.get(`${httpBase}/`, { maxRedirects: 0 });
  // 308 (permanent) is Caddy's default HTTP→HTTPS redirect; accept the 30x family.
  expect(res.status(), `expected a redirect from ${httpBase}`).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  const location = res.headers()["location"] ?? "";
  expect(location.startsWith("https://")).toBe(true);
});

// ---------------------------------------------------------------------------
// Polish smoke — dark mode toggle + favorites (Phase 9 T3).
// ---------------------------------------------------------------------------

/** Seed an authed SPA session, then load the shell. */
async function seedSession(
  context: import("@playwright/test").BrowserContext,
  user: PublicUser,
  tokens: Tokens,
) {
  const persisted = JSON.stringify({ state: { user, tokens }, version: 0 });
  const page = await context.newPage();
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    ["inclination-auth", persisted],
  );
  await page.goto("/");
  return page;
}

test("dark mode toggle flips the resolved theme on <html>", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const { user, tokens } = await registerVerifyLogin(request, {
    email: `polish-theme-${stamp}@example.com`,
    password: "polishpassword1",
    displayName: "Polish Theme",
  });

  const context = await browser.newContext();
  try {
    const page = await seedSession(context, user, tokens);
    await expect(page.getByTestId("current-user")).toBeVisible({ timeout: 30_000 });

    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();

    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");

    // Clicking cycles light → dark → system; the resolved theme on <html> must
    // change at least once across two clicks (light↔dark), proving the theme
    // actually applies. Read after each click.
    await toggle.click();
    const after1 = await html.getAttribute("data-theme");
    await toggle.click();
    const after2 = await html.getAttribute("data-theme");

    const observed = new Set([before, after1, after2].filter(Boolean));
    expect(
      observed.size,
      `data-theme should change across the cycle (saw ${[...observed].join(",")})`,
    ).toBeGreaterThan(1);
    expect([before, after1, after2]).toContain("dark");
    expect([before, after1, after2]).toContain("light");
  } finally {
    await context.close();
  }
});

test("favorite a page: button becomes pressed, page enters Favorites, persists", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const { user, tokens } = await registerVerifyLogin(request, {
    email: `polish-fav-${stamp}@example.com`,
    password: "polishpassword1",
    displayName: "Polish Fav",
  });
  const access = tokens.accessToken;

  // Create a workspace + a page with a distinctive title via the API.
  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: "Polish Workspace" },
  });
  expect(wsRes.status()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const pageTitle = `Favorite Me ${stamp}`;
  const pageRes = await request.post(`/api/workspaces/${wsId}/pages`, {
    ...authHeader(access),
    data: { title: pageTitle },
  });
  expect(pageRes.status()).toBe(201);

  const context = await browser.newContext();
  try {
    const page = await seedSession(context, user, tokens);
    await expect(page.getByTestId("current-user")).toBeVisible({ timeout: 30_000 });

    // Open the page from the sidebar.
    const sidebar = page.getByRole("navigation", { name: "Pages" });
    const row = sidebar.locator(".page-link", { hasText: pageTitle });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    // Star it: aria-pressed flips true.
    const favButton = page.getByTestId("favorite-button");
    await expect(favButton).toBeVisible({ timeout: 30_000 });
    await expect(favButton).toHaveAttribute("aria-pressed", "false");
    await favButton.click();
    await expect(favButton).toHaveAttribute("aria-pressed", "true");

    // The page appears in the sidebar Favorites section.
    const favorites = page.getByTestId("favorites-section");
    await expect(favorites).toBeVisible({ timeout: 30_000 });
    await expect(favorites.getByTestId("favorite-item").filter({ hasText: pageTitle })).toBeVisible();

    // Reload: the favorite persists (it is server-backed, not just optimistic).
    await page.reload();
    await expect(page.getByTestId("current-user")).toBeVisible({ timeout: 30_000 });
    const favoritesAfter = page.getByTestId("favorites-section");
    await expect(favoritesAfter).toBeVisible({ timeout: 30_000 });
    await expect(
      favoritesAfter.getByTestId("favorite-item").filter({ hasText: pageTitle }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Backup → wipe → restore (the core new gate). Destructive: gated behind
// RUN_BACKUP_RESTORE=1 so it doesn't disrupt the rest of the serial suite.
// ---------------------------------------------------------------------------

const runBackupRestore = process.env.RUN_BACKUP_RESTORE === "1";

/** Run a repo POSIX script through bash, returning stdout. */
function bash(script: string, args: string[]): string {
  return execFileSync("bash", [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    // MSYS_NO_PATHCONV: stop Git-Bash from mangling docker/mc container paths.
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function compose(args: string[]): string {
  return execFileSync(
    "docker",
    ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
}

/** Poll the API health endpoint over HTTPS until it answers 200 (or time out). */
async function waitForApi(ctx: APIRequestContext, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await ctx.get(`${BASE}/api/health`);
      if (res.status() === 200) return;
    } catch {
      /* stack still coming up */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("API did not become healthy within timeout after restore");
}

test.describe("backup → wipe → restore", () => {
  test.skip(!runBackupRestore, "destructive; run with RUN_BACKUP_RESTORE=1 only");

  test("data created before backup is recovered after a volume wipe + restore", async ({
    request,
    playwright,
  }) => {
    test.setTimeout(900_000);
    const stamp = Date.now();
    const marker = `distinctive-restore-marker-${stamp}`;

    // 1. Seed distinctive data: register/login, create a workspace + page, save
    //    distinctive content. Title + content live in Postgres (covered by the
    //    pg_dump). JWT_ACCESS_SECRET is unchanged across the cycle, so the access
    //    token still verifies after restore.
    const { tokens } = await registerVerifyLogin(request, {
      email: `restore-${stamp}@example.com`,
      password: "restorepassword1",
      displayName: "Restore User",
    });
    const access = tokens.accessToken;

    const wsRes = await request.post("/api/workspaces", {
      ...authHeader(access),
      data: { name: `Restore WS ${stamp}` },
    });
    expect(wsRes.status()).toBe(201);
    const wsId = (await wsRes.json()).id as string;

    const pageTitle = `Restore Page ${stamp}`;
    const pageRes = await request.post(`/api/workspaces/${wsId}/pages`, {
      ...authHeader(access),
      data: { title: pageTitle },
    });
    expect(pageRes.status()).toBe(201);
    const pageId = (await pageRes.json()).id as string;

    const contentSave = await request.put(`/api/pages/${pageId}/content`, {
      ...authHeader(access),
      data: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: marker }] }] } },
    });
    expect(contentSave.status()).toBe(200);

    // 2. Back up the live stack (Postgres dump + MinIO mirror).
    const backupOut = bash("scripts/backup.sh", []);
    const destMatch = backupOut.match(/backup complete:\s*(backups\/[0-9-]+)/);
    expect(destMatch, `could not parse backup dir from:\n${backupOut}`).toBeTruthy();
    const backupDir = destMatch![1]!;

    // 3. DESTROY: wipe all volumes (Postgres + MinIO + Caddy).
    compose(["down", "-v"]);

    // 4. Bring the stack back up fresh (empty DB, migrations re-run).
    compose(["up", "-d", "--build"]);
    await waitForApi(request);

    // 5. Restore the backup, then restart app services so they reload state.
    bash("scripts/restore.sh", [backupDir]);
    compose(["restart", "api", "sync"]);
    await waitForApi(request);

    // 6. Assert the data is back. The access token still verifies (secret
    //    unchanged), so we can read the page + its content directly.
    const restoredCtx = await playwright.request.newContext({
      baseURL: BASE,
      ignoreHTTPSErrors: true,
    });
    try {
      const got = await restoredCtx.get(`/api/pages/${pageId}`, authHeader(access));
      expect(got.status(), "restored page should be retrievable").toBe(200);
      // GET /api/pages/:id returns { page, breadcrumbs }.
      expect((await got.json()).page.title).toBe(pageTitle);

      const content = await restoredCtx.get(`/api/pages/${pageId}/content`, authHeader(access));
      expect(content.status()).toBe(200);
      expect(JSON.stringify((await content.json()).doc)).toContain(marker);
    } finally {
      await restoredCtx.dispose();
    }
  });
});
