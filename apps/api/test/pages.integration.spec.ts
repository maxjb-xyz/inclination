import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";

/**
 * Phase 2 "Done when": pages can be created / nested / moved / trashed / restored
 * and text edits persist. Exercised against a real Postgres (Testcontainers).
 * Also verifies a non-member cannot reach another workspace's pages (IDOR/403).
 */
describe("Pages (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;
  let mail: CapturingTransport;
  let http: ReturnType<INestApplication["getHttpServer"]>;

  const tokenFromMail = (text: string): string => {
    const m = text.match(/token=([^&\s]+)/);
    if (!m) throw new Error(`no token in mail: ${text}`);
    return decodeURIComponent(m[1]!);
  };

  // Registers + verifies + logs in a user, returning the access token.
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

  let ownerAccess = "";
  let workspaceId = "";
  let rootA = "";
  let rootB = "";
  let childOfA = "";

  const auth = (token: string) => `Bearer ${token}`;

  it("creates a workspace and root pages with ordered sortKeys", async () => {
    ownerAccess = await onboard("pages-owner@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Notes" });
    expect(ws.status).toBe(201);
    workspaceId = ws.body.id;

    const a = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "A" });
    expect(a.status).toBe(201);
    rootA = a.body.id;

    const b = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "B" });
    expect(b.status).toBe(201);
    rootB = b.body.id;

    // B was created after A, so its sortKey must sort after A's.
    expect(b.body.sortKey > a.body.sortKey).toBe(true);
  });

  it("nests a child under A and lists the tree", async () => {
    const child = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "A-child", parentId: rootA });
    expect(child.status).toBe(201);
    childOfA = child.body.id;
    expect(child.body.parentId).toBe(rootA);

    const tree = await request(http)
      .get(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess));
    expect(tree.status).toBe(200);
    const ids = tree.body.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([rootA, rootB, childOfA]));
    const childRow = tree.body.find((p: { id: string }) => p.id === childOfA);
    expect(childRow.parentId).toBe(rootA);
  });

  it("returns breadcrumbs (ancestor chain) for a nested page", async () => {
    const res = await request(http)
      .get(`/api/pages/${childOfA}`)
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(200);
    expect(res.body.page.id).toBe(childOfA);
    expect(res.body.breadcrumbs.map((p: { id: string }) => p.id)).toEqual([rootA]);
  });

  it("reorders root pages by moving B before A", async () => {
    const move = await request(http)
      .post(`/api/pages/${rootB}/move`)
      .set("authorization", auth(ownerAccess))
      .send({ parentId: null, afterId: rootA });
    expect(move.status).toBe(201);

    const tree = await request(http)
      .get(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess));
    const roots = tree.body
      .filter((p: { parentId: string | null }) => p.parentId === null)
      .sort((x: { sortKey: string }, y: { sortKey: string }) => (x.sortKey < y.sortKey ? -1 : 1));
    expect(roots.map((p: { id: string }) => p.id)).toEqual([rootB, rootA]);
  });

  it("reparents the child of A under B", async () => {
    const move = await request(http)
      .post(`/api/pages/${childOfA}/move`)
      .set("authorization", auth(ownerAccess))
      .send({ parentId: rootB });
    expect(move.status).toBe(201);
    expect(move.body.parentId).toBe(rootB);

    const res = await request(http)
      .get(`/api/pages/${childOfA}`)
      .set("authorization", auth(ownerAccess));
    expect(res.body.breadcrumbs.map((p: { id: string }) => p.id)).toEqual([rootB]);
  });

  it("rejects a cyclic move (page under its own descendant)", async () => {
    // childOfA is now under rootB; try to move rootB under childOfA → cycle.
    const move = await request(http)
      .post(`/api/pages/${rootB}/move`)
      .set("authorization", auth(ownerAccess))
      .send({ parentId: childOfA });
    expect(move.status).toBe(409);

    // Moving a page under itself is also rejected.
    const selfMove = await request(http)
      .post(`/api/pages/${rootB}/move`)
      .set("authorization", auth(ownerAccess))
      .send({ parentId: rootB });
    expect(selfMove.status).toBe(409);
  });

  it("trashes a subtree and excludes it from the tree, then restores it", async () => {
    const del = await request(http)
      .delete(`/api/pages/${rootB}`)
      .set("authorization", auth(ownerAccess));
    expect(del.status).toBe(200);
    expect(del.body.archived).toBe(2); // rootB + childOfA

    const tree = await request(http)
      .get(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess));
    const ids = tree.body.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(rootB);
    expect(ids).not.toContain(childOfA);

    const trash = await request(http)
      .get(`/api/workspaces/${workspaceId}/trash`)
      .set("authorization", auth(ownerAccess));
    expect(trash.body.map((p: { id: string }) => p.id)).toEqual(
      expect.arrayContaining([rootB, childOfA]),
    );

    const restore = await request(http)
      .post(`/api/pages/${rootB}/restore`)
      .set("authorization", auth(ownerAccess));
    expect(restore.status).toBe(201);

    const tree2 = await request(http)
      .get(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess));
    const ids2 = tree2.body.map((p: { id: string }) => p.id);
    expect(ids2).toEqual(expect.arrayContaining([rootB, childOfA]));
  });

  it("saves and loads page content (round-trip)", async () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
    const save = await request(http)
      .put(`/api/pages/${rootA}/content`)
      .set("authorization", auth(ownerAccess))
      .send({ doc });
    expect(save.status).toBe(200);
    expect(save.body.doc).toEqual(doc);

    const load = await request(http)
      .get(`/api/pages/${rootA}/content`)
      .set("authorization", auth(ownerAccess));
    expect(load.status).toBe(200);
    expect(load.body.doc).toEqual(doc);
  });

  it("forbids a non-member from reading another workspace's page (IDOR)", async () => {
    const outsiderAccess = await onboard("pages-outsider@example.com");

    expect(
      (await request(http).get(`/api/pages/${rootA}`).set("authorization", auth(outsiderAccess)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .get(`/api/workspaces/${workspaceId}/pages`)
          .set("authorization", auth(outsiderAccess))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .put(`/api/pages/${rootA}/content`)
          .set("authorization", auth(outsiderAccess))
          .send({ doc: { type: "doc" } })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .post(`/api/pages/${rootA}/move`)
          .set("authorization", auth(outsiderAccess))
          .send({ parentId: null })
      ).status,
    ).toBe(403);
  });
});
