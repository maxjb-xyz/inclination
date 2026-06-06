import { expect, test, type APIRequestContext, type BrowserContext, type Page as PwPage } from "@playwright/test";
import { authHeader, registerVerifyLogin, tokenFromMail, type PublicUser, type Tokens } from "./helpers";

/**
 * Phase 5 "Done when" gate (spec §8): a "Tasks" database works as a board grouped
 * by status, a calendar by due date, and a filtered table ("my open tasks"), with
 * a rollup over a linked "Projects" database and a working formula; a sub-task
 * nests under a task; and edits propagate live to a second browser.
 *
 * PART A builds the whole gate scenario through the REST API (Caddy → API →
 * Postgres) and asserts the query engine end-to-end: board grouping by Status,
 * a calendar/filtered query by Due, the rollup number, the formula value, and
 * sub-item nesting. Driving setup + most assertions via the API is robust and
 * avoids flaky UI choreography for the engine clauses.
 *
 * PART B proves the realtime clause through the real UI: two browser contexts
 * (same user, two sockets through Caddy /api/realtime) open the Tasks database;
 * a cell edit in context A propagates to context B live (socket → cache patch →
 * cell input) WITHOUT reloading B.
 *
 * Auth (register → verify via Mailpit → login) and the 429-resilient retry come
 * from ./helpers, shared with the rest of the serial suite.
 */

const PROPAGATION_TIMEOUT = 25_000;
const RENDER_TIMEOUT = 20_000;

// ── Small API helpers (assert success + return JSON) ──────────────────────────

async function post<T>(
  ctx: APIRequestContext,
  path: string,
  access: string,
  data: unknown,
  expected = 201,
): Promise<T> {
  const res = await ctx.post(path, { ...authHeader(access), data });
  if (res.status() !== expected) {
    throw new Error(`POST ${path} → ${res.status()} (expected ${expected}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function put<T>(
  ctx: APIRequestContext,
  path: string,
  access: string,
  data: unknown,
): Promise<T> {
  const res = await ctx.put(path, { ...authHeader(access), data });
  if (res.status() !== 200) {
    throw new Error(`PUT ${path} → ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface PropertyRec {
  id: string;
  name: string;
  type: string;
  config: unknown;
}
interface DatabaseRec {
  pageId: string;
  defaultViewId: string | null;
  properties: PropertyRec[];
  views: { id: string; type: string; name: string }[];
}
interface RowRec {
  id: string;
  parentId: string | null;
  title: string;
}
interface QueryRow {
  pageId: string;
  cells: Record<string, unknown>;
  computed: Record<string, unknown>;
}
interface QueryResult {
  rows: QueryRow[];
  groups?: { key: string; label: string; isEmpty: boolean; pageIds: string[] }[];
  nextCursor: string | null;
}

const createProperty = (
  ctx: APIRequestContext,
  access: string,
  dbId: string,
  input: { name: string; type: string; config?: unknown },
) => post<PropertyRec>(ctx, `/api/databases/${dbId}/properties`, access, input);

const createRow = (
  ctx: APIRequestContext,
  access: string,
  dbId: string,
  input: { title?: string; parentRowId?: string } = {},
) => post<RowRec>(ctx, `/api/databases/${dbId}/rows`, access, input);

const setCell = (
  ctx: APIRequestContext,
  access: string,
  rowId: string,
  propertyId: string,
  value: unknown,
) => put(ctx, `/api/rows/${rowId}/cells/${propertyId}`, access, { value });

const query = (ctx: APIRequestContext, access: string, dbId: string, body: unknown) =>
  post<QueryResult>(ctx, `/api/databases/${dbId}/query`, access, body, 201);

test("PART A — Tasks DB: board by status, calendar/filtered by due, rollup, formula, sub-item via the API", async ({
  request,
}) => {
  // register → verify (Mailpit) → login can sit behind the auth rate-limit window
  // under the serial suite; many setup calls follow, so give it room.
  test.setTimeout(150_000);
  const stamp = Date.now();
  const { tokens } = await registerVerifyLogin(request, {
    email: `db-a-${stamp}@example.com`,
    password: "dbpassword1",
    displayName: "DB A",
  });
  const access = tokens.accessToken;

  // 1. Workspace.
  const ws = await post<{ id: string }>(request, "/api/workspaces", access, {
    name: "DB Gate Workspace",
  });

  // 2. Projects database with a number "Budget" property + 2 rows (Budget 100, 50).
  const projects = await post<DatabaseRec>(
    request,
    `/api/workspaces/${ws.id}/databases`,
    access,
    { title: "Projects" },
  );
  const projectsId = projects.pageId;
  const projectName = projects.properties.find((p) => p.isPrimary === true || p.type === "text")!;
  const budget = await createProperty(request, access, projectsId, {
    name: "Budget",
    type: "number",
  });

  const projA = await createRow(request, access, projectsId, {});
  const projB = await createRow(request, access, projectsId, {});
  await setCell(request, access, projA.id, projectName.id, "Apollo");
  await setCell(request, access, projB.id, projectName.id, "Borealis");
  await setCell(request, access, projA.id, budget.id, 100);
  await setCell(request, access, projB.id, budget.id, 50);

  // 3. Tasks database with status / date / relation / rollup / formula + checkbox.
  const tasks = await post<DatabaseRec>(
    request,
    `/api/workspaces/${ws.id}/databases`,
    access,
    { title: "Tasks" },
  );
  const tasksId = tasks.pageId;
  const taskName = tasks.properties.find((p) => p.isPrimary === true || p.type === "text")!;

  // Status with three options across the canonical groups; capture option ids.
  const todoId = "opt-todo";
  const inProgId = "opt-inprog";
  const doneId = "opt-done";
  const status = await createProperty(request, access, tasksId, {
    name: "Status",
    type: "status",
    config: {
      options: [
        { id: todoId, name: "To do", color: "gray" },
        { id: inProgId, name: "In progress", color: "blue" },
        { id: doneId, name: "Done", color: "green" },
      ],
      groups: [
        { id: "grp-todo", name: "To-do", group: "todo", optionIds: [todoId] },
        { id: "grp-prog", name: "In progress", group: "in_progress", optionIds: [inProgId] },
        { id: "grp-done", name: "Complete", group: "complete", optionIds: [doneId] },
      ],
    },
  });

  const due = await createProperty(request, access, tasksId, { name: "Due", type: "date" });

  // Done checkbox drives the formula.
  const doneFlag = await createProperty(request, access, tasksId, { name: "Done", type: "checkbox" });

  // Relation → Projects.
  const project = await createProperty(request, access, tasksId, {
    name: "Project",
    type: "relation",
    config: { targetDatabaseId: projectsId },
  });

  // Rollup over the Project relation aggregating Budget (sum).
  const projectBudget = await createProperty(request, access, tasksId, {
    name: "Project Budget",
    type: "rollup",
    config: {
      relationPropertyId: project.id,
      targetPropertyId: budget.id,
      aggregation: "sum",
    },
  });

  // Formula: if(prop("Done"), "✓", "…") — evaluates per row from the checkbox.
  const statusIcon = await createProperty(request, access, tasksId, {
    name: "StatusIcon",
    type: "formula",
    config: { expression: 'if(prop("Done"), "✓", "…")' },
  });

  // 4. Several task rows: varied status, due dates, relations; plus a sub-task.
  const t1 = await createRow(request, access, tasksId, {}); // To do, due, linked to A+B, Done=true
  const t2 = await createRow(request, access, tasksId, {}); // In progress, due, linked to A
  const t3 = await createRow(request, access, tasksId, {}); // Done, due
  const t4 = await createRow(request, access, tasksId, {}); // To do, no due

  await setCell(request, access, t1.id, taskName.id, "Write spec");
  await setCell(request, access, t2.id, taskName.id, "Build API");
  await setCell(request, access, t3.id, taskName.id, "Ship it");
  await setCell(request, access, t4.id, taskName.id, "Backlog item");

  await setCell(request, access, t1.id, status.id, todoId);
  await setCell(request, access, t2.id, status.id, inProgId);
  await setCell(request, access, t3.id, status.id, doneId);
  await setCell(request, access, t4.id, status.id, todoId);

  await setCell(request, access, t1.id, due.id, { start: "2026-06-10" });
  await setCell(request, access, t2.id, due.id, { start: "2026-06-12" });
  await setCell(request, access, t3.id, due.id, { start: "2026-06-15" });
  // t4 has no due date.

  await setCell(request, access, t1.id, doneFlag.id, true);

  // Relations: t1 → projA + projB (budget 100 + 50 = 150), t2 → projA (100).
  await post(request, `/api/properties/${project.id}/links`, access, {
    propertyId: project.id,
    fromRowId: t1.id,
    toRowId: projA.id,
  });
  await post(request, `/api/properties/${project.id}/links`, access, {
    propertyId: project.id,
    fromRowId: t1.id,
    toRowId: projB.id,
  });
  await post(request, `/api/properties/${project.id}/links`, access, {
    propertyId: project.id,
    fromRowId: t2.id,
    toRowId: projA.id,
  });

  // Sub-task nested under t1.
  const sub = await createRow(request, access, tasksId, { parentRowId: t1.id });
  await setCell(request, access, sub.id, taskName.id, "Draft outline");

  // ── 5a. BOARD: query grouped by Status → groups carry the right rows. ────────
  const board = await query(request, access, tasksId, { config: { groupBy: status.id } });
  expect(board.groups, "board query returns groups").toBeTruthy();
  const groupByKey = new Map(board.groups!.map((g) => [g.key, g]));
  // Each status option appears as a column (option-id keyed).
  expect(groupByKey.has(todoId)).toBe(true);
  expect(groupByKey.has(inProgId)).toBe(true);
  expect(groupByKey.has(doneId)).toBe(true);
  // To-do column holds t1 + t4; In progress holds t2; Done holds t3.
  expect(new Set(groupByKey.get(todoId)!.pageIds)).toEqual(new Set([t1.id, t4.id]));
  expect(groupByKey.get(inProgId)!.pageIds).toEqual([t2.id]);
  expect(groupByKey.get(doneId)!.pageIds).toEqual([t3.id]);

  // ── 5b. CALENDAR + FILTERED TABLE: "my open tasks" = Status != Done. ─────────
  // Calendar view is driven by the Due date property; the filtered table excludes
  // Done. Combine: a query filtered to non-Done tasks that have a Due date.
  const openByDue = await query(request, access, tasksId, {
    config: {
      dateProperty: due.id,
      filters: {
        conjunction: "and",
        conditions: [
          { propertyId: status.id, operator: "not_equals", value: doneId },
          { propertyId: due.id, operator: "is_not_empty" },
        ],
      },
      sorts: [{ propertyId: due.id, direction: "asc" }],
    },
  });
  // t1 (To do, due 06-10) and t2 (In progress, due 06-12) qualify; t3 is Done,
  // t4 has no due date → both excluded.
  expect(openByDue.rows.map((r) => r.pageId)).toEqual([t1.id, t2.id]);

  // A pure "my open tasks" filtered table (Status != Done). t3 is Done →
  // excluded. The sub-task has no Status set, so "empty != Done" keeps it; the
  // engine includes sub-items in the database row set. So the open set is
  // t1, t2, t4 and the sub-task (nested under t1).
  const openTasks = await query(request, access, tasksId, {
    config: {
      filters: {
        conjunction: "and",
        conditions: [{ propertyId: status.id, operator: "not_equals", value: doneId }],
      },
    },
  });
  const openIds = new Set(openTasks.rows.map((r) => r.pageId));
  // The Done task is excluded; the three non-Done top-level tasks are present.
  expect(openIds.has(t3.id)).toBe(false);
  expect(openIds.has(t1.id)).toBe(true);
  expect(openIds.has(t2.id)).toBe(true);
  expect(openIds.has(t4.id)).toBe(true);
  // The sub-task (no Status) is also open.
  expect(openIds.has(sub.id)).toBe(true);

  // ── 5c. ROLLUP: t1's Project Budget = 100 + 50 = 150; t2 = 100; t3 = 0. ──────
  const full = await query(request, access, tasksId, {});
  const rowById = new Map(full.rows.map((r) => [r.pageId, r]));
  expect(rowById.get(t1.id)!.computed[projectBudget.id]).toBe(150);
  expect(rowById.get(t2.id)!.computed[projectBudget.id]).toBe(100);
  expect(rowById.get(t3.id)!.computed[projectBudget.id]).toBe(0);

  // ── 5d. FORMULA: if(prop("Done"), "✓", "…") → t1 checked = "✓", t2 = "…". ────
  expect(rowById.get(t1.id)!.computed[statusIcon.id]).toBe("✓");
  expect(rowById.get(t2.id)!.computed[statusIcon.id]).toBe("…");

  // ── 5e. SUB-ITEM: the sub-task nests under t1 (parentId === t1). ─────────────
  const rows = await (
    await request.get(`/api/databases/${tasksId}/rows`, authHeader(access))
  ).json() as RowRec[];
  const subRow = rows.find((r) => r.id === sub.id);
  expect(subRow, "sub-task row is listed").toBeTruthy();
  expect(subRow!.parentId).toBe(t1.id);
  // It is NOT a top-level row (its parent is a row, not the container).
  expect(subRow!.parentId).not.toBe(tasksId);
});

// ── PART B — live propagation to a second browser ─────────────────────────────

/** Seed an authed SPA session and open the Tasks database page; returns the page. */
async function openDatabaseAs(
  context: BrowserContext,
  user: PublicUser,
  tokens: Tokens,
  dbTitle: string,
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
  await expect(page.getByTestId("current-user")).toBeVisible({ timeout: RENDER_TIMEOUT });
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar).toBeVisible();

  // Open the database page by its title via the sidebar .page-link button.
  const row = sidebar.locator(".page-link", { hasText: dbTitle });
  await expect(row).toBeVisible({ timeout: RENDER_TIMEOUT });
  await row.click();

  // The DatabaseView renders; default view is a table.
  await expect(page.getByTestId("db-view")).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(page.getByTestId("db-table")).toBeVisible({ timeout: RENDER_TIMEOUT });

  return page;
}

test("PART B — a cell edit in one browser propagates live to a second browser", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();

  // The database realtime layer suppresses a subscriber's OWN echoes (an event
  // whose actorId === the current user is ignored, since local edits are
  // optimistic). To genuinely prove cross-browser propagation we therefore use
  // TWO DISTINCT users in one shared workspace: owner A edits, member B (a
  // different user) receives the broadcast. A owns + seeds the workspace; B is
  // invited and accepts via the Mailpit invite token. Each browser is seeded
  // with its own user's session.
  const owner = await registerVerifyLogin(request, {
    email: `db-owner-${stamp}@example.com`,
    password: "dbpassword1",
    displayName: "DB Owner",
  });
  const accessA = owner.tokens.accessToken;

  const memberAccount = {
    email: `db-member-${stamp}@example.com`,
    password: "dbpassword1",
    displayName: "DB Member",
  };
  const member = await registerVerifyLogin(request, memberAccount);
  const accessB = member.tokens.accessToken;

  // Build a tiny Tasks DB (owned by A) with a number "Estimate" property and one
  // row, so the table renders a single settable number cell editor.
  const ws = await post<{ id: string }>(request, "/api/workspaces", accessA, {
    name: "Realtime Workspace",
  });
  const dbTitle = `Tasks Live ${stamp}`;
  const db = await post<DatabaseRec>(request, `/api/workspaces/${ws.id}/databases`, accessA, {
    title: dbTitle,
  });
  const dbId = db.pageId;
  const nameProp = db.properties.find((p) => p.isPrimary === true || p.type === "text")!;
  const estimate = await createProperty(request, accessA, dbId, {
    name: "Estimate",
    type: "number",
  });
  const r1 = await createRow(request, accessA, dbId, {});
  await setCell(request, accessA, r1.id, nameProp.id, "Live task");
  await setCell(request, accessA, r1.id, estimate.id, 1);

  // Make Estimate part of the default (table) view so its cell renders.
  await request.patch(`/api/views/${db.defaultViewId}`, {
    ...authHeader(accessA),
    data: { config: { visibleProperties: [nameProp.id, estimate.id] } },
  });

  // Invite B to A's workspace, then B accepts via the Mailpit invite token. B
  // now has exactly one workspace (the shared one), so the SPA opens it.
  await post(request, `/api/workspaces/${ws.id}/invitations`, accessA, {
    email: memberAccount.email,
    role: "member",
  });
  const inviteToken = await tokenFromMail(request, memberAccount.email, "accept-invite");
  // Accept as B (the JWT-authenticated member); the route is auth-guarded.
  await post(request, "/api/invitations/accept", accessB, { token: inviteToken }, 200);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await openDatabaseAs(contextA, owner.user, owner.tokens, dbTitle);
    const pageB = await openDatabaseAs(contextB, member.user, member.tokens, dbTitle);

    // Both browsers show the row with the seeded estimate (1).
    const cellA = pageA.getByTestId(`db-cell-${r1.id}-${estimate.id}`);
    const cellB = pageB.getByTestId(`db-cell-${r1.id}-${estimate.id}`);
    const editorA = cellA.getByTestId("cell-editor-number");
    const editorB = cellB.getByTestId("cell-editor-number");
    await expect(editorA).toHaveValue("1", { timeout: RENDER_TIMEOUT });
    await expect(editorB).toHaveValue("1", { timeout: RENDER_TIMEOUT });

    // REAL UI EDIT in context A: type a new number into the cell editor and blur
    // to commit. The optimistic local update + the cell.updated realtime event
    // broadcast to context B, whose cached query result is patched in place and
    // re-renders the cell input — WITHOUT reloading B.
    const newValue = "42";
    await editorA.click();
    await editorA.fill(newValue);
    await editorA.blur();

    // A reflects it locally (optimistic), and B reflects it live over the socket.
    await expect(editorA).toHaveValue(newValue, { timeout: PROPAGATION_TIMEOUT });
    await expect(editorB).toHaveValue(newValue, { timeout: PROPAGATION_TIMEOUT });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
