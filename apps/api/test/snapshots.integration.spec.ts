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
 * Phase 7 T1 — version history (spec §5). Against a real Postgres
 * (Testcontainers):
 *  - manual snapshot create captures the page's current Yjs state;
 *  - list returns it; preview decodes its plain text;
 *  - restore swaps PageContent.ydocState back to a prior snapshot (and writes a
 *    safety snapshot of the pre-restore state);
 *  - authorization: a reader can list/preview but cannot create/restore (403).
 */
describe("Snapshots / version history (integration)", () => {
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

  // Build a Yjs update binary whose prose fragment contains the given text, the
  // same way the editor stores it (Collaboration extension → `default` fragment).
  const ydocWithText = (text: string): Uint8Array<ArrayBuffer> => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    para.insert(0, [new Y.XmlText(text)]);
    fragment.insert(0, [para]);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    const out = new Uint8Array(new ArrayBuffer(update.length));
    out.set(update);
    return out as Uint8Array<ArrayBuffer>;
  };

  const setContent = async (pageId: string, text: string) => {
    const bytes = ydocWithText(text);
    await prisma.pageContent.upsert({
      where: { pageId },
      create: { pageId, ydocState: bytes },
      update: { ydocState: bytes },
    });
  };

  let ownerAccess = "";
  let readerAccess = "";
  let readerId = "";
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

    ownerAccess = await onboard("snap-owner@example.com");
    readerAccess = await onboard("snap-reader@example.com");
    readerId = await userIdByEmail("snap-reader@example.com");

    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Snap WS" });
    workspaceId = ws.body.id;

    const page = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Versioned" });
    pageId = page.body.id;

    // Guest reader granted READ on the page only.
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: readerId, role: "guest" },
    });
    await prisma.permission.create({
      data: { pageId, subjectType: "user", subjectId: readerId, role: "read" },
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  let firstSnapId = "";

  it("captures a manual snapshot of the current state", async () => {
    await setContent(pageId, "version one alpha");

    const create = await request(http)
      .post(`/api/pages/${pageId}/snapshots`)
      .set("authorization", auth(ownerAccess))
      .send({ label: "v1" });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeTruthy();
    expect(create.body.label).toBe("v1");
    firstSnapId = create.body.id;
  });

  it("lists snapshots (newest first) for a reader", async () => {
    const list = await request(http)
      .get(`/api/pages/${pageId}/snapshots`)
      .set("authorization", auth(readerAccess));
    expect(list.status).toBe(200);
    const ids = list.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(firstSnapId);
  });

  it("previews a snapshot's decoded plain text", async () => {
    const preview = await request(http)
      .get(`/api/pages/${pageId}/snapshots/${firstSnapId}`)
      .set("authorization", auth(readerAccess));
    expect(preview.status).toBe(200);
    expect(preview.body.text).toContain("version one alpha");
    expect(preview.body.decoded).toBe(false);
  });

  it("forbids a reader from creating or restoring (403)", async () => {
    const create = await request(http)
      .post(`/api/pages/${pageId}/snapshots`)
      .set("authorization", auth(readerAccess))
      .send({ label: "nope" });
    expect(create.status).toBe(403);

    const restore = await request(http)
      .post(`/api/pages/${pageId}/snapshots/${firstSnapId}/restore`)
      .set("authorization", auth(readerAccess));
    expect(restore.status).toBe(403);
  });

  it("restores a snapshot, replacing PageContent.ydocState (and writes a safety snapshot)", async () => {
    // Move the live content forward to "version two".
    await setContent(pageId, "version two beta");

    const before = await prisma.pageSnapshot.count({ where: { pageId } });

    const restore = await request(http)
      .post(`/api/pages/${pageId}/snapshots/${firstSnapId}/restore`)
      .set("authorization", auth(ownerAccess));
    expect(restore.status).toBe(201);
    expect(restore.body.restored).toBe(true);
    expect(restore.body.safetySnapshotId).toBeTruthy();

    // A safety snapshot of the pre-restore state was written.
    const after = await prisma.pageSnapshot.count({ where: { pageId } });
    expect(after).toBe(before + 1);

    // The live ydocState now decodes back to the v1 text.
    const content = await prisma.pageContent.findUniqueOrThrow({ where: { pageId } });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(content.ydocState!));
    const text = doc.getXmlFragment("default").toString();
    doc.destroy();
    expect(text).toContain("version one alpha");
    expect(text).not.toContain("version two beta");

    // The safety snapshot preserved the v2 state.
    const safety = await request(http)
      .get(`/api/pages/${pageId}/snapshots/${restore.body.safetySnapshotId}`)
      .set("authorization", auth(ownerAccess));
    expect(safety.body.text).toContain("version two beta");
  });

  it("404s a snapshot id from a different page", async () => {
    const other = await request(http)
      .post(`/api/workspaces/${workspaceId}/pages`)
      .set("authorization", auth(ownerAccess))
      .send({ title: "Other" });
    const preview = await request(http)
      .get(`/api/pages/${other.body.id}/snapshots/${firstSnapId}`)
      .set("authorization", auth(ownerAccess));
    expect(preview.status).toBe(404);
  });
});
