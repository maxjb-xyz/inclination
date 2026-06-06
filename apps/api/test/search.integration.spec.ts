import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Phase 7 T1 — full-text search API (spec §6). Against a real Postgres
 * (Testcontainers, so the tsvector trigger + GIN index from the `search_files`
 * migration are exercised):
 *  - a page whose SearchIndex body contains a distinctive phrase is found;
 *  - results are access-filtered: a guest with NO grant does NOT see a page
 *    they can't read, but DOES see one explicitly granted to them.
 */
describe("Search (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;
  let mail: CapturingTransport;
  let prisma: PrismaService;
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
  const userIdByEmail = async (email: string): Promise<string> =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  // Index a page's body text by writing a SearchIndex row directly (the trigger
  // recomputes `tsv`), simulating what the sync server does on save.
  const index = async (pageId: string, workspaceId: string, title: string, body: string) => {
    await prisma.searchIndex.upsert({
      where: { pageId },
      create: { pageId, workspaceId, title, bodyText: body },
      update: { workspaceId, title, bodyText: body },
    });
  };

  let ownerAccess = "";
  let guestAccess = "";
  let guestId = "";
  let workspaceId = "";
  let secretPageId = "";
  let grantedPageId = "";

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
    prisma = app.get(PrismaService);

    ownerAccess = await onboard("search-owner@example.com");
    guestAccess = await onboard("search-guest@example.com");
    guestId = await userIdByEmail("search-guest@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Search WS" });
    workspaceId = ws.body.id;

    const secret = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Secret Plans" });
    secretPageId = secret.body.id;

    const granted = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Shared Recipe" });
    grantedPageId = granted.body.id;

    // Both pages contain the SAME distinctive phrase in their indexed body.
    await index(secretPageId, workspaceId, "Secret Plans", "the quintessential flibbertigibbet strategy");
    await index(grantedPageId, workspaceId, "Shared Recipe", "a quintessential flibbertigibbet dessert");

    // The guest joins the workspace (no default access) and is granted READ on
    // only the "granted" page.
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: guestId, role: "guest" },
    });
    await prisma.permission.create({
      data: { pageId: grantedPageId, subjectType: "user", subjectId: guestId, role: "read" },
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it("finds a page by an indexed phrase (owner sees both)", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/search`)
      .query({ q: "flibbertigibbet" })
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { pageId: string }) => r.pageId);
    expect(ids).toEqual(expect.arrayContaining([secretPageId, grantedPageId]));
    // Snippet highlights the matched term with [[ ]].
    expect(res.body[0].snippet).toContain("[[");
  });

  it("supports websearch operators (phrase quoting)", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/search`)
      .query({ q: '"quintessential flibbertigibbet"' })
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it("excludes pages a guest cannot read but includes a granted one", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/search`)
      .query({ q: "flibbertigibbet" })
      .set("authorization", auth(guestAccess));
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { pageId: string }) => r.pageId);
    expect(ids).toContain(grantedPageId);
    expect(ids).not.toContain(secretPageId);
  });

  it("rejects a non-member (403)", async () => {
    const outsider = await onboard("search-outsider@example.com");
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/search`)
      .query({ q: "flibbertigibbet" })
      .set("authorization", auth(outsider));
    expect(res.status).toBe(403);
  });

  it("validates the query (empty q → 400)", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/search`)
      .query({ q: "" })
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(400);
  });
});
