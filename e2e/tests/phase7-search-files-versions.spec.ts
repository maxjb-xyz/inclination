import { expect, test, type APIRequestContext, type BrowserContext, type Page as PwPage } from "@playwright/test";
import { authHeader, registerVerifyLogin, type PublicUser, type Tokens } from "./helpers";

/**
 * Phase 7 "Done when" gate (spec §8):
 *   1. search finds a phrase typed into a page,
 *   2. an uploaded image renders and survives reload,
 *   3. a prior page version can be previewed and restored.
 *
 * All three are driven against the real running stack (Caddy → API + sync
 * (Hocuspocus /collab) + Postgres + MinIO). REST is used for fixture setup
 * (register/verify/login, workspace + page creation, and a few robustness
 * polls), and a real authenticated browser session — seeded by writing the
 * `inclination-auth` localStorage key the SPA reads — drives the actual UI the
 * gate cares about (command palette, the image block, the version-history panel).
 *
 * SYNC/INDEXING NOTE: search is indexed by the SYNC server, which extracts text
 * from the persisted Yjs doc on store (debounced). So typed editor text only
 * becomes searchable a few seconds AFTER the doc persists. We therefore poll the
 * search REST API (which the palette uses under the hood) with a generous
 * timeout to confirm indexing, THEN assert the palette UI surfaces the result.
 */

// Editor sync goes over a websocket through Caddy; give it room.
const SYNC_TIMEOUT = 20_000;
// The sync server debounces persist+index; allow generous headroom for a typed
// phrase to become searchable.
const INDEX_TIMEOUT = 30_000;
// MinIO presign + PUT + a fresh presigned GET on reload.
const UPLOAD_TIMEOUT = 30_000;

const editorOf = (page: PwPage) => page.getByTestId("editor").locator(".ProseMirror");
const presenceOf = (page: PwPage) => page.getByTestId("presence-indicator");

/**
 * A minimal but VALID 1x1 PNG (signature + IHDR + a single IDAT + IEND). Built
 * as a Buffer in-test so the upload exercises the real presign → PUT → MinIO
 * path with genuine PNG bytes (no fixture file on disk).
 */
function tinyPng(): Buffer {
  // 1x1 transparent PNG, base64 of a known-good minimal image.
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  return Buffer.from(b64, "base64");
}

/**
 * Seed an authenticated SPA session as the given user, open the workspace
 * shell, and open the known page P by clicking its sidebar row. Returns once the
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

/** Move the caret to the end of the doc, start a fresh line, and type. */
async function typeOnNewLine(page: PwPage, text: string): Promise<void> {
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

/** Create workspace + a single page via REST; returns ids + title. */
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

test("search finds a typed phrase via the API index and the command palette UI", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `search-${stamp}@example.com`,
    password: "searchpassword1",
    displayName: "Search User",
  };

  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;
  const pageTitle = `Search Page ${stamp}`;
  const { wsId, pageId } = await setupWorkspacePage(
    request,
    access,
    "Search Workspace",
    pageTitle,
  );

  const phrase = `zephyrquux${stamp}`;

  const context = await browser.newContext();
  try {
    const page = await openPageAs(context, user, tokens, pageTitle);

    // Type the distinctive phrase into the collaborative editor.
    await typeOnNewLine(page, phrase);
    await expect(editorOf(page)).toContainText(phrase, { timeout: SYNC_TIMEOUT });

    // The sync server persists + indexes the Yjs doc on a debounce; poll the
    // search REST API (the same surface the palette uses) until the page is
    // indexed for the phrase.
    await expect
      .poll(
        async () => {
          const res = await request.get(
            `/api/workspaces/${wsId}/search?q=${encodeURIComponent(phrase)}`,
            authHeader(access),
          );
          if (!res.ok()) return [];
          const hits = (await res.json()) as { pageId: string }[];
          return hits.map((h) => h.pageId);
        },
        {
          message: "sync server should index the typed phrase for search",
          timeout: INDEX_TIMEOUT,
          intervals: [1_000, 1_000, 2_000, 2_000, 3_000],
        },
      )
      .toContain(pageId);

    // Now the gate's UI assertion: open the command palette, type part of the
    // phrase, and confirm a result for this page appears and navigates.
    await page.getByTestId("open-command-palette").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("command-palette-input").fill(phrase);

    const result = page.getByTestId("command-palette-result").filter({ hasText: pageTitle });
    await expect(result).toBeVisible({ timeout: INDEX_TIMEOUT });

    // Clicking the result navigates to (opens) the page.
    await result.click();
    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect(editorOf(page)).toContainText(phrase, { timeout: SYNC_TIMEOUT });
  } finally {
    await context.close();
  }
});

test("an uploaded image renders and survives a reload", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `upload-${stamp}@example.com`,
    password: "uploadpassword1",
    displayName: "Upload User",
  };

  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;
  const pageTitle = `Upload Page ${stamp}`;
  await setupWorkspacePage(request, access, "Upload Workspace", pageTitle);

  const context = await browser.newContext();
  try {
    const page = await openPageAs(context, user, tokens, pageTitle);

    // Insert an image block via the slash menu (real UI path), then upload a
    // PNG through the block's file input. Mirror the known-good phase-4 slash
    // pattern: land on a fresh top-level paragraph, type "/", wait for the menu,
    // THEN type the filter (the suggestion has allowSpaces:false and is driven
    // by the "/" trigger, so the query must be typed after the menu opens).
    const editor = editorOf(page);
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");

    const menu = page.getByTestId("slash-menu");
    await expect(menu).toBeVisible({ timeout: SYNC_TIMEOUT });
    await page.keyboard.type("image");

    const slashImage = menu.locator('[data-item-id="image"]');
    await expect(slashImage).toBeVisible({ timeout: SYNC_TIMEOUT });
    await slashImage.click();

    // The empty image block exposes a file input; upload an in-memory PNG.
    const fileInput = page.getByTestId("media-image-upload");
    await expect(fileInput).toBeVisible({ timeout: SYNC_TIMEOUT });
    await fileInput.setInputFiles({
      name: `pixel-${stamp}.png`,
      mimeType: "image/png",
      buffer: tinyPng(),
    });

    // Fail fast with a clear message if the presign/PUT errors out (e.g. the
    // presigned URL host is unreachable from the browser).
    const uploadErr = page.getByTestId("media-image-error");
    await expect(
      uploadErr,
      "image upload should not surface an error (presigned URL must be browser-reachable)",
    ).toBeHidden({ timeout: UPLOAD_TIMEOUT });

    // The rendered <img.media-image> should appear with a resolved (non-empty) src.
    const img = page.locator("img.media-image");
    await expect(img).toBeVisible({ timeout: UPLOAD_TIMEOUT });
    const srcBefore = await img.getAttribute("src");
    expect(srcBefore, "uploaded image should resolve a presigned src").toBeTruthy();
    expect(srcBefore!.length).toBeGreaterThan(0);
    // Prove the bytes actually load from storage (not just that an <img> exists).
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
        message: "uploaded image should load from MinIO (naturalWidth > 0)",
        timeout: UPLOAD_TIMEOUT,
      })
      .toBe(true);

    // Reload: the editor reconnects to the persisted Yjs doc; the image node
    // carries an attachmentId and must re-resolve a FRESH presigned GET URL.
    await page.reload();
    await expect(page.getByTestId("current-user")).toBeVisible();
    const sidebar = page.getByRole("navigation", { name: "Pages" });
    const row = sidebar.locator(".page-link", { hasText: pageTitle });
    await expect(row).toBeVisible({ timeout: SYNC_TIMEOUT });
    await row.click();
    await expect(editorOf(page)).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(presenceOf(page)).toContainText("Connected", { timeout: SYNC_TIMEOUT });

    // The image STILL renders after reload (proves MinIO persistence +
    // re-resolution survives a fresh page load).
    const imgAfter = page.locator("img.media-image");
    await expect(imgAfter).toBeVisible({ timeout: UPLOAD_TIMEOUT });
    const srcAfter = await imgAfter.getAttribute("src");
    expect(srcAfter, "image src should re-resolve after reload").toBeTruthy();
    expect(srcAfter!.length).toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          imgAfter.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
        {
          message: "image should still load from MinIO after reload",
          timeout: UPLOAD_TIMEOUT,
        },
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test("a prior page version can be previewed and restored", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `version-${stamp}@example.com`,
    password: "versionpassword1",
    displayName: "Version User",
  };

  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;
  const pageTitle = `Version Page ${stamp}`;
  const { pageId } = await setupWorkspacePage(request, access, "Version Workspace", pageTitle);

  const oldText = `oldversion${stamp}`;
  const newText = `newversion${stamp}`;

  // We use TWO sequential contexts. The first authors + snapshots + restores;
  // the second (fresh) re-opens the page to verify the restore took effect.
  // Why a fresh context rather than page.reload(): Hocuspocus keeps a doc loaded
  // in memory while ANY client is connected and only re-`fetch`es the persisted
  // (restored) state once the doc is evicted (last client gone). Reloading the
  // same context can race that eviction — the reconnecting client may resync the
  // still-in-memory pre-restore doc (and even push its local newText back). So
  // we fully close the authoring context after restore, let the server evict the
  // doc, and verify from a brand-new connection.
  const authorCtx = await browser.newContext();
  try {
    const page = await openPageAs(authorCtx, user, tokens, pageTitle);

    // 1. Establish the OLD content and snapshot it.
    await typeOnNewLine(page, oldText);
    await expect(editorOf(page)).toContainText(oldText, { timeout: SYNC_TIMEOUT });

    // A manual snapshot reads the page's PERSISTED ydocState (the sync server
    // persists the Yjs doc on a debounce). Until that first persist lands, the
    // create endpoint 404s and no row appears. Retry the save in a poll loop
    // until a version row shows up, so we don't race the debounced persist.
    await page.getByTestId("toggle-history").click();
    await expect(page.getByTestId("version-panel")).toBeVisible();

    const versionItem = page.getByTestId("version-item").first();
    await expect
      .poll(
        async () => {
          if (await versionItem.isVisible()) return true;
          await page.getByTestId("version-save").click();
          return versionItem.isVisible().catch(() => false);
        },
        {
          message: "version-save should produce a snapshot once the doc has persisted",
          timeout: INDEX_TIMEOUT,
          intervals: [1_000, 1_000, 2_000, 2_000, 3_000],
        },
      )
      .toBe(true);
    await expect(versionItem).toBeVisible({ timeout: SYNC_TIMEOUT });

    // 2. Change the content (add NEW text on top of the old).
    await typeOnNewLine(page, newText);
    await expect(editorOf(page)).toContainText(newText, { timeout: SYNC_TIMEOUT });

    // 3. Preview the saved version: it shows the OLD content, NOT the new text.
    await versionItem.getByTestId("version-item-select").click();
    const preview = page.getByTestId("version-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(oldText, { timeout: SYNC_TIMEOUT });
    await expect(preview).not.toContainText(newText);

    // 4. Restore the saved (old) version (replaces PageContent.ydocState).
    await versionItem.getByTestId("version-restore").click();
    // The restore mutation refetches; give the request a beat to complete before
    // we drop the connection.
    await expect(page.getByTestId("version-restore").first()).toBeEnabled({ timeout: SYNC_TIMEOUT });
  } finally {
    // Drop the authoring connection so Hocuspocus evicts the in-memory doc.
    await authorCtx.close();
  }

  // 5. Verify the restore from a FRESH context. The authoring context is now
  //    closed, so Hocuspocus evicts the in-memory doc and the next connection
  //    re-`fetch`es the restored (old-only) ydocState from Postgres. Give the
  //    server a beat to evict + flush before reconnecting.
  void pageId; // pageId is captured for setup; verification is via the fresh UI session.
  await new Promise((r) => setTimeout(r, 3_000));

  const verifyCtx = await browser.newContext();
  try {
    const verifyPage = await openPageAs(verifyCtx, user, tokens, pageTitle);
    const editor = editorOf(verifyPage);
    await expect(editor).toContainText(oldText, { timeout: SYNC_TIMEOUT });
    await expect(editor).not.toContainText(newText);
  } finally {
    await verifyCtx.close();
  }
});
