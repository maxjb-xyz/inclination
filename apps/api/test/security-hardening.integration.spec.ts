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
 * Phase 9 T1 — security-pass fixes (spec §9). Against a real Postgres
 * (Testcontainers):
 *  - GUEST scoping: a workspace guest with a grant on ONE subtree sees ONLY that
 *    subtree in listTree + searchMentionable, and is NOT shown the full member
 *    directory.
 *  - share-invite NO-DOWNGRADE: inviting an existing admin at a weaker role does
 *    not create a downgrading grant — the admin keeps full access.
 *  - publish server-side sanitize: a <script> in the publish HTML is stripped at
 *    rest and absent from the public read.
 */
describe("Security hardening (integration)", () => {
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
  let adminAccess = "";
  let guestAccess = "";
  let adminId = "";
  let guestId = "";
  let workspaceId = "";
  let grantedParent = "";
  let grantedChild = "";
  let secretPage = "";

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

    ownerAccess = await onboard("h-owner@example.com");
    adminAccess = await onboard("h-admin@example.com");
    guestAccess = await onboard("h-guest@example.com");
    adminId = await userIdByEmail("h-admin@example.com");
    guestId = await userIdByEmail("h-guest@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Hardening WS" });
    workspaceId = ws.body.id;

    // admin + guest memberships.
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: adminId, role: "admin" },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: guestId, role: "guest" },
    });

    // A granted subtree (parent + child) and a separate secret page.
    const parent = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Granted Parent" });
    grantedParent = parent.body.id;
    const child = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Granted Child", parentId: grantedParent });
    grantedChild = child.body.id;
    const secret = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Secret Page" });
    secretPage = secret.body.id;

    // Grant the guest read on the parent (cascades to the child).
    await request(http)
      .put(`/api/pages/${grantedParent}/permissions`)
      .set("authorization", auth(ownerAccess))
      .send({ subjectType: "user", subjectId: guestId, role: "read" });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it("a guest's listTree shows ONLY their granted subtree, not the secret page", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(guestAccess));
    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(grantedParent);
    expect(ids).toContain(grantedChild);
    expect(ids).not.toContain(secretPage);
  });

  it("the owner's listTree still shows the full tree", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess));
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(grantedParent);
    expect(ids).toContain(secretPage);
  });

  it("a guest's searchMentionable returns only readable pages and only themselves as a member", async () => {
    const res = await request(http)
      .get(`/api/workspaces/${workspaceId}/search/mentionable`)
      .set("authorization", auth(guestAccess));
    expect(res.status).toBe(200);
    const pageIds = res.body.pages.map((p: { id: string }) => p.id);
    expect(pageIds).toContain(grantedParent);
    expect(pageIds).not.toContain(secretPage);
    // Member directory: a guest sees only themselves.
    const userIds = res.body.users.map((u: { id: string }) => u.id);
    expect(userIds).toEqual([guestId]);
  });

  it("a guest's member list shows only themselves; the owner sees everyone", async () => {
    const guestView = await request(http)
      .get(`/api/workspaces/${workspaceId}/members`)
      .set("authorization", auth(guestAccess));
    expect(guestView.status).toBe(200);
    expect(guestView.body.map((m: { userId: string }) => m.userId)).toEqual([guestId]);

    const ownerView = await request(http)
      .get(`/api/workspaces/${workspaceId}/members`)
      .set("authorization", auth(ownerAccess));
    expect(ownerView.body.length).toBeGreaterThanOrEqual(3);
  });

  it("share-invite does NOT downgrade an existing admin's full access", async () => {
    // The admin resolves to `full` via the workspace default. Inviting them at
    // `read` must NOT write a downgrading grant.
    const res = await request(http)
      .post(`/api/pages/${secretPage}/share-invite`)
      .set("authorization", auth(ownerAccess))
      .send({ email: "h-admin@example.com", role: "read" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("already-has-access");

    // No grant row was created for the admin on this page.
    const grant = await prisma.permission.findUnique({
      where: {
        pageId_subjectType_subjectId: {
          pageId: secretPage,
          subjectType: "user",
          subjectId: adminId,
        },
      },
    });
    expect(grant).toBeNull();

    // The admin still resolves to full access (canWrite).
    const access = await request(http)
      .get(`/api/pages/${secretPage}/access`)
      .set("authorization", auth(adminAccess));
    expect(access.body).toMatchObject({ role: "full", canWrite: true, canShare: true });
  });

  it("publish server-side-sanitizes the HTML (a <script> is stripped at rest and in the public read)", async () => {
    const malicious =
      '<p>Safe content</p><script>document.cookie="stolen"</script>' +
      '<img src="x" onerror="alert(1)">';
    const pub = await request(http)
      .post(`/api/pages/${grantedParent}/publish`)
      .set("authorization", auth(ownerAccess))
      .send({ html: malicious, title: "Pub", includeSubpages: false, allowDuplicate: false });
    expect(pub.status).toBe(201);

    // Stored HTML is clean at rest.
    const share = await prisma.publicShare.findUniqueOrThrow({
      where: { pageId: grantedParent },
    });
    expect(share.publishedHtml).not.toContain("<script");
    expect(share.publishedHtml).not.toContain("onerror");
    expect(share.publishedHtml).toContain("Safe content");

    // Public read (unauthenticated) also serves the sanitized HTML.
    const pubRead = await request(http).get(`/api/public/${share.slug}`);
    expect(pubRead.status).toBe(200);
    expect(pubRead.body.html).not.toContain("<script");
    expect(pubRead.body.html).not.toContain("onerror");
  });
});
