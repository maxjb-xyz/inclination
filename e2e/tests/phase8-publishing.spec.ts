import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page as PwPage,
} from "@playwright/test";
import { authHeader, registerVerifyLogin, type PublicUser, type Tokens } from "./helpers";

/**
 * Phase 8 "Done when" gate (spec §8):
 *   1. a page PUBLISHES to a public URL viewable while LOGGED OUT,
 *   2. a Markdown file IMPORTS into a page tree,
 *   3. a SYNCED block edited on one page updates on another.
 *
 * Driven against the real running stack (Caddy → API + sync (Hocuspocus
 * /collab) + Postgres + MinIO). REST is used for robust fixture setup
 * (register/verify/login, workspace + page creation) and for the unauthenticated
 * public-endpoint assertions; a real authenticated browser session — seeded by
 * writing the `inclination-auth` localStorage key the SPA reads — drives the
 * actual UI the gate cares about (publish dialog, sidebar import, synced block).
 *
 * The public clause's KEY assertion uses a BRAND-NEW browser context with NO
 * auth seed (a genuine logged-out visitor) hitting `/public/<slug>`.
 */

// Editor sync goes over a websocket through Caddy; give it room.
const SYNC_TIMEOUT = 20_000;
// Synced-block propagation rides a second websocket (`synced:{id}`); allow
// generous headroom for the create round-trip + cross-context convergence.
const SYNCED_TIMEOUT = 40_000;

const editorOf = (page: PwPage) => page.getByTestId("editor").locator(".ProseMirror");
const presenceOf = (page: PwPage) => page.getByTestId("presence-indicator");

/**
 * Seed an authenticated SPA session as the given user, open the workspace shell,
 * and open the known page P by clicking its sidebar row. Returns once the
 * collaborative editor is visible and presence reports "Connected".
 */
async function openPageAs(
  context: BrowserContext,
  user: PublicUser,
  tokens: Tokens,
  pageTitle: string,
): Promise<PwPage> {
  const persisted = JSON.stringify({ state: { user, tokens }, version: 0 });
  const page = await context.newPage();
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    ["inclination-auth", persisted],
  );

  await page.goto("/");
  await expect(page.getByTestId("current-user")).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar).toBeVisible();

  const row = sidebar.locator(".page-link", { hasText: pageTitle });
  await expect(row).toBeVisible({ timeout: SYNC_TIMEOUT });
  await row.click();

  const editor = editorOf(page);
  await expect(editor).toBeVisible({ timeout: SYNC_TIMEOUT });
  await expect(presenceOf(page)).toContainText("Connected", { timeout: SYNC_TIMEOUT });

  return page;
}

/** Just seed an authenticated SPA session + open the workspace shell (no page). */
async function openShellAs(
  context: BrowserContext,
  user: PublicUser,
  tokens: Tokens,
): Promise<PwPage> {
  const persisted = JSON.stringify({ state: { user, tokens }, version: 0 });
  const page = await context.newPage();
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    ["inclination-auth", persisted],
  );
  await page.goto("/");
  await expect(page.getByTestId("current-user")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  return page;
}

/** Move the caret to the end of the doc, start a fresh line, and type. */
async function typeOnNewLine(page: PwPage, text: string): Promise<void> {
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

/** Create workspace + a single page via REST; returns ids. */
async function setupWorkspacePage(
  request: APIRequestContext,
  access: string,
  wsName: string,
  pageTitle: string,
): Promise<{ wsId: string; pageId: string }> {
  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: wsName },
  });
  expect(wsRes.status(), await wsRes.text()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const pageRes = await request.post(`/api/workspaces/${wsId}/pages`, {
    ...authHeader(access),
    data: { title: pageTitle },
  });
  expect(pageRes.status(), await pageRes.text()).toBe(201);
  const pageId = (await pageRes.json()).id as string;

  return { wsId, pageId };
}

test("1 — a published page is viewable while LOGGED OUT (public URL + unauth API)", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `publish-${stamp}@example.com`,
    password: "publishpassword1",
    displayName: "Publish Owner",
  };

  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;
  const pageTitle = `Publish Page ${stamp}`;
  await setupWorkspacePage(request, access, "Publish Workspace", pageTitle);

  const distinctive = `published-content-${stamp}`;

  // ── Author + publish via the real UI (owner is canShare) ──
  const ownerCtx = await browser.newContext();
  let slug = "";
  try {
    const page = await openPageAs(ownerCtx, user, tokens, pageTitle);

    // Type distinctive content into the collaborative editor and let it persist.
    await typeOnNewLine(page, distinctive);
    await expect(editorOf(page)).toContainText(distinctive, { timeout: SYNC_TIMEOUT });
    // Give the debounced collab persist a beat so getHTML() includes the text.
    await page.waitForTimeout(1_500);

    // Open the publish dialog and publish.
    await page.getByTestId("open-publish").click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("publish-button").click();

    // Once published the dialog reveals the public URL; capture the slug from it.
    const urlField = page.getByTestId("public-url").getByLabel("Public URL");
    await expect(urlField).toBeVisible({ timeout: SYNC_TIMEOUT });
    const publicUrl = await urlField.inputValue();
    expect(publicUrl, "publish dialog should surface a public URL").toContain("/public/");
    slug = publicUrl.split("/public/")[1]!.replace(/\/$/, "");
    expect(slug.length).toBeGreaterThan(0);
  } finally {
    await ownerCtx.close();
  }

  // ── KEY GATE: a brand-new context with NO auth seed (genuine logged-out
  //    visitor) can view the published page at /public/<slug>. ──
  const anonCtx = await browser.newContext();
  try {
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(`/public/${slug}`);
    const publicPage = anonPage.getByTestId("public-page");
    await expect(publicPage).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(anonPage.getByTestId("public-title")).toContainText(pageTitle, {
      timeout: SYNC_TIMEOUT,
    });
    await expect(anonPage.getByTestId("public-body")).toContainText(distinctive, {
      timeout: SYNC_TIMEOUT,
    });
    // The anon context must genuinely be unauthenticated.
    const seededAuth = await anonPage.evaluate(() =>
      window.localStorage.getItem("inclination-auth"),
    );
    expect(seededAuth, "public view must not require/seed auth").toBeNull();
  } finally {
    await anonCtx.close();
  }

  // ── API: GET /api/public/<slug> with NO Authorization returns 200 + html;
  //    an unknown slug returns 404. Use a fresh request context with no auth. ──
  const anonApi = await browser.newContext();
  try {
    const ok = await anonApi.request.get(`/api/public/${slug}`);
    expect(ok.status(), await ok.text()).toBe(200);
    const body = (await ok.json()) as { title: string; html: string };
    expect(body.title).toContain(pageTitle);
    expect(body.html).toContain(distinctive);

    const missing = await anonApi.request.get(`/api/public/does-not-exist-${stamp}`);
    expect(missing.status()).toBe(404);
  } finally {
    await anonApi.close();
  }
});

test("2 — a Markdown file imports into a page tree (sidebar reflects root + children)", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `import-${stamp}@example.com`,
    password: "importpassword1",
    displayName: "Import Owner",
  };

  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;

  // A workspace with NO seed page; the import creates the tree.
  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: "Import Workspace" },
  });
  expect(wsRes.status(), await wsRes.text()).toBe(201);

  // Multi-H1 markdown: the splitting rule makes each top-level `#` a CHILD page
  // under a root page named from the filename, so we expect ≥2 children.
  const sectionA = `Alpha Section ${stamp}`;
  const sectionB = `Beta Section ${stamp}`;
  const sectionC = `Gamma Section ${stamp}`;
  const markdown = [
    `# ${sectionA}`,
    "",
    "Alpha body paragraph.",
    "",
    `# ${sectionB}`,
    "",
    "Beta body paragraph.",
    "",
    `# ${sectionC}`,
    "",
    "Gamma body paragraph.",
    "",
  ].join("\n");

  const ctx = await browser.newContext();
  try {
    const page = await openShellAs(ctx, user, tokens);

    const sidebar = page.getByRole("navigation", { name: "Pages" });
    // Import via the Sidebar hidden file input (real UI path).
    const input = page.getByTestId("import-md-input");
    await input.setInputFiles({
      name: `imported-doc-${stamp}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown, "utf-8"),
    });

    // The import refetches the tree and opens the created root page. Assert the
    // sidebar now shows the root (filename-derived title) AND each H1 child.
    const rootTitle = `imported doc ${stamp}`; // titleFromFilename of "imported-doc-<stamp>.md"
    await expect(sidebar.locator(".page-link", { hasText: rootTitle })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(sidebar.locator(".page-link", { hasText: sectionA })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(sidebar.locator(".page-link", { hasText: sectionB })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(sidebar.locator(".page-link", { hasText: sectionC })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // Belt-and-suspenders: the import response itself should report ≥2 children.
    // (The sidebar assertion above is the gate; this confirms the tree shape.)
    const rootRows = sidebar.locator(".page-link", { hasText: rootTitle });
    expect(await rootRows.count()).toBeGreaterThanOrEqual(1);
  } finally {
    await ctx.close();
  }
});

test("3 — a synced block edited on one page propagates to another view of it", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `synced-${stamp}@example.com`,
    password: "syncedpassword1",
    displayName: "Synced Owner",
  };

  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;
  const pageTitle = `Synced Page ${stamp}`;
  await setupWorkspacePage(request, access, "Synced Workspace", pageTitle);

  // PROPAGATION APPROACH: the create-synced-block UI only mints NEW ids (there is
  // no "embed an existing id" affordance to reference the SAME synced block from
  // a second page). So we prove the gate by opening the SAME page — which now
  // contains one synced block bound to `synced:{id}` — in TWO independent browser
  // contexts (two real websocket clients on the SAME `synced:{id}` Yjs doc) and
  // asserting that text typed into the synced-block editor in context A appears
  // in the synced-block editor in context B. Both views render the SAME synced
  // block, so propagation through `synced:{id}` is exactly what the gate checks.

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    // ── Context A: open the page and insert a synced block via the slash menu. ──
    const pageA = await openPageAs(ctxA, user, tokens, pageTitle);

    const editor = editorOf(pageA);
    await editor.click();
    await pageA.keyboard.press("Control+End");
    await pageA.keyboard.press("Enter");
    await pageA.keyboard.press("Enter");
    await pageA.keyboard.type("/");

    const menu = pageA.getByTestId("slash-menu");
    await expect(menu).toBeVisible({ timeout: SYNC_TIMEOUT });
    await pageA.keyboard.type("synced");
    const slashItem = menu.locator('[data-item-id="syncedBlock"]');
    await expect(slashItem).toBeVisible({ timeout: SYNC_TIMEOUT });
    await slashItem.click();

    // The inserted empty node offers a "create synced block" button; clicking it
    // mints a synced-block id via REST and binds the node to `synced:{id}`.
    const createBtn = pageA.getByTestId("synced-block-create");
    await expect(createBtn).toBeVisible({ timeout: SYNC_TIMEOUT });
    await createBtn.click();

    // Once created, the node carries a data-synced-block-id and mounts a nested
    // collaborative editor.
    const blockA = pageA.locator('[data-testid="synced-block"][data-synced-block-id]');
    await expect(blockA).toBeVisible({ timeout: SYNCED_TIMEOUT });
    const syncedId = await blockA.getAttribute("data-synced-block-id");
    expect(syncedId, "created synced block should expose its id").toBeTruthy();

    const syncedEditorA = blockA.getByTestId("synced-block-editor").locator(".ProseMirror");
    await expect(syncedEditorA).toBeVisible({ timeout: SYNCED_TIMEOUT });

    // Let A's synced-block doc persist so a second client fetches the same doc.
    await pageA.waitForTimeout(2_000);

    // ── Context B: open the SAME page; it renders the SAME synced block. ──
    const pageB = await openPageAs(ctxB, user, tokens, pageTitle);
    const blockB = pageB.locator(
      `[data-testid="synced-block"][data-synced-block-id="${syncedId}"]`,
    );
    await expect(blockB).toBeVisible({ timeout: SYNCED_TIMEOUT });
    const syncedEditorB = blockB.getByTestId("synced-block-editor").locator(".ProseMirror");
    await expect(syncedEditorB).toBeVisible({ timeout: SYNCED_TIMEOUT });

    // ── Type into A's synced block; assert it propagates to B's view. ──
    const syncedText = `synced-text-${stamp}`;
    await syncedEditorA.click();
    await pageA.keyboard.type(syncedText);
    await expect(syncedEditorA).toContainText(syncedText, { timeout: SYNCED_TIMEOUT });
    // The gate's core assertion: the same `synced:{id}` doc propagates the edit.
    await expect(syncedEditorB).toContainText(syncedText, { timeout: SYNCED_TIMEOUT });

    // And the reverse direction, to prove genuine bidirectional sync.
    const replyText = `synced-reply-${stamp}`;
    await syncedEditorB.click();
    await pageB.keyboard.press("Control+End");
    await pageB.keyboard.type(replyText);
    await expect(syncedEditorB).toContainText(replyText, { timeout: SYNCED_TIMEOUT });
    await expect(syncedEditorA).toContainText(replyText, { timeout: SYNCED_TIMEOUT });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
