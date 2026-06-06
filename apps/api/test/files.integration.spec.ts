import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAX_UPLOAD_SIZE_BYTES } from "@inclination/shared";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Phase 7 T1 — presigned uploads + attachment download (spec §9). Against a real
 * Postgres + real MinIO (Testcontainers):
 *  - presign returns a working PUT URL + creates an Attachment row;
 *  - the browser can PUT bytes to that URL and fetch them back via the presigned
 *    GET URL from GET /attachments/:id;
 *  - bad mime + oversize requests are rejected with 400;
 *  - download is authorized (a non-member is 403).
 */
describe("Files / uploads (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let minio: StartedTestContainer;
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

  let ownerAccess = "";
  let workspaceId = "";

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("inclination")
      .withUsername("inclination")
      .withPassword("pw")
      .start();

    minio = await new GenericContainer("minio/minio:latest")
      .withEnvironment({
        MINIO_ROOT_USER: "inclination",
        MINIO_ROOT_PASSWORD: "inclination_dev_pw",
      })
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
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
    process.env.S3_ENDPOINT = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    process.env.S3_REGION = "us-east-1";
    process.env.S3_FORCE_PATH_STYLE = "true";
    process.env.S3_ACCESS_KEY = "inclination";
    process.env.S3_SECRET_KEY = "inclination_dev_pw";
    process.env.MINIO_BUCKET = "inclination";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    http = app.getHttpServer();
    mail = app.get(MAIL_TRANSPORT);
    prisma = app.get(PrismaService);

    ownerAccess = await onboard("files-owner@example.com");
    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(ownerAccess))
      .send({ name: "Files WS" });
    workspaceId = ws.body.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await minio?.stop();
    await pg?.stop();
  });

  it("presigns an upload, creates an Attachment row, and round-trips the bytes", async () => {
    const presign = await request(http)
      .post(`/api/workspaces/${workspaceId}/uploads/presign`)
      .set("authorization", auth(ownerAccess))
      .send({ filename: "hello world.png", mime: "image/png", size: 12 });
    expect(presign.status).toBe(201);
    expect(presign.body.uploadUrl).toMatch(/^http/);
    expect(presign.body.attachmentId).toBeTruthy();
    expect(presign.body.objectKey).toMatch(new RegExp(`^${workspaceId}/`));
    // Filename is sanitised in the key (space → _).
    expect(presign.body.objectKey).toContain("hello_world.png");
    expect(presign.body.downloadPath).toBe(`/api/attachments/${presign.body.attachmentId}`);

    // Attachment row recorded with the declared metadata.
    const row = await prisma.attachment.findUnique({
      where: { id: presign.body.attachmentId },
    });
    expect(row?.mime).toBe("image/png");
    expect(row?.size).toBe(12);
    expect(row?.workspaceId).toBe(workspaceId);

    // PUT bytes directly to the presigned URL (as the browser would).
    const bytes = Buffer.from("hello world!");
    const put = await fetch(presign.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: bytes,
    });
    expect(put.ok).toBe(true);

    // GET /attachments/:id → presigned GET URL; fetch it and verify bytes match.
    const dl = await request(http)
      .get(presign.body.downloadPath)
      .set("authorization", auth(ownerAccess));
    expect(dl.status).toBe(200);
    expect(dl.body.url).toMatch(/^http/);

    const got = await fetch(dl.body.url);
    expect(got.ok).toBe(true);
    const buf = Buffer.from(await got.arrayBuffer());
    expect(buf.toString()).toBe("hello world!");
  });

  it("rejects a disallowed mime type (400)", async () => {
    const res = await request(http)
      .post(`/api/workspaces/${workspaceId}/uploads/presign`)
      .set("authorization", auth(ownerAccess))
      .send({ filename: "evil.exe", mime: "application/x-msdownload", size: 10 });
    expect(res.status).toBe(400);
  });

  it("rejects an oversize upload (400)", async () => {
    const res = await request(http)
      .post(`/api/workspaces/${workspaceId}/uploads/presign`)
      .set("authorization", auth(ownerAccess))
      .send({ filename: "huge.png", mime: "image/png", size: MAX_UPLOAD_SIZE_BYTES + 1 });
    expect(res.status).toBe(400);
  });

  it("rejects presign from a non-member (403)", async () => {
    const outsider = await onboard("files-outsider@example.com");
    const res = await request(http)
      .post(`/api/workspaces/${workspaceId}/uploads/presign`)
      .set("authorization", auth(outsider))
      .send({ filename: "x.png", mime: "image/png", size: 10 });
    expect(res.status).toBe(403);
  });

  it("authorizes download: a non-member cannot fetch a workspace attachment (403)", async () => {
    const presign = await request(http)
      .post(`/api/workspaces/${workspaceId}/uploads/presign`)
      .set("authorization", auth(ownerAccess))
      .send({ filename: "doc.pdf", mime: "application/pdf", size: 100 });
    expect(presign.status).toBe(201);

    const outsider = await onboard("files-outsider2@example.com");
    const dl = await request(http)
      .get(presign.body.downloadPath)
      .set("authorization", auth(outsider));
    expect(dl.status).toBe(403);
  });

  it("404s an unknown attachment", async () => {
    const dl = await request(http)
      .get(`/api/attachments/${crypto.randomUUID()}`)
      .set("authorization", auth(ownerAccess));
    expect(dl.status).toBe(404);
  });
});
