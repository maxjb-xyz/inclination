import { expect, test, type BrowserContext, type Page as PwPage } from "@playwright/test";
import { authHeader, registerVerifyLogin, type PublicUser, type Tokens } from "./helpers";

/**
 * Phase 3 "Done when" gate (spec §8): two browsers editing the same page see
 * merged edits and live cursors, and offline edits sync on reconnect.
 *
 * We register/verify/login ONE user U via the API, create a workspace and a
 * single known page P, then open P in two independent real browser contexts
 * (two separate websocket connections to the Hocuspocus sync server through
 * Caddy's /collab route). Same user, two contexts is still genuine multiplayer
 * — two distinct Yjs clients merging over the wire — and is the least flaky
 * way to prove the gate.
 */

// Editor sync goes over a websocket through Caddy; give it room.
const SYNC_TIMEOUT = 20_000;
// Reconnect + offline replay is slower than steady-state sync.
const RECONNECT_TIMEOUT = 40_000;

const editorOf = (page: PwPage) => page.getByTestId("editor").locator(".ProseMirror");
const presenceOf = (page: PwPage) => page.getByTestId("presence-indicator");

/**
 * Seed an authenticated SPA session as the given user, open the workspace
 * shell, and open the known page P by clicking its sidebar row. Returns once
 * the collaborative editor is visible and the presence indicator reports
 * "Connected".
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

  // Open page P by its title via the sidebar .page-link button.
  const row = sidebar.locator(".page-link", { hasText: pageTitle });
  await expect(row).toBeVisible({ timeout: SYNC_TIMEOUT });
  await row.click();

  const editor = editorOf(page);
  await expect(editor).toBeVisible({ timeout: SYNC_TIMEOUT });
  // The websocket must reach "Connected" before edits will propagate.
  await expect(presenceOf(page)).toContainText("Connected", { timeout: SYNC_TIMEOUT });

  return page;
}

/** Move the caret to the end of the doc and start a fresh line, then type. */
async function typeOnNewLine(page: PwPage, text: string): Promise<void> {
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

test("two browsers see merged edits, live cursors, and offline edits sync on reconnect", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = {
    email: `collab-${stamp}@example.com`,
    password: "collabpassword1",
    displayName: "Collab User",
  };

  // 1. Register → verify → login user U via the API.
  const { user, tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;

  // Create a workspace and ONE known page P so both browsers open the same id.
  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: "Collab Workspace" },
  });
  expect(wsRes.status()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const pageTitle = `Collab Page ${stamp}`;
  const pageRes = await request.post(`/api/workspaces/${wsId}/pages`, {
    ...authHeader(access),
    data: { title: pageTitle },
  });
  expect(pageRes.status()).toBe(201);

  // 2. Open the same page in two independent browser contexts (two real ws
  //    connections through Caddy /collab).
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    const pageA = await openPageAs(contextA, user, tokens, pageTitle);
    const pageB = await openPageAs(contextB, user, tokens, pageTitle);

    const editorA = editorOf(pageA);
    const editorB = editorOf(pageB);

    // 3. Merged edits: type in A, see it in B; type in B, see it in A.
    const sentenceA = `From-A-${stamp}-hello`;
    await typeOnNewLine(pageA, sentenceA);
    // Confirm the text actually landed locally before asserting it propagates.
    await expect(editorA).toContainText(sentenceA, { timeout: SYNC_TIMEOUT });
    await expect(editorB).toContainText(sentenceA, { timeout: SYNC_TIMEOUT });

    const sentenceB = `From-B-${stamp}-world`;
    await typeOnNewLine(pageB, sentenceB);
    await expect(editorA).toContainText(sentenceB, { timeout: SYNC_TIMEOUT });

    // 4. Live cursors: with B focused (it just typed), A should render B's
    //    remote caret/label. Keep a selection active in B to ensure the caret
    //    is present, then assert a remote cursor shows up in A.
    await editorB.click();
    await pageB.keyboard.press("Control+End");
    await pageB.keyboard.press("Shift+Home");
    const remoteCaretInA = pageA
      .locator(".collaboration-cursor__caret, .collaboration-cursor__label")
      .first();
    await expect(remoteCaretInA).toBeVisible({ timeout: SYNC_TIMEOUT });

    // 5. Offline then reconnect.
    //    a) Take B offline. We do NOT assert the presence text flips — the
    //       provider keeps its last status until the dropped socket is detected,
    //       which is timing-dependent. The real gate is convergence on reconnect,
    //       which we prove via the negative checks below plus the reconnect
    //       assertions. The negative checks confirm B is genuinely partitioned.
    await contextB.setOffline(true);

    const sentenceWhileBOffline = `From-A-offline-${stamp}-alpha`;
    await typeOnNewLine(pageA, sentenceWhileBOffline);
    // B must NOT receive A's edit while partitioned (proves it is offline).
    await expect(editorB).not.toContainText(sentenceWhileBOffline, { timeout: 4_000 });

    //    b) Make an edit IN B while it is offline — this is the core of the gate:
    //       offline edits must replay to A after reconnect.
    const sentenceMadeWhileBOffline = `From-B-offline-${stamp}-beta`;
    await typeOnNewLine(pageB, sentenceMadeWhileBOffline);
    // A must NOT have B's offline edit yet either (B's updates can't leave).
    await expect(editorA).not.toContainText(sentenceMadeWhileBOffline, { timeout: 4_000 });

    //    c) Reconnect B and assert both directions converge.
    await contextB.setOffline(false);
    await expect(presenceOf(pageB)).toContainText("Connected", { timeout: RECONNECT_TIMEOUT });

    // A's edit made during B's outage now reaches B.
    await expect(editorB).toContainText(sentenceWhileBOffline, { timeout: RECONNECT_TIMEOUT });
    // B's offline edit replays to A — the gate's core assertion.
    await expect(editorA).toContainText(sentenceMadeWhileBOffline, { timeout: RECONNECT_TIMEOUT });

    // Convergence: after reconnect both editors hold the SAME merged set of the
    // post-partition edits (Yjs may reorder/coalesce concurrent inserts, so we
    // assert the union of edits made on both sides rather than exact equality).
    for (const ed of [editorA, editorB]) {
      await expect(ed).toContainText(sentenceWhileBOffline, { timeout: RECONNECT_TIMEOUT });
      await expect(ed).toContainText(sentenceMadeWhileBOffline, { timeout: RECONNECT_TIMEOUT });
    }
  } finally {
    // 6. Tear down both contexts.
    await contextA.close();
    await contextB.close();
  }
});
