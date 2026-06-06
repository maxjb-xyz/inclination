import { expect, test, type BrowserContext, type Page as PwPage } from "@playwright/test";
import { authHeader, registerVerifyLogin, type PublicUser, type Tokens } from "./helpers";

/**
 * Phase 4 "Done when" gate (spec §8): every block type can be inserted via the
 * slash menu and round-trips through reload + collaboration; mentioning a page
 * creates a working backlink.
 *
 * Strategy:
 *  - Register/verify/login ONE user via the API (Mailpit), create a workspace
 *    and two pages P and B via the API.
 *  - Seed an authed SPA session (localStorage "inclination-auth") and open P.
 *  - Drive the SLASH MENU to insert a broad-but-representative set of block
 *    types, type some content, assert the DOM nodes appear, then RELOAD and
 *    assert the blocks/content survived (Yjs/collab persistence).
 *  - Insert a page-link to B via the `[[` suggestion, wait for the debounced
 *    reference sync, open B, and assert its Linked-references panel lists P
 *    (clicking it navigates back to P). This is the core backlink gate.
 */

// The collaborative editor connects over a websocket through Caddy; give it room.
const SYNC_TIMEOUT = 20_000;
// Reference sync is debounced (~800ms) before it PUTs; allow a generous settle.
const REFERENCE_SYNC_SETTLE = 1_500;

const editorOf = (page: PwPage) => page.getByTestId("editor").locator(".ProseMirror");
const presenceOf = (page: PwPage) => page.getByTestId("presence-indicator");

/**
 * Seed an authenticated SPA session as the given user, load the workspace
 * shell, open the named page via its sidebar row, and return once the
 * collaborative editor is visible and the websocket reports "Connected".
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
  await openExistingPage(page, pageTitle);
  return page;
}

/** Open (or re-open) an existing page by title from the sidebar, on an already-loaded page. */
async function openExistingPage(page: PwPage, pageTitle: string): Promise<void> {
  await expect(page.getByTestId("current-user")).toBeVisible({ timeout: SYNC_TIMEOUT });
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar).toBeVisible({ timeout: SYNC_TIMEOUT });

  const row = sidebar.locator(".page-link", { hasText: pageTitle });
  await expect(row).toBeVisible({ timeout: SYNC_TIMEOUT });
  await row.click();

  const editor = editorOf(page);
  await expect(editor).toBeVisible({ timeout: SYNC_TIMEOUT });
  await expect(presenceOf(page)).toContainText("Connected", { timeout: SYNC_TIMEOUT });
}

/**
 * Insert a block via the slash menu: move the caret to a fresh empty line,
 * type "/" + the item's filter text (matched against title/keywords), confirm
 * the popup lists the target item, then select it with Enter. Returns once the
 * slash popup has closed (the block command has run).
 */
async function insertViaSlashMenu(page: PwPage, filter: string, itemId: string): Promise<void> {
  const editor = editorOf(page);
  await editor.click();
  // Land on a FRESH TOP-LEVEL empty paragraph so the next block isn't created
  // nested inside the previous structure (e.g. a new bullet/task item or a line
  // inside a blockquote/callout). Move to the end, then press Enter twice: the
  // first opens a new line/item, the second lifts an empty list/quote item back
  // out to a top-level paragraph (a no-op-ish blank line for plain paragraphs).
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");

  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible({ timeout: SYNC_TIMEOUT });

  // The slash suggestion is configured with allowSpaces:false, so the filter
  // must be a single token (a keyword/title fragment) — a space would close it.
  await page.keyboard.type(filter);
  // The desired item must be present in the filtered list.
  const item = menu.locator(`[data-item-id="${itemId}"]`);
  await expect(item).toBeVisible({ timeout: SYNC_TIMEOUT });
  // Click it directly (mousedown-based, preserves the editor selection) — more
  // robust than relying on keyboard highlight order across the filtered set.
  await item.click();

  // Popup closes once the command runs.
  await expect(menu).toBeHidden({ timeout: SYNC_TIMEOUT });
}

test("slash menu inserts every representative block type and they survive reload", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `editor-blocks-${stamp}@example.com`,
    password: "editorpassword1",
    displayName: "Editor Blocks",
  };

  // 1. Register → verify → login, create a workspace + page P via the API.
  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;

  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: "Editor Workspace" },
  });
  expect(wsRes.status()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const pageTitle = `Blocks Page ${stamp}`;
  const pageRes = await request.post(`/api/workspaces/${wsId}/pages`, {
    ...authHeader(access),
    data: { title: pageTitle },
  });
  expect(pageRes.status()).toBe(201);

  const context = await browser.newContext();
  try {
    const page = await openPageAs(context, user, tokens, pageTitle);
    const editor = editorOf(page);

    // 2. Insert a broad-but-representative set of block types through the slash
    //    menu, covering text/heading, list, to-do, quote, callout, divider, and
    //    code. After inserting the text-bearing ones we type a marker so we can
    //    assert the content (not just the node shape) survives reload.
    //
    //    Skipped via slash here (and why): media/embed/image/file/video,
    //    bookmark, equation, table, columns, toc — these need URL/picker input
    //    or produce empty placeholder NodeViews whose *content* can't be typed
    //    via the keyboard in headless, so they don't add round-trip signal
    //    beyond what the structural blocks below already prove. pageLink/mention
    //    are exercised by the dedicated backlink test.

    // Heading 1 (filter keyword "h1" → id heading1) with marker text.
    const headingText = `Heading-${stamp}`;
    await insertViaSlashMenu(page, "h1", "heading1");
    await page.keyboard.type(headingText);
    await expect(editor.locator("h1")).toHaveText(headingText, { timeout: SYNC_TIMEOUT });

    // Bulleted list.
    const bulletText = `Bullet-${stamp}`;
    await insertViaSlashMenu(page, "bullet", "bulletList");
    await page.keyboard.type(bulletText);
    // Scope to a plain bulleted list item (the task list also renders as ul>li).
    await expect(editor.locator("ul:not([data-type]) li", { hasText: bulletText })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // To-do / task list (checkbox).
    const todoText = `Todo-${stamp}`;
    await insertViaSlashMenu(page, "todo", "taskList");
    await page.keyboard.type(todoText);
    await expect(editor.locator('input[type="checkbox"]')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(editor.locator('li[data-type="taskItem"], .task-item, ul[data-type="taskList"] li'))
      .toContainText(todoText, { timeout: SYNC_TIMEOUT });

    // Quote / blockquote.
    const quoteText = `Quote-${stamp}`;
    await insertViaSlashMenu(page, "quote", "quote");
    await page.keyboard.type(quoteText);
    await expect(editor.locator("blockquote")).toContainText(quoteText, { timeout: SYNC_TIMEOUT });

    // Callout (custom node → div[data-type="callout"]).
    const calloutText = `Callout-${stamp}`;
    await insertViaSlashMenu(page, "callout", "callout");
    await page.keyboard.type(calloutText);
    await expect(editor.locator('[data-type="callout"]')).toContainText(calloutText, {
      timeout: SYNC_TIMEOUT,
    });

    // Divider (horizontal rule — no typed content).
    await insertViaSlashMenu(page, "divider", "divider");
    await expect(editor.locator("hr")).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Heading 2 — a second heading level, proving the slash filter discriminates.
    const heading2Text = `Subheading-${stamp}`;
    await insertViaSlashMenu(page, "h2", "heading2");
    await page.keyboard.type(heading2Text);
    await expect(editor.locator("h2")).toHaveText(heading2Text, { timeout: SYNC_TIMEOUT });

    // Code block (CodeBlockLowlight → pre code). Inserted LAST: the caret is
    // trapped inside a code block (Enter inserts newlines rather than exiting),
    // so no further slash insertion can follow it from the keyboard.
    const codeText = `code_${stamp}`;
    await insertViaSlashMenu(page, "code", "codeBlock");
    await page.keyboard.type(codeText);
    await expect(editor.locator("pre code")).toContainText(codeText, { timeout: SYNC_TIMEOUT });

    // 3. Wait for the Yjs update to flush to the sync server, then reload and
    //    reopen P. Persistence is the sync server's job (Yjs over /collab), so
    //    settle briefly after "Connected" before reloading.
    await expect(presenceOf(page)).toContainText("Connected", { timeout: SYNC_TIMEOUT });
    await page.waitForTimeout(REFERENCE_SYNC_SETTLE);

    await page.reload();
    await openExistingPage(page, pageTitle);

    const editorAfter = editorOf(page);
    // Every typed block + its content must have survived the reload.
    await expect(editorAfter.locator("h1")).toHaveText(headingText, { timeout: SYNC_TIMEOUT });
    await expect(editorAfter.locator("h2")).toHaveText(heading2Text, { timeout: SYNC_TIMEOUT });
    await expect(
      editorAfter.locator("ul:not([data-type]) li", { hasText: bulletText }),
    ).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(editorAfter.locator('input[type="checkbox"]')).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(editorAfter).toContainText(todoText, { timeout: SYNC_TIMEOUT });
    await expect(editorAfter.locator("blockquote")).toContainText(quoteText, {
      timeout: SYNC_TIMEOUT,
    });
    await expect(editorAfter.locator('[data-type="callout"]')).toContainText(calloutText, {
      timeout: SYNC_TIMEOUT,
    });
    await expect(editorAfter.locator("pre code")).toContainText(codeText, { timeout: SYNC_TIMEOUT });
    await expect(editorAfter.locator("hr")).toBeVisible({ timeout: SYNC_TIMEOUT });
  } finally {
    await context.close();
  }
});

test("mentioning a page via [[ creates a working backlink (Linked references)", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `backlink-${stamp}@example.com`,
    password: "backlinkpassword1",
    displayName: "Backlink User",
  };

  // 1. Register → verify → login, workspace + two pages P and B via the API.
  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;

  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: "Backlink Workspace" },
  });
  expect(wsRes.status()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const sourceTitle = `Source P ${stamp}`;
  const targetTitle = `Target B ${stamp}`;
  const mkPage = async (title: string) => {
    const res = await request.post(`/api/workspaces/${wsId}/pages`, {
      ...authHeader(access),
      data: { title },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: string };
  };
  await mkPage(sourceTitle);
  const targetPage = await mkPage(targetTitle);

  const context = await browser.newContext();
  try {
    // 2. Open source page P, insert a page-link to B via the `[[` suggestion.
    const page = await openPageAs(context, user, tokens, sourceTitle);
    const editor = editorOf(page);

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    // Open the page-link suggestion. The `[[` suggestion (like the slash menu)
    // does not allow spaces, so filter by a single token from B's title.
    await page.keyboard.type("[[");
    const mentionMenu = page.getByTestId("mention-menu");
    await expect(mentionMenu).toBeVisible({ timeout: SYNC_TIMEOUT });
    // "Target" matches only page B (P is "Source P …"); search is debounced ~200ms.
    await page.keyboard.type("Target");
    // The popup must list page B.
    const option = mentionMenu.locator(`[data-item-id="${targetPage.id}"]`);
    await expect(option).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(option).toContainText(targetTitle);
    await option.click();
    await expect(mentionMenu).toBeHidden({ timeout: SYNC_TIMEOUT });

    // The inserted pageLink node renders with the target page id.
    const inserted = editor.locator(`[data-testid="page-link"] [data-page-id="${targetPage.id}"]`);
    await expect(inserted).toBeVisible({ timeout: SYNC_TIMEOUT });

    // 3. Wait for the debounced reference sync (~800ms) to PUT the references,
    //    plus a margin. This is the one place we intentionally wait on a timer.
    await expect(presenceOf(page)).toContainText("Connected", { timeout: SYNC_TIMEOUT });
    await page.waitForTimeout(REFERENCE_SYNC_SETTLE + 800);

    // 4. Open page B and assert its Linked-references panel lists P, and that
    //    clicking it navigates to P. This is the core backlink gate.
    await openExistingPage(page, targetTitle);

    const backlinks = page.getByTestId("backlinks-panel");
    await expect(backlinks).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(backlinks).toContainText("Linked references");
    const backlinkRow = backlinks.locator(".backlinks__item", { hasText: sourceTitle });
    await expect(backlinkRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Clicking the backlink navigates back to the source page P.
    await backlinkRow.click();
    await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(sourceTitle, {
      timeout: SYNC_TIMEOUT,
    });
  } finally {
    await context.close();
  }
});
