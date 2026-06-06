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
 * Phase 9 T1 — favorites & recently-visited (spec §5). Against a real Postgres
 * (Testcontainers):
 *  - favorite/unfavorite a page; list returns title/icon; access-gated add (403
 *    for a page the caller can't read).
 *  - reorder writes the manual order.
 *  - visit/recents round-trip; recents exclude pages the caller can no longer
 *    read (revoked grant) and archived pages.
 */
describe("Favorites / recents (integration)", () => {
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

  let ownerAccess = "";
  let guestAccess = "";
  let guestId = "";
  let workspaceId = "";
  let pageA = "";
  let pageB = "";

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

    ownerAccess = await onboard("f-owner@example.com");
    guestAccess = await onboard("f-guest@example.com");
    guestId = await userIdByEmail("f-guest@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Fav WS" });
    workspaceId = ws.body.id;

    const a = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Page A", icon: "📄" });
    pageA = a.body.id;
    const b = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Page B" });
    pageB = b.body.id;

    // guest joins as a workspace guest (no default access).
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: guestId, role: "guest" },
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it("favorites a page and lists it with title/icon", async () => {
    const fav = await request(http)
      .post(`/api/pages/${pageA}/favorite`)
      .set("authorization", auth(ownerAccess));
    expect(fav.status).toBe(200);

    const list = await request(http).get("/api/favorites").set("authorization", auth(ownerAccess));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ pageId: pageA, title: "Page A", icon: "📄" });
  });

  it("reorders favorites by the supplied order", async () => {
    await request(http).post(`/api/pages/${pageB}/favorite`).set("authorization", auth(ownerAccess));

    const reorder = await request(http)
      .post("/api/favorites/reorder")
      .set("authorization", auth(ownerAccess))
      .send({ pageIds: [pageB, pageA] });
    expect(reorder.status).toBe(200);

    const list = await request(http).get("/api/favorites").set("authorization", auth(ownerAccess));
    expect(list.body.map((f: { pageId: string }) => f.pageId)).toEqual([pageB, pageA]);
  });

  it("unfavorites a page", async () => {
    const del = await request(http)
      .delete(`/api/pages/${pageB}/favorite`)
      .set("authorization", auth(ownerAccess));
    expect(del.status).toBe(200);

    const list = await request(http).get("/api/favorites").set("authorization", auth(ownerAccess));
    expect(list.body.map((f: { pageId: string }) => f.pageId)).toEqual([pageA]);
  });

  it("a guest cannot favorite a page they cannot read (403)", async () => {
    const fav = await request(http)
      .post(`/api/pages/${pageA}/favorite`)
      .set("authorization", auth(guestAccess));
    expect(fav.status).toBe(403);
  });

  it("records a visit and lists it in recents", async () => {
    const visit = await request(http)
      .post(`/api/pages/${pageA}/visit`)
      .set("authorization", auth(ownerAccess));
    expect(visit.status).toBe(200);

    const recents = await request(http).get("/api/recents").set("authorization", auth(ownerAccess));
    expect(recents.status).toBe(200);
    expect(recents.body[0]).toMatchObject({ pageId: pageA, title: "Page A" });
  });

  it("recents exclude a page whose access was revoked", async () => {
    // Grant the guest read on Page B, let them visit it, then revoke the grant.
    await request(http)
      .put(`/api/pages/${pageB}/permissions`)
      .set("authorization", auth(ownerAccess))
      .send({ subjectType: "user", subjectId: guestId, role: "read" });

    const visit = await request(http)
      .post(`/api/pages/${pageB}/visit`)
      .set("authorization", auth(guestAccess));
    expect(visit.status).toBe(200);

    let recents = await request(http).get("/api/recents").set("authorization", auth(guestAccess));
    expect(recents.body.map((r: { pageId: string }) => r.pageId)).toContain(pageB);

    // Revoke: delete the grant → guest can no longer read Page B.
    await prisma.permission.deleteMany({
      where: { pageId: pageB, subjectType: "user", subjectId: guestId },
    });

    recents = await request(http).get("/api/recents").set("authorization", auth(guestAccess));
    expect(recents.body.map((r: { pageId: string }) => r.pageId)).not.toContain(pageB);
  });

  it("recents exclude an archived page", async () => {
    const visit = await request(http)
      .post(`/api/pages/${pageA}/visit`)
      .set("authorization", auth(ownerAccess));
    expect(visit.status).toBe(200);
    await request(http).delete(`/api/pages/${pageA}`).set("authorization", auth(ownerAccess));

    const recents = await request(http).get("/api/recents").set("authorization", auth(ownerAccess));
    expect(recents.body.map((r: { pageId: string }) => r.pageId)).not.toContain(pageA);

    // Restore so later assertions/other suites aren't affected (defensive).
    await request(http).post(`/api/pages/${pageA}/restore`).set("authorization", auth(ownerAccess));
  });
});
