import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as Y from "yjs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Phase 8 T1 — publishing, Markdown import/export, synced blocks (spec §5/§8).
 * Against a real Postgres (Testcontainers):
 *  - publish → GET /api/public/:slug (NO auth header) returns html/title; 404 for
 *    unknown/unpublished slugs (no unpublished-content leak); unpublish hides it.
 *  - include-subpages lists published descendants only.
 *  - export returns Markdown built from the page's Yjs body.
 *  - import a Markdown file with multiple H1s → a page tree (parent + children).
 *  - synced-block create + GET (member ok, non-member 403) + sync `synced:{id}`
 *    auth (member allowed, non-member rejected) + ydocState fetch/store round-trip.
 */
describe("Publishing / import-export / synced blocks (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;
  let mail: CapturingTransport;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  const SECRET = "test-access-secret";

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

  let ownerAccess = "";
  let outsiderAccess = "";
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
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.APP_BASE_URL = "http://localhost:8080";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    http = app.getHttpServer();
    mail = app.get(MAIL_TRANSPORT);
    prisma = app.get(PrismaService);

    ownerAccess = await onboard("p-owner@example.com");
    outsiderAccess = await onboard("p-outsider@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Publishing WS" });
    workspaceId = ws.body.id;

    const page = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Public Doc" });
    pageId = page.body.id;

    const child = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Child Doc", parentId: pageId });
    childPageId = child.body.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  let slug = "";

  it("publishes a page and derives a unique slug from the title", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/publish`)
      .set("authorization", auth(ownerAccess))
      .send({
        includeSubpages: false,
        allowDuplicate: false,
        html: "<h1>Public Doc</h1><p>hello world</p>",
        title: "Public Doc",
      });
    expect(res.status).toBe(201);
    expect(res.body.published).toBe(true);
    expect(res.body.slug).toBe("public-doc");
    slug = res.body.slug;
  });

  it("serves the published page at GET /api/public/:slug WITHOUT auth", async () => {
    const res = await request(http).get(`/api/public/${slug}`); // no auth header
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Public Doc");
    expect(res.body.html).toContain("hello world");
    expect(res.body.includeSubpages).toBe(false);
  });

  it("404s for an unknown slug (no existence leak)", async () => {
    const res = await request(http).get(`/api/public/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("a non-member cannot publish (403)", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/publish`)
      .set("authorization", auth(outsiderAccess))
      .send({ includeSubpages: false, allowDuplicate: false, html: "x", title: "x" });
    expect(res.status).toBe(403);
  });

  it("unpublish hides the page (public read 404s; no unpublished content leak)", async () => {
    const un = await request(http)
      .post(`/api/pages/${pageId}/unpublish`)
      .set("authorization", auth(ownerAccess));
    expect(un.status).toBe(201);
    expect(un.body.published).toBe(false);

    const pub = await request(http).get(`/api/public/${slug}`);
    expect(pub.status).toBe(404);
  });

  it("re-publishing keeps the slug and restores public access", async () => {
    const res = await request(http)
      .post(`/api/pages/${pageId}/publish`)
      .set("authorization", auth(ownerAccess))
      .send({
        includeSubpages: true,
        allowDuplicate: false,
        html: "<p>back online</p>",
        title: "Public Doc",
      });
    expect(res.body.slug).toBe(slug);
    expect(res.body.includeSubpages).toBe(true);

    const pub = await request(http).get(`/api/public/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.html).toContain("back online");
  });

  it("include-subpages lists ONLY published descendants", async () => {
    // The child is not yet published → not listed.
    let pub = await request(http).get(`/api/public/${slug}`);
    expect(pub.body.subpages).toEqual([]);

    // Publish the child, then it appears.
    const childPub = await request(http)
      .post(`/api/pages/${childPageId}/publish`)
      .set("authorization", auth(ownerAccess))
      .send({ includeSubpages: false, allowDuplicate: false, html: "<p>kid</p>", title: "Child Doc" });
    expect(childPub.status).toBe(201);

    pub = await request(http).get(`/api/public/${slug}`);
    expect(pub.body.subpages).toHaveLength(1);
    expect(pub.body.subpages[0].slug).toBe(childPub.body.slug);
    expect(pub.body.subpages[0].title).toBe("Child Doc");
  });

  it("GET /pages/:id/public-share returns settings to the owner", async () => {
    const res = await request(http)
      .get(`/api/pages/${pageId}/public-share`)
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(slug);
    expect(res.body.published).toBe(true);
  });

  it("exports a page's body as Markdown from its Yjs document", async () => {
    // Seed a Yjs body for the page (heading + paragraph) directly via PageContent.
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const heading = new Y.XmlElement("heading");
    heading.setAttribute("level", 2 as unknown as string);
    heading.insert(0, [new Y.XmlText("Section")]);
    const para = new Y.XmlElement("paragraph");
    para.insert(0, [new Y.XmlText("exported body text")]);
    fragment.insert(0, [heading, para]);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));

    await prisma.pageContent.upsert({
      where: { pageId },
      create: { pageId, ydocState: state },
      update: { ydocState: state },
    });

    const res = await request(http)
      .get(`/api/pages/${pageId}/export/markdown`)
      .set("authorization", auth(ownerAccess));
    expect(res.status).toBe(200);
    expect(res.body.filename).toMatch(/\.md$/);
    expect(res.body.markdown).toContain("# Public Doc");
    expect(res.body.markdown).toContain("## Section");
    expect(res.body.markdown).toContain("exported body text");
  });

  it("imports a Markdown file into a page tree (each H1 → a child page)", async () => {
    const markdown = [
      "intro paragraph",
      "",
      "# Alpha",
      "",
      "alpha body",
      "",
      "# Beta",
      "",
      "- one",
      "- two",
    ].join("\n");

    const res = await request(http)
      .post(`/api/workspaces/${workspaceId}/import/markdown`)
      .set("authorization", auth(ownerAccess))
      .send({ filename: "Handbook.md", markdown });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Handbook");
    expect(res.body.children).toHaveLength(2);
    expect(res.body.children[0].title).toBe("Alpha");
    expect(res.body.children[1].title).toBe("Beta");

    // The parent + children are real pages with seeded content.
    const parent = await prisma.page.findUnique({ where: { id: res.body.id } });
    expect(parent?.parentId).toBeNull();
    const childA = await prisma.pageContent.findUnique({
      where: { pageId: res.body.children[0].id },
    });
    expect(JSON.stringify(childA?.doc)).toContain("alpha body");
  });

  it("a non-member cannot import (403)", async () => {
    const res = await request(http)
      .post(`/api/workspaces/${workspaceId}/import/markdown`)
      .set("authorization", auth(outsiderAccess))
      .send({ filename: "x.md", markdown: "# x" });
    expect(res.status).toBe(403);
  });

  let syncedId = "";

  it("creates a synced block (member) and reads it back; non-member is 403", async () => {
    const create = await request(http)
      .post(`/api/workspaces/${workspaceId}/synced-blocks`)
      .set("authorization", auth(ownerAccess));
    expect(create.status).toBe(201);
    expect(typeof create.body.id).toBe("string");
    syncedId = create.body.id;

    const get = await request(http)
      .get(`/api/synced-blocks/${syncedId}`)
      .set("authorization", auth(ownerAccess));
    expect(get.status).toBe(200);
    expect(get.body.workspaceId).toBe(workspaceId);

    const denied = await request(http)
      .get(`/api/synced-blocks/${syncedId}`)
      .set("authorization", auth(outsiderAccess));
    expect(denied.status).toBe(403);

    // The created row carries the workspace and a null body (sync fills it).
    const row = await prisma.syncedBlock.findUnique({ where: { id: syncedId } });
    expect(row?.workspaceId).toBe(workspaceId);
    expect(row?.ydocState).toBeNull();
  });
});
