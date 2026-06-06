import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";

/**
 * Phase 4 backlinks (spec §7): PUT references replaces the outgoing set, GET
 * backlinks returns the referencing pages, self/cross-workspace refs are
 * filtered, mentionable search finds members + pages, and non-members are
 * forbidden. Exercised against a real Postgres (Testcontainers).
 */
describe("Page references / backlinks (integration)", () => {
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

  const auth = (token: string) => `Bearer ${token}`;

  const makePage = async (token: string, wsId: string, title: string): Promise<string> => {
    const res = await request(http)
      .post(`/api/workspaces/${wsId}/pages`)
      .set("authorization", auth(token))
      .send({ title });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const makeWorkspace = async (token: string, name: string): Promise<string> => {
    const res = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(token))
      .send({ name });
    expect(res.status).toBe(201);
    return res.body.id as string;
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
  let pageA = "";
  let pageB = "";
  let pageC = "";
  let otherWorkspaceId = "";
  let otherPage = "";
  let outsiderAccess = "";

  it("sets up workspaces, pages, and a second member", async () => {
    ownerAccess = await onboard("refs-owner@example.com");
    workspaceId = await makeWorkspace(ownerAccess, "Refs WS");
    pageA = await makePage(ownerAccess, workspaceId, "Alpha");
    pageB = await makePage(ownerAccess, workspaceId, "Beta");
    pageC = await makePage(ownerAccess, workspaceId, "Gamma");

    // A separate workspace + page for cross-workspace filtering and 403 tests.
    outsiderAccess = await onboard("refs-outsider@example.com");
    otherWorkspaceId = await makeWorkspace(outsiderAccess, "Outsider WS");
    otherPage = await makePage(outsiderAccess, otherWorkspaceId, "Outsider page");
  });

  it("PUT references then GET backlinks returns the referencing page", async () => {
    // A references B and C.
    const put = await request(http)
      .put(`/api/pages/${pageA}/references`)
      .set("authorization", auth(ownerAccess))
      .send({ pageIds: [pageB, pageC] });
    expect(put.status).toBe(200);
    expect(put.body.count).toBe(2);

    const backlinksB = await request(http)
      .get(`/api/pages/${pageB}/backlinks`)
      .set("authorization", auth(ownerAccess));
    expect(backlinksB.status).toBe(200);
    expect(backlinksB.body.map((p: { id: string }) => p.id)).toEqual([pageA]);
    expect(backlinksB.body[0].title).toBe("Alpha");
  });

  it("replacing the set removes old references", async () => {
    // Now A references only C; B's backlink should disappear.
    const put = await request(http)
      .put(`/api/pages/${pageA}/references`)
      .set("authorization", auth(ownerAccess))
      .send({ pageIds: [pageC] });
    expect(put.status).toBe(200);
    expect(put.body.count).toBe(1);

    const backlinksB = await request(http)
      .get(`/api/pages/${pageB}/backlinks`)
      .set("authorization", auth(ownerAccess));
    expect(backlinksB.body).toEqual([]);

    const backlinksC = await request(http)
      .get(`/api/pages/${pageC}/backlinks`)
      .set("authorization", auth(ownerAccess));
    expect(backlinksC.body.map((p: { id: string }) => p.id)).toEqual([pageA]);
  });

  it("filters out self-references and cross-workspace ids", async () => {
    const put = await request(http)
      .put(`/api/pages/${pageA}/references`)
      .set("authorization", auth(ownerAccess))
      .send({ pageIds: [pageA, otherPage, pageB] }); // self + cross-ws + valid
    expect(put.status).toBe(200);
    expect(put.body.count).toBe(1); // only pageB survives

    const backlinksB = await request(http)
      .get(`/api/pages/${pageB}/backlinks`)
      .set("authorization", auth(ownerAccess));
    expect(backlinksB.body.map((p: { id: string }) => p.id)).toEqual([pageA]);

    // The cross-workspace page must NOT have gained a backlink.
    const otherBacklinks = await request(http)
      .get(`/api/pages/${otherPage}/backlinks`)
      .set("authorization", auth(outsiderAccess));
    expect(otherBacklinks.body).toEqual([]);
  });

  it("mentionable search finds a member and a page by title", async () => {
    const byPage = await request(http)
      .get(`/api/workspaces/${workspaceId}/search/mentionable`)
      .query({ q: "Alph" })
      .set("authorization", auth(ownerAccess));
    expect(byPage.status).toBe(200);
    expect(byPage.body.pages.map((p: { id: string }) => p.id)).toContain(pageA);

    const byMember = await request(http)
      .get(`/api/workspaces/${workspaceId}/search/mentionable`)
      .query({ q: "refs-owner" })
      .set("authorization", auth(ownerAccess));
    expect(byMember.body.users.map((u: { email: string }) => u.email)).toContain(
      "refs-owner@example.com",
    );

    // Empty query returns recent pages + members.
    const empty = await request(http)
      .get(`/api/workspaces/${workspaceId}/search/mentionable`)
      .set("authorization", auth(ownerAccess));
    expect(empty.body.pages.length).toBeGreaterThan(0);
    expect(empty.body.users.length).toBeGreaterThan(0);
  });

  it("forbids non-members on references, backlinks, and mentionable search (403)", async () => {
    expect(
      (
        await request(http)
          .put(`/api/pages/${pageA}/references`)
          .set("authorization", auth(outsiderAccess))
          .send({ pageIds: [pageB] })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .get(`/api/pages/${pageA}/backlinks`)
          .set("authorization", auth(outsiderAccess))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .get(`/api/workspaces/${workspaceId}/search/mentionable`)
          .set("authorization", auth(outsiderAccess))
      ).status,
    ).toBe(403);
  });
});
