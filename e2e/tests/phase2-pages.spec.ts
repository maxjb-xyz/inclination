import { expect, test } from "@playwright/test";
import { authHeader, registerVerifyLogin } from "./helpers";

/**
 * Phase 2 "Done when" gate (spec §8): pages can be created / nested / moved /
 * trashed / restored and text edits persist across reload.
 *
 * PART A exercises the page-tree REST API end to end through the real stack
 * (Caddy → API → Postgres), which is robust and avoids flaky drag-and-drop.
 * PART B drives the real SPA to prove that editor text survives a reload.
 *
 * Auth (register → verify via Mailpit → login) and the 429-resilient retry live
 * in ./helpers, shared with phase3/phase4 so the whole serial suite tolerates
 * the auth rate limiter (5/min/IP) without duplicated, drifting copies.
 */

interface Page {
  id: string;
  parentId: string | null;
  sortKey: string;
  title: string;
}

test("PART A — pages create/nest/move/trash/restore and content round-trips via the API", async ({
  request,
}) => {
  // register → verify (Mailpit poll) → login can sit behind the auth rate-limit
  // window under the serial suite; give the 429 retries room beyond the default.
  test.setTimeout(120_000);
  const stamp = Date.now();
  const account = {
    email: `pages-a-${stamp}@example.com`,
    password: "pagespassword1",
    displayName: "Pages A",
  };

  // 1. Register → verify → login.
  const { tokens } = await registerVerifyLogin(request, account);
  const access = tokens.accessToken;

  // 2. Create a workspace.
  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(access),
    data: { name: "Pages Workspace" },
  });
  expect(wsRes.status()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const createPage = async (data: Record<string, unknown>): Promise<Page> => {
    const res = await request.post(`/api/workspaces/${wsId}/pages`, {
      ...authHeader(access),
      data,
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as Page;
  };
  const tree = async (): Promise<Page[]> => {
    const res = await request.get(`/api/workspaces/${wsId}/pages`, authHeader(access));
    expect(res.status()).toBe(200);
    return (await res.json()) as Page[];
  };
  const trashList = async (): Promise<Page[]> => {
    const res = await request.get(`/api/workspaces/${wsId}/trash`, authHeader(access));
    expect(res.status()).toBe(200);
    return (await res.json()) as Page[];
  };
  // Ordered ids of the root pages, by sortKey.
  const rootOrder = (pages: Page[]): string[] =>
    pages
      .filter((p) => p.parentId === null)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map((p) => p.id);

  // 3. Create A and B at root; C nested under A.
  const a = await createPage({ title: "Page A" });
  const b = await createPage({ title: "Page B" });
  const c = await createPage({ title: "Page C", parentId: a.id });

  let pages = await tree();
  const byId = (id: string) => pages.find((p) => p.id === id)!;
  expect(byId(c.id).parentId).toBe(a.id); // nesting reflected
  // A was created before B, so A sorts before B at root.
  expect(rootOrder(pages)).toEqual([a.id, b.id]);

  // 4a. Reorder: move B before A at root. Per the move contract, `afterId` is
  //     the sibling the moved page should come BEFORE, so afterId=A puts B first.
  const move = async (id: string, input: Record<string, unknown>) => {
    const res = await request.post(`/api/pages/${id}/move`, { ...authHeader(access), data: input });
    expect(res.status()).toBe(201);
    return res;
  };
  await move(b.id, { afterId: a.id });
  pages = await tree();
  expect(rootOrder(pages)).toEqual([b.id, a.id]);

  // 4b. Reparent: move B under A.
  await move(b.id, { parentId: a.id });
  pages = await tree();
  expect(pages.find((p) => p.id === b.id)!.parentId).toBe(a.id);
  // A is now the only root page.
  expect(rootOrder(pages)).toEqual([a.id]);

  // 5. Trash A → A and its descendants (B, C) disappear from the tree and
  //    appear in the trash; restore brings them back.
  const del = await request.delete(`/api/pages/${a.id}`, authHeader(access));
  expect(del.status()).toBe(200);

  pages = await tree();
  const liveIds = pages.map((p) => p.id);
  expect(liveIds).not.toContain(a.id);
  expect(liveIds).not.toContain(b.id);
  expect(liveIds).not.toContain(c.id);

  const trashed = (await trashList()).map((p) => p.id);
  expect(trashed).toEqual(expect.arrayContaining([a.id, b.id, c.id]));

  const restore = await request.post(`/api/pages/${a.id}/restore`, authHeader(access));
  expect(restore.status()).toBe(201);
  pages = await tree();
  const restoredIds = pages.map((p) => p.id);
  expect(restoredIds).toEqual(expect.arrayContaining([a.id, b.id, c.id]));

  // 6. Content round-trip via PUT/GET with a Tiptap JSON doc.
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: `round-trip content ${stamp}` }],
      },
    ],
  };
  const put = await request.put(`/api/pages/${a.id}/content`, {
    ...authHeader(access),
    data: { doc },
  });
  expect(put.status()).toBe(200);

  const get = await request.get(`/api/pages/${a.id}/content`, authHeader(access));
  expect(get.status()).toBe(200);
  expect((await get.json()).doc).toEqual(doc);
});

test("PART B — editor text persists across reload via the real UI", async ({ page, request }) => {
  // This test does register+verify (Mailpit polling) AND exercises the collab
  // websocket persistence path (Yjs over /collab), then reloads — more than the
  // default 30s budget. Give it room so it is not flaky on a slow Mailpit poll.
  test.setTimeout(90_000);
  const stamp = Date.now();
  const account = {
    email: `pages-b-${stamp}@example.com`,
    password: "pagespassword1",
    displayName: "Pages B",
  };

  // 7. Seed an authenticated session via the API, then prime localStorage with
  //    the zustand-persist shape before any app code runs.
  const { user, tokens } = await registerVerifyLogin(request, account);
  const persisted = JSON.stringify({ state: { user, tokens }, version: 0 });
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    ["inclination-auth", persisted],
  );

  // 8. Load the authenticated shell.
  await page.goto("/");
  await expect(page.getByTestId("current-user")).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar).toBeVisible();

  // Create a fresh page from the sidebar "New page" control and open it.
  await sidebar.getByRole("button", { name: "New page" }).click();
  await expect(page.getByRole("textbox", { name: "Page title" })).toBeVisible();

  // Type a distinctive sentence into the Tiptap (ProseMirror) editor.
  const sentence = `Persisted editor text ${stamp}.`;
  const editor = page.getByTestId("editor").locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(sentence);
  await expect(editor).toContainText(sentence);

  // The page body is now collaborative: persistence is the sync server's job
  // (Yjs over the /collab websocket), not a REST autosave. Wait for the collab
  // session to report "Connected" so the typed update is flushed to the server,
  // then give the debounced store a brief moment before reloading.
  await expect(page.getByTestId("presence-indicator")).toContainText("Connected", {
    timeout: 15_000,
  });
  await page.waitForTimeout(1_500);

  // 9. Reload, reopen the page, and assert the text survived. This is the gate.
  await page.reload();
  await expect(page.getByTestId("current-user")).toBeVisible();
  const sidebarAfter = page.getByRole("navigation", { name: "Pages" });
  // Reopen the page via its sidebar link (the .page-link button in the row).
  await sidebarAfter.getByTestId("page-row").first().locator(".page-link").click();

  const editorAfter = page.getByTestId("editor").locator(".ProseMirror");
  await expect(editorAfter).toBeVisible();
  await expect(editorAfter).toContainText(sentence, { timeout: 10_000 });
});
