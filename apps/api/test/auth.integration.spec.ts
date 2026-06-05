import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startMockOidc, type MockOidc } from "./support/mock-oidc";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";

/**
 * Phase 1 "Done when": a user can register, verify, create a workspace, invite a
 * member; both can log in; OIDC login works against a test provider. Exercised
 * against a real Postgres (Testcontainers) and an in-process mock OIDC issuer.
 */
describe("Auth & workspaces (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let oidc: MockOidc;
  let app: INestApplication;
  let mail: CapturingTransport;
  let http: ReturnType<INestApplication["getHttpServer"]>;

  const tokenFromMail = (text: string): string => {
    const m = text.match(/token=([^&\s]+)/);
    if (!m) throw new Error(`no token in mail: ${text}`);
    return decodeURIComponent(m[1]!);
  };

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("inclination")
      .withUsername("inclination")
      .withPassword("pw")
      .start();
    oidc = await startMockOidc();

    const databaseUrl = pg.getConnectionUri();
    // Apply migrations to the fresh container database.
    execSync("npx prisma migrate deploy", {
      cwd: resolve(process.cwd(), "../../packages/db"),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.APP_BASE_URL = "http://localhost:8080";
    process.env.OIDC_ISSUER = oidc.issuer;
    process.env.OIDC_CLIENT_ID = oidc.clientId;
    process.env.OIDC_CLIENT_SECRET = oidc.clientSecret;
    process.env.OIDC_REDIRECT_URI = "http://localhost:8080/api/auth/oidc/callback";

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
    await oidc?.close();
    await pg?.stop();
  });

  const owner = { email: "owner@example.com", password: "ownerpassword1", displayName: "Owner" };
  const invitee = { email: "invitee@example.com", password: "inviteepassword1", displayName: "Invitee" };
  let ownerAccess = "";
  let ownerRefresh = "";
  let workspaceId = "";

  it("registers, requires verification, then verifies and logs in", async () => {
    const reg = await request(http).post("/api/auth/register").send(owner);
    expect(reg.status).toBe(201);
    expect(reg.body.emailVerified).toBe(false);

    // Login before verification is rejected.
    const early = await request(http).post("/api/auth/login").send({ email: owner.email, password: owner.password });
    expect(early.status).toBe(401);

    const token = tokenFromMail(mail.lastTo(owner.email)!.text);
    const verify = await request(http).post("/api/auth/verify-email").send({ token });
    expect(verify.status).toBe(200);

    const login = await request(http).post("/api/auth/login").send({ email: owner.email, password: owner.password });
    expect(login.status).toBe(200);
    expect(login.body.tokens.accessToken).toBeTruthy();
    ownerAccess = login.body.tokens.accessToken;
    ownerRefresh = login.body.tokens.refreshToken;

    const me = await request(http).get("/api/auth/me").set("authorization", `Bearer ${ownerAccess}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(owner.email);
  });

  it("rotates refresh tokens and rejects reuse of the old one", async () => {
    const r1 = await request(http).post("/api/auth/refresh").send({ refreshToken: ownerRefresh });
    expect(r1.status).toBe(200);
    const newRefresh = r1.body.tokens.refreshToken;
    expect(newRefresh).not.toBe(ownerRefresh);

    const reuse = await request(http).post("/api/auth/refresh").send({ refreshToken: ownerRefresh });
    expect(reuse.status).toBe(401);
    ownerRefresh = newRefresh;
  });

  it("rejects login on a wrong password and an unauthenticated /me", async () => {
    expect((await request(http).post("/api/auth/login").send({ email: owner.email, password: "wrong-password" })).status).toBe(401);
    expect((await request(http).get("/api/auth/me")).status).toBe(401);
  });

  it("creates a workspace with the creator as owner", async () => {
    const res = await request(http)
      .post("/api/workspaces")
      .set("authorization", `Bearer ${ownerAccess}`)
      .send({ name: "Acme" });
    expect(res.status).toBe(201);
    workspaceId = res.body.id;

    const members = await request(http)
      .get(`/api/workspaces/${workspaceId}/members`)
      .set("authorization", `Bearer ${ownerAccess}`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(1);
    expect(members.body[0].role).toBe("owner");
    expect(members.body[0].email).toBe(owner.email);
  });

  it("invites a member who accepts and gains access to the workspace", async () => {
    const invite = await request(http)
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set("authorization", `Bearer ${ownerAccess}`)
      .send({ email: invitee.email, role: "member" });
    expect(invite.status).toBe(201);
    const inviteToken = tokenFromMail(mail.lastTo(invitee.email)!.text);

    // Second user registers, verifies, logs in.
    await request(http).post("/api/auth/register").send(invitee);
    const verifyToken = tokenFromMail(
      mail.messages.filter((m) => m.to === invitee.email && m.text.includes("verify-email")).at(-1)!.text,
    );
    await request(http).post("/api/auth/verify-email").send({ token: verifyToken });
    const login2 = await request(http).post("/api/auth/login").send({ email: invitee.email, password: invitee.password });
    expect(login2.status).toBe(200);
    const inviteeAccess = login2.body.tokens.accessToken;

    // Before accepting, the invitee cannot see the workspace.
    const before = await request(http).get("/api/workspaces").set("authorization", `Bearer ${inviteeAccess}`);
    expect(before.body.map((w: { id: string }) => w.id)).not.toContain(workspaceId);

    const accept = await request(http)
      .post("/api/invitations/accept")
      .set("authorization", `Bearer ${inviteeAccess}`)
      .send({ token: inviteToken });
    expect(accept.status).toBe(200);

    const after = await request(http).get("/api/workspaces").set("authorization", `Bearer ${inviteeAccess}`);
    expect(after.body.map((w: { id: string }) => w.id)).toContain(workspaceId);
  });

  it("logs in via OIDC against the test provider", async () => {
    const loginRes = await request(http).get("/api/auth/oidc/login");
    expect(loginRes.status).toBe(302);
    const authorizeUrl = loginRes.headers.location as string;
    expect(authorizeUrl).toContain(oidc.issuer);

    const authRes = await fetch(authorizeUrl, { redirect: "manual" });
    expect(authRes.status).toBe(302);
    const callbackUrl = new URL(authRes.headers.get("location")!);
    const code = callbackUrl.searchParams.get("code")!;
    const state = callbackUrl.searchParams.get("state")!;

    const cb = await request(http).get(
      `/api/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
    expect(cb.status).toBe(200);
    expect(cb.body.user.email).toBe(oidc.email);
    expect(cb.body.tokens.accessToken).toBeTruthy();

    const me = await request(http).get("/api/auth/me").set("authorization", `Bearer ${cb.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(oidc.email);
  });
});
