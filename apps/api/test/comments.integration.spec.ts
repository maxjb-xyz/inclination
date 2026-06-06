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
 * Phase 6 T2 — comments + notifications API (spec §5/§6). Against a real
 * Postgres (Testcontainers):
 *  - a member can comment (canComment); a read-only user (explicit `read` grant)
 *    is rejected from commenting (403) but can GET the thread (canRead);
 *  - inline-anchored comments store blockAnchor; a reply inherits the threadId;
 *  - resolve stamps resolvedAt on the whole thread;
 *  - an @-mention of a member with access creates a `mention` Notification for
 *    them (and NOT for a user without page access); GET /notifications returns
 *    it; mark-read clears it; unread-count is correct.
 *
 * Authz setup is resolvePageAccess-consistent: all actors are workspace members
 * (so the resolver can load their role) and the read-only user gets an explicit
 * page-level `read` Permission that overrides the member default.
 */
describe("Comments + notifications (integration)", () => {
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

  const userIdByEmail = async (email: string): Promise<string> => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    return u.id;
  };

  // A comment body with optional user @-mentions (ProseMirror/Tiptap JSON shape).
  const bodyWithMentions = (text: string, userIds: string[] = []) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text },
          ...userIds.map((id) => ({ type: "mention", attrs: { kind: "user", id } })),
        ],
      },
    ],
  });

  let ownerAccess = "";
  let readerAccess = "";
  let memberAccess = "";
  let outsiderAccess = ""; // member of a DIFFERENT workspace → no access to the page
  let ownerId = "";
  let readerId = "";
  let memberId = "";
  let outsiderId = "";
  let workspaceId = "";
  let pageId = "";

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

    // Onboard actors.
    ownerAccess = await onboard("c-owner@example.com");
    readerAccess = await onboard("c-reader@example.com");
    memberAccess = await onboard("c-member@example.com");
    outsiderAccess = await onboard("c-outsider@example.com");
    ownerId = await userIdByEmail("c-owner@example.com");
    readerId = await userIdByEmail("c-reader@example.com");
    memberId = await userIdByEmail("c-member@example.com");
    outsiderId = await userIdByEmail("c-outsider@example.com");

    // Owner's workspace + a page.
    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Comments WS" });
    workspaceId = ws.body.id;

    const page = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Discussion" });
    pageId = page.body.id;

    // reader + member join the workspace as members; outsider stays elsewhere.
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: readerId, role: "member" },
        { workspaceId, userId: memberId, role: "member" },
      ],
    });
    // Explicit page-level `read` grant for the reader overrides the member
    // default (edit) → they can read/GET but cannot comment.
    await prisma.permission.create({
      data: { pageId, subjectType: "user", subjectId: readerId, role: "read" },
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  let rootCommentId = "";
  let threadId = "";

  it("lets a member post a top-level comment (threadId = own id)", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess))
      .send({ body: bodyWithMentions("first!") });
    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(memberId);
    expect(res.body.threadId).toBe(res.body.id);
    expect(res.body.parentCommentId).toBeNull();
    rootCommentId = res.body.id;
    threadId = res.body.threadId;
  });

  it("stores blockAnchor for an inline-anchored comment", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess))
      .send({ body: bodyWithMentions("inline"), blockAnchor: { blockId: "b1", from: 2, to: 5 } });
    expect(res.status).toBe(201);
    expect(res.body.blockAnchor).toEqual({ blockId: "b1", from: 2, to: 5 });
  });

  it("a reply inherits the parent's threadId", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(ownerAccess))
      .send({ body: bodyWithMentions("reply"), parentCommentId: rootCommentId });
    expect(res.status).toBe(201);
    expect(res.body.threadId).toBe(threadId);
    expect(res.body.parentCommentId).toBe(rootCommentId);
  });

  it("rejects a reply whose parent is on a different page (400)", async () => {
    const otherPage = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Other" });
    const res = await request(http)
      .post(`/api/pages/${otherPage.body.id}/comments`)
      .set("authorization", auth(ownerAccess))
      .send({ body: bodyWithMentions("x"), parentCommentId: rootCommentId });
    expect(res.status).toBe(400);
  });

  it("rejects an empty comment body (400)", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess))
      .send({ body: {} });
    expect(res.status).toBe(400);
  });

  it("rejects the read-only user from commenting (403) but lets them GET", async () => {
    const post = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(readerAccess))
      .send({ body: bodyWithMentions("nope") });
    expect(post.status).toBe(403);

    const get = await request(http)
      .get(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(readerAccess));
    expect(get.status).toBe(200);
    // author info is included
    const root = get.body.find((c: { id: string }) => c.id === rootCommentId);
    expect(root.author.displayName).toBe("c-member@example.com");
  });

  it("forbids a non-member (different workspace) from reading or commenting (403)", async () => {
    expect(
      (await request(http).get(`/api/pages/${pageId}/comments`).set("authorization", auth(outsiderAccess)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(http)
          .post(`/api/pages/${pageId}/comments`)
          .set("authorization", auth(outsiderAccess))
          .send({ body: bodyWithMentions("hi") })
      ).status,
    ).toBe(403);
  });

  it("resolve stamps resolvedAt on the whole thread; unresolve clears it", async () => {
    const resolveRes = await request(http)
      .post(`/api/comments/${rootCommentId}/resolve`)
      .set("authorization", auth(memberAccess));
    expect(resolveRes.status).toBe(201);
    expect(resolveRes.body.resolved).toBeGreaterThanOrEqual(2); // root + reply

    const list = await request(http)
      .get(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess));
    const threadRows = list.body.filter((c: { threadId: string }) => c.threadId === threadId);
    expect(threadRows.every((c: { resolvedAt: string | null }) => c.resolvedAt !== null)).toBe(true);

    const unresolveRes = await request(http)
      .post(`/api/comments/${rootCommentId}/unresolve`)
      .set("authorization", auth(memberAccess));
    expect(unresolveRes.status).toBe(201);
    const list2 = await request(http)
      .get(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess));
    const threadRows2 = list2.body.filter((c: { threadId: string }) => c.threadId === threadId);
    expect(threadRows2.every((c: { resolvedAt: string | null }) => c.resolvedAt === null)).toBe(true);
  });

  it("an @-mention of a member with access creates a mention Notification (and NOT for a no-access user)", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess))
      // mention the owner (has access) and the outsider (no access).
      .send({ body: bodyWithMentions("hey ", [ownerId, outsiderId]) });
    expect(res.status).toBe(201);

    // Owner sees the mention notification.
    const ownerNotifs = await request(http)
      .get("/api/notifications")
      .set("authorization", auth(ownerAccess));
    expect(ownerNotifs.status).toBe(200);
    const mention = ownerNotifs.body.find(
      (n: { type: string; sourceRef: { commentId?: string } }) =>
        n.type === "mention" && n.sourceRef.commentId === res.body.id,
    );
    expect(mention).toBeDefined();
    expect(mention.sourceRef.pageId).toBe(pageId);
    expect(mention.preview?.pageTitle).toBe("Discussion");

    // Outsider (no access) got NO notification at all.
    const outsiderNotifs = await request(http)
      .get("/api/notifications")
      .set("authorization", auth(outsiderAccess));
    expect(outsiderNotifs.body.length).toBe(0);

    // The author mentioning others does not notify themselves.
    const selfMentioned = ownerNotifs.body.filter(
      (n: { recipientId: string }) => n.recipientId === memberId,
    );
    expect(selfMentioned.length).toBe(0);
  });

  it("unread-count is correct and mark-read clears it", async () => {
    const before = await request(http)
      .get("/api/notifications/unread-count")
      .set("authorization", auth(ownerAccess));
    expect(before.status).toBe(200);
    expect(before.body.count).toBeGreaterThanOrEqual(1);

    const list = await request(http)
      .get("/api/notifications")
      .set("authorization", auth(ownerAccess));
    const unreadId = list.body.find((n: { readAt: string | null }) => n.readAt === null).id;

    const read = await request(http)
      .post(`/api/notifications/${unreadId}/read`)
      .set("authorization", auth(ownerAccess));
    expect(read.status).toBe(201);
    expect(read.body.readAt).not.toBeNull();

    const after = await request(http)
      .get("/api/notifications/unread-count")
      .set("authorization", auth(ownerAccess));
    expect(after.body.count).toBe(before.body.count - 1);
  });

  it("a user only sees/marks their own notifications (403 on someone else's)", async () => {
    const ownerList = await request(http)
      .get("/api/notifications")
      .set("authorization", auth(ownerAccess));
    const someId = ownerList.body[0].id;
    const res = await request(http)
      .post(`/api/notifications/${someId}/read`)
      .set("authorization", auth(memberAccess));
    expect(res.status).toBe(403);
  });

  it("read-all marks all the caller's notifications read", async () => {
    const res = await request(http)
      .post("/api/notifications/read-all")
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(201);
    const count = await request(http)
      .get("/api/notifications/unread-count")
      .set("authorization", auth(ownerAccess));
    expect(count.body.count).toBe(0);
  });

  it("lets the author delete their own comment; forbids a non-author reader", async () => {
    const created = await request(http)
      .post(`/api/pages/${pageId}/comments`)
      .set("authorization", auth(memberAccess))
      .send({ body: bodyWithMentions("to delete") });
    const id = created.body.id;

    // reader (read-only, not author) cannot delete.
    const reader = await request(http)
      .delete(`/api/comments/${id}`)
      .set("authorization", auth(readerAccess));
    expect(reader.status).toBe(403);

    // author can delete.
    const author = await request(http)
      .delete(`/api/comments/${id}`)
      .set("authorization", auth(memberAccess));
    expect(author.status).toBe(200);
  });
});
