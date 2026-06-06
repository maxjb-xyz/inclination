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
 * Phase 6 T3 — sharing / permissions API (spec §5/§6). Against a real Postgres
 * (Testcontainers):
 *  - owner grants a user `read` on a page (PUT) → that user can GET the page but
 *    not write (403); via the resolver they can also see a granted page's
 *    DESCENDANTS;
 *  - share-invite for an EXISTING user creates a guest membership + a page grant
 *    + a `share` notification;
 *  - a non-canShare user gets 403 on PUT/DELETE;
 *  - GET /pages/:id/access returns the correct capabilities for owner vs the
 *    read-only user.
 */
describe("Sharing / permissions (integration)", () => {
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
  let granteeAccess = "";
  let granteeId = "";
  let ownerId = "";
  let workspaceId = "";
  let pageId = "";
  let childPageId = "";

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

    ownerAccess = await onboard("s-owner@example.com");
    granteeAccess = await onboard("s-grantee@example.com");
    ownerId = await userIdByEmail("s-owner@example.com");
    granteeId = await userIdByEmail("s-grantee@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Sharing WS" });
    workspaceId = ws.body.id;

    const page = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Parent" });
    pageId = page.body.id;

    const child = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Child", parentId: pageId });
    childPageId = child.body.id;

    // grantee joins the workspace as a GUEST (no default access — page-grant only).
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: granteeId, role: "guest" },
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it("a guest with no grant cannot access the page (403)", async () => {
    const res = await request(http)
      .get(`/api/pages/${pageId}`)
      .set("authorization", auth(granteeAccess));
    expect(res.status).toBe(403);
  });

  let grantId = "";

  it("owner grants the user `read` (PUT) and it appears in the list with subject info", async () => {
    const put = await request(http)
      .put(`/api/pages/${pageId}/permissions`)
      .set("authorization", auth(ownerAccess))
      .send({ subjectType: "user", subjectId: granteeId, role: "read" });
    expect(put.status).toBe(200);
    expect(put.body.role).toBe("read");
    grantId = put.body.id;

    const list = await request(http)
      .get(`/api/pages/${pageId}/permissions`)
      .set("authorization", auth(ownerAccess));
    expect(list.status).toBe(200);
    const row = list.body.find((g: { id: string }) => g.id === grantId);
    expect(row.subject.email).toBe("s-grantee@example.com");
    expect(row.subject.kind).toBe("user");
  });

  it("the granted user can GET the page but cannot write (403)", async () => {
    const get = await request(http)
      .get(`/api/pages/${pageId}`)
      .set("authorization", auth(granteeAccess));
    expect(get.status).toBe(200);
    expect(get.body.page.id).toBe(pageId);

    const write = await request(http)
      .patch(`/api/pages/${pageId}`)
      .set("authorization", auth(granteeAccess))
      .send({ title: "Hacked" });
    expect(write.status).toBe(403);
  });

  it("the page grant cascades to descendants (the child is readable via the resolver)", async () => {
    const child = await request(http)
      .get(`/api/pages/${childPageId}`)
      .set("authorization", auth(granteeAccess));
    expect(child.status).toBe(200);
    expect(child.body.page.id).toBe(childPageId);
  });

  it("GET /pages/:id/access returns the right capabilities for owner vs read-only user", async () => {
    const owner = await request(http)
      .get(`/api/pages/${pageId}/access`)
      .set("authorization", auth(ownerAccess));
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({
      role: "full",
      canRead: true,
      canComment: true,
      canWrite: true,
      canShare: true,
    });

    const reader = await request(http)
      .get(`/api/pages/${pageId}/access`)
      .set("authorization", auth(granteeAccess));
    expect(reader.status).toBe(200);
    expect(reader.body).toMatchObject({
      role: "read",
      canRead: true,
      canComment: false,
      canWrite: false,
      canShare: false,
    });
  });

  it("a non-canShare user gets 403 on PUT and DELETE", async () => {
    const put = await request(http)
      .put(`/api/pages/${pageId}/permissions`)
      .set("authorization", auth(granteeAccess))
      .send({ subjectType: "user", subjectId: ownerId, role: "full" });
    expect(put.status).toBe(403);

    const del = await request(http)
      .delete(`/api/pages/${pageId}/permissions/${grantId}`)
      .set("authorization", auth(granteeAccess));
    expect(del.status).toBe(403);
  });

  it("rejects a user grant for a non-member (400)", async () => {
    const stranger = await prisma.user.create({
      data: { email: "stranger@example.com", displayName: "Stranger" },
    });
    const put = await request(http)
      .put(`/api/pages/${pageId}/permissions`)
      .set("authorization", auth(ownerAccess))
      .send({ subjectType: "user", subjectId: stranger.id, role: "edit" });
    expect(put.status).toBe(400);
  });

  it("DELETE removes the grant and revokes access", async () => {
    const del = await request(http)
      .delete(`/api/pages/${pageId}/permissions/${grantId}`)
      .set("authorization", auth(ownerAccess));
    expect(del.status).toBe(200);

    const get = await request(http)
      .get(`/api/pages/${pageId}`)
      .set("authorization", auth(granteeAccess));
    expect(get.status).toBe(403);
  });

  it("share-invite for an existing user creates a guest membership + page grant + a share notification", async () => {
    // A separate page + a brand-new user with an account but NOT in the workspace.
    const invitee = await onboard("s-invitee@example.com");
    const inviteeId = await userIdByEmail("s-invitee@example.com");

    const sharePage = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Shared doc" });

    const res = await request(http)
      .post(`/api/pages/${sharePage.body.id}/share-invite`)
      .set("authorization", auth(ownerAccess))
      .send({ email: "s-invitee@example.com", role: "comment" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("granted");
    expect(res.body.userId).toBe(inviteeId);

    // Guest membership was created.
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: inviteeId } },
    });
    expect(member?.role).toBe("guest");

    // Page grant exists with the requested role.
    const grant = await prisma.permission.findUnique({
      where: {
        pageId_subjectType_subjectId: {
          pageId: sharePage.body.id,
          subjectType: "user",
          subjectId: inviteeId,
        },
      },
    });
    expect(grant?.role).toBe("comment");

    // The invitee can now GET the page and got a `share` notification.
    const get = await request(http)
      .get(`/api/pages/${sharePage.body.id}`)
      .set("authorization", auth(invitee));
    expect(get.status).toBe(200);

    const notifs = await request(http)
      .get("/api/notifications")
      .set("authorization", auth(invitee));
    const share = notifs.body.find(
      (n: { type: string; sourceRef: { pageId?: string } }) =>
        n.type === "share" && n.sourceRef.pageId === sharePage.body.id,
    );
    expect(share).toBeDefined();
  });

  it("share-invite for an unknown email falls back to a workspace guest invitation", async () => {
    const sharePage = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Invite doc" });

    const res = await request(http)
      .post(`/api/pages/${sharePage.body.id}/share-invite`)
      .set("authorization", auth(ownerAccess))
      .send({ email: "newcomer@example.com", role: "read" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("invited");

    const invite = await prisma.invitation.findFirst({
      where: { workspaceId, email: "newcomer@example.com" },
    });
    expect(invite?.role).toBe("guest");
  });
});
