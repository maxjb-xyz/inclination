import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";

/**
 * Phase 5 (T3) integration: database/property/view/row/cell/relation CRUD and
 * the rows-query pipeline against a real Postgres (Testcontainers). Exercises a
 * "Tasks" database linked to a "Projects" database (relation + rollup), a
 * formula, filter/sort/group, sub-item nesting, and non-member 403 (IDOR).
 */
describe("Databases (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;
  let mail: CapturingTransport;
  let http: ReturnType<INestApplication["getHttpServer"]>;

  const tokenFromMail = (text: string): string => {
    const m = text.match(/token=([^&\s]+)/);
    if (!m) throw new Error(`no token in mail: ${text}`);
    return decodeURIComponent(m[1]!);
  };

  const onboard = async (email: string): Promise<string> => {
    await request(http)
      .post("/api/auth/register")
      .send({ email, password: "password1234", displayName: email });
    const verifyToken = tokenFromMail(
      mail.messages.filter((m) => m.to === email && m.text.includes("verify-email")).at(-1)!.text,
    );
    await request(http).post("/api/auth/verify-email").send({ token: verifyToken });
    const login = await request(http)
      .post("/api/auth/login")
      .send({ email, password: "password1234" });
    return login.body.tokens.accessToken as string;
  };

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("inclination")
      .withUsername("inclination")
      .withPassword("pw")
      .start();

    const databaseUrl = pg.getConnectionUri();
    execSync("npx prisma migrate deploy", {
      cwd: resolve(process.cwd(), "../../packages/db"),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.APP_BASE_URL = "http://localhost:8080";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    http = app.getHttpServer();
    mail = app.get(MAIL_TRANSPORT);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const auth = (token: string) => `Bearer ${token}`;

  let access = "";
  let workspaceId = "";

  // Tasks DB ids
  let tasksDbId = "";
  let tasksNamePropId = "";
  let statusPropId = "";
  let duePropId = "";
  let estimatePropId = "";
  let relPropId = ""; // Tasks → Projects relation
  let projectRelPropId = ""; // mirror on Projects
  let rollupPropId = ""; // sum of budgets of linked projects
  let formulaPropId = ""; // Estimate * 2
  let tableViewId = "";

  // Projects DB ids
  let projectsDbId = "";
  let projectBudgetPropId = "";

  const todoOptId = "opt-todo";
  const doneOptId = "opt-done";

  let taskA = "";
  let taskB = "";
  let subTaskOfA = "";
  let projectX = "";

  it("creates a Tasks database with a default Table view + primary Name property", async () => {
    access = await onboard("db-owner@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(access))
      .send({ name: "DB WS" });
    expect(ws.status).toBe(201);
    workspaceId = ws.body.id;

    const db = await request(http)
      .post(`/api/workspaces/${workspaceId}/databases`)
      .set("authorization", auth(access))
      .send({ title: "Tasks" });
    expect(db.status).toBe(201);
    tasksDbId = db.body.pageId;
    expect(db.body.page.type).toBe("database");
    expect(db.body.properties).toHaveLength(1);
    expect(db.body.properties[0].isPrimary).toBe(true);
    expect(db.body.properties[0].type).toBe("text");
    tasksNamePropId = db.body.properties[0].id;
    expect(db.body.views).toHaveLength(1);
    tableViewId = db.body.views[0].id;
    expect(db.body.defaultViewId).toBe(tableViewId);
  });

  it("creates a Projects database with a number Budget property", async () => {
    const db = await request(http)
      .post(`/api/workspaces/${workspaceId}/databases`)
      .set("authorization", auth(access))
      .send({ title: "Projects" });
    expect(db.status).toBe(201);
    projectsDbId = db.body.pageId;

    const budget = await request(http)
      .post(`/api/databases/${projectsDbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Budget", type: "number" });
    expect(budget.status).toBe(201);
    projectBudgetPropId = budget.body.id;
  });

  it("adds properties of many types to Tasks (status/date/number/relation/rollup/formula)", async () => {
    const status = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({
        name: "Status",
        type: "status",
        config: {
          options: [
            { id: todoOptId, name: "Todo", color: "gray" },
            { id: doneOptId, name: "Done", color: "green" },
          ],
          groups: [],
        },
      });
    expect(status.status).toBe(201);
    statusPropId = status.body.id;

    const due = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Due", type: "date", config: {} });
    expect(due.status).toBe(201);
    duePropId = due.body.id;

    const estimate = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Estimate", type: "number" });
    expect(estimate.status).toBe(201);
    estimatePropId = estimate.body.id;

    // Relation Tasks → Projects (creates a mirror property on Projects).
    const rel = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Projects", type: "relation", config: { targetDatabaseId: projectsDbId } });
    expect(rel.status).toBe(201);
    relPropId = rel.body.id;
    projectRelPropId = rel.body.config.pairedPropertyId;
    expect(projectRelPropId).toBeTruthy();

    // Rollup: sum of linked projects' budgets.
    const rollup = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({
        name: "Budget Total",
        type: "rollup",
        config: {
          relationPropertyId: relPropId,
          targetPropertyId: projectBudgetPropId,
          aggregation: "sum",
        },
      });
    expect(rollup.status).toBe(201);
    rollupPropId = rollup.body.id;

    // Formula: Estimate * 2
    const formula = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Doubled", type: "formula", config: { expression: "Estimate * 2" } });
    expect(formula.status).toBe(201);
    formulaPropId = formula.body.id;
  });

  it("rejects an invalid per-type config (400)", async () => {
    const bad = await request(http)
      .post(`/api/databases/${tasksDbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Bad", type: "number", config: { precision: 999 } });
    expect(bad.status).toBe(400);
  });

  it("creates rows and sets cells; rejects computed cells and bad values", async () => {
    const a = await request(http)
      .post(`/api/databases/${tasksDbId}/rows`)
      .set("authorization", auth(access))
      .send({ title: "Task A" });
    expect(a.status).toBe(201);
    taskA = a.body.id;
    expect(a.body.type).toBe("row");

    const b = await request(http)
      .post(`/api/databases/${tasksDbId}/rows`)
      .set("authorization", auth(access))
      .send({ title: "Task B" });
    expect(b.status).toBe(201);
    taskB = b.body.id;

    // primary cell keeps the page title in sync
    const setName = await request(http)
      .put(`/api/rows/${taskA}/cells/${tasksNamePropId}`)
      .set("authorization", auth(access))
      .send({ value: "Task A renamed" });
    expect(setName.status).toBe(200);

    // status / estimate / due
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskA}/cells/${statusPropId}`)
          .set("authorization", auth(access))
          .send({ value: todoOptId })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskB}/cells/${statusPropId}`)
          .set("authorization", auth(access))
          .send({ value: doneOptId })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskA}/cells/${estimatePropId}`)
          .set("authorization", auth(access))
          .send({ value: 5 })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskB}/cells/${estimatePropId}`)
          .set("authorization", auth(access))
          .send({ value: 8 })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskA}/cells/${duePropId}`)
          .set("authorization", auth(access))
          .send({ value: "2026-06-10" })
      ).status,
    ).toBe(200);

    // unknown status option → 400
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskA}/cells/${statusPropId}`)
          .set("authorization", auth(access))
          .send({ value: "nope" })
      ).status,
    ).toBe(400);

    // setting a computed (formula) cell → 400
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskA}/cells/${formulaPropId}`)
          .set("authorization", auth(access))
          .send({ value: 3 })
      ).status,
    ).toBe(400);
  });

  it("creates a Project row, links it to Task A, and maintains the two-way mirror", async () => {
    const px = await request(http)
      .post(`/api/databases/${projectsDbId}/rows`)
      .set("authorization", auth(access))
      .send({ title: "Project X" });
    expect(px.status).toBe(201);
    projectX = px.body.id;

    expect(
      (
        await request(http)
          .put(`/api/rows/${projectX}/cells/${projectBudgetPropId}`)
          .set("authorization", auth(access))
          .send({ value: 1000 })
      ).status,
    ).toBe(200);

    const link = await request(http)
      .post(`/api/properties/${relPropId}/links`)
      .set("authorization", auth(access))
      .send({ propertyId: relPropId, fromRowId: taskA, toRowId: projectX });
    expect(link.status).toBe(201);

    // The mirror edge exists on the Projects side: querying Projects shows Task A
    // as a linked relation value under the paired property.
    const projQuery = await request(http)
      .post(`/api/databases/${projectsDbId}/query`)
      .set("authorization", auth(access))
      .send({});
    expect(projQuery.status).toBe(201);
    const projRow = projQuery.body.rows.find((r: { pageId: string }) => r.pageId === projectX);
    expect(projRow.computed[projectRelPropId]).toEqual([taskA]);
  });

  it("nests a sub-task under Task A", async () => {
    const sub = await request(http)
      .post(`/api/databases/${tasksDbId}/rows`)
      .set("authorization", auth(access))
      .send({ title: "Sub of A", parentRowId: taskA });
    expect(sub.status).toBe(201);
    subTaskOfA = sub.body.id;
    expect(sub.body.parentId).toBe(taskA);

    // The sub-item appears in the database's row list.
    const list = await request(http)
      .get(`/api/databases/${tasksDbId}/rows`)
      .set("authorization", auth(access));
    expect(list.body.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([taskA, taskB, subTaskOfA]),
    );
  });

  it("queries rows with computed rollup + formula values", async () => {
    const q = await request(http)
      .post(`/api/databases/${tasksDbId}/query`)
      .set("authorization", auth(access))
      .send({});
    expect(q.status).toBe(201);
    const a = q.body.rows.find((r: { pageId: string }) => r.pageId === taskA);
    const b = q.body.rows.find((r: { pageId: string }) => r.pageId === taskB);

    // relation surfaced as linked ids
    expect(a.computed[relPropId]).toEqual([projectX]);
    // rollup: sum of linked project budgets = 1000
    expect(a.computed[rollupPropId]).toBe(1000);
    // formula: Estimate(5) * 2 = 10 ; Task B: 8 * 2 = 16
    expect(a.computed[formulaPropId]).toBe(10);
    expect(b.computed[formulaPropId]).toBe(16);
  });

  it("applies a filter + sort in a query", async () => {
    // Filter Status == Todo → only Task A (and its sub-item which has no status).
    const filtered = await request(http)
      .post(`/api/databases/${tasksDbId}/query`)
      .set("authorization", auth(access))
      .send({
        config: {
          filters: {
            conjunction: "and",
            conditions: [{ propertyId: statusPropId, operator: "equals", value: todoOptId }],
          },
        },
      });
    expect(filtered.status).toBe(201);
    const ids = filtered.body.rows.map((r: { pageId: string }) => r.pageId);
    expect(ids).toContain(taskA);
    expect(ids).not.toContain(taskB);

    // Sort by Estimate desc → Task B (8) before Task A (5).
    const sorted = await request(http)
      .post(`/api/databases/${tasksDbId}/query`)
      .set("authorization", auth(access))
      .send({ config: { sorts: [{ propertyId: estimatePropId, direction: "desc" }] } });
    const sortedIds = sorted.body.rows
      .map((r: { pageId: string }) => r.pageId)
      .filter((id: string) => id === taskA || id === taskB);
    expect(sortedIds).toEqual([taskB, taskA]);
  });

  it("groups rows by status", async () => {
    const grouped = await request(http)
      .post(`/api/databases/${tasksDbId}/query`)
      .set("authorization", auth(access))
      .send({ config: { groupBy: statusPropId } });
    expect(grouped.status).toBe(201);
    expect(Array.isArray(grouped.body.groups)).toBe(true);
    const todoGroup = grouped.body.groups.find((g: { key: string }) => g.key === todoOptId);
    const doneGroup = grouped.body.groups.find((g: { key: string }) => g.key === doneOptId);
    expect(todoGroup.pageIds).toContain(taskA);
    expect(doneGroup.pageIds).toContain(taskB);
  });

  it("unlinks the relation and clears the rollup", async () => {
    const unlink = await request(http)
      .delete(`/api/properties/${relPropId}/links`)
      .set("authorization", auth(access))
      .send({ propertyId: relPropId, fromRowId: taskA, toRowId: projectX });
    expect(unlink.status).toBe(200);

    const q = await request(http)
      .post(`/api/databases/${tasksDbId}/query`)
      .set("authorization", auth(access))
      .send({});
    const a = q.body.rows.find((r: { pageId: string }) => r.pageId === taskA);
    expect(a.computed[relPropId]).toEqual([]);
    expect(a.computed[rollupPropId]).toBe(0); // sum over no links
  });

  it("forbids a non-member from database/property/row/cell/query endpoints (IDOR)", async () => {
    const outsider = await onboard("db-outsider@example.com");
    const h = { authorization: auth(outsider) };

    expect((await request(http).get(`/api/databases/${tasksDbId}`).set(h)).status).toBe(403);
    expect(
      (
        await request(http)
          .post(`/api/databases/${tasksDbId}/properties`)
          .set(h)
          .send({ name: "X", type: "text" })
      ).status,
    ).toBe(403);
    expect(
      (await request(http).post(`/api/databases/${tasksDbId}/rows`).set(h).send({ title: "X" }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .put(`/api/rows/${taskA}/cells/${estimatePropId}`)
          .set(h)
          .send({ value: 99 })
      ).status,
    ).toBe(403);
    expect(
      (await request(http).post(`/api/databases/${tasksDbId}/query`).set(h).send({})).status,
    ).toBe(403);
    expect((await request(http).patch(`/api/properties/${estimatePropId}`).set(h).send({ name: "Z" })).status).toBe(403);
    expect(
      (
        await request(http)
          .post(`/api/properties/${relPropId}/links`)
          .set(h)
          .send({ propertyId: relPropId, fromRowId: taskA, toRowId: projectX })
      ).status,
    ).toBe(403);
  });
});
