import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MAIL_TRANSPORT, type CapturingTransport } from "../src/mail/transports";

/**
 * Phase 5 (T4) realtime gateway integration: a real socket.io client connects to
 * the gateway (path /api/realtime), authenticates via the handshake token,
 * subscribes to a `database:{id}` room, and receives a `database:event` when a
 * cell is mutated over HTTP. Also asserts an invalid token is rejected and a
 * subscription to an inaccessible database yields no events. Runs against a real
 * Postgres (Testcontainers).
 */
describe("Realtime gateway (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;
  let mail: CapturingTransport;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let baseUrl = "";

  const sockets: Socket[] = [];

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

  const connect = (token: string | undefined): Socket => {
    const socket = io(baseUrl, {
      path: "/api/realtime",
      transports: ["websocket"],
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  };

  const auth = (token: string) => `Bearer ${token}`;

  let access = "";
  let workspaceId = "";
  let dbId = "";
  let estimatePropId = "";
  let rowA = "";

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
    // Listen on a real port so a socket.io client can connect to the gateway.
    await app.listen(0, "127.0.0.1");
    const addr = app.getHttpServer().address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    http = app.getHttpServer();
    mail = app.get(MAIL_TRANSPORT);

    // Seed a database with a couple of properties + a row to mutate.
    access = await onboard("rt-owner@example.com");
    const ws = await request(http)
      .post("/api/workspaces")
      .set("authorization", auth(access))
      .send({ name: "RT WS" });
    workspaceId = ws.body.id;

    const db = await request(http)
      .post(`/api/workspaces/${workspaceId}/databases`)
      .set("authorization", auth(access))
      .send({ title: "RT Tasks" });
    dbId = db.body.pageId;

    const estimate = await request(http)
      .post(`/api/databases/${dbId}/properties`)
      .set("authorization", auth(access))
      .send({ name: "Estimate", type: "number" });
    estimatePropId = estimate.body.id;

    const a = await request(http)
      .post(`/api/databases/${dbId}/rows`)
      .set("authorization", auth(access))
      .send({ title: "Row A" });
    rowA = a.body.id;
  }, 180_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app?.close();
    await pg?.stop();
  });

  /** Resolve once the socket emits `connect`, or reject on `connect_error`/timeout. */
  const waitConnected = (socket: Socket): Promise<void> =>
    new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("connect timeout")), 8000);
      socket.once("connect", () => {
        clearTimeout(timer);
        res();
      });
      socket.once("connect_error", (e) => {
        clearTimeout(timer);
        rej(e instanceof Error ? e : new Error(String(e)));
      });
    });

  /** Resolve with the next `database:event`, or reject on timeout. */
  const waitEvent = (socket: Socket, ms = 8000): Promise<Record<string, unknown>> =>
    new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("event timeout")), ms);
      socket.once("database:event", (payload: Record<string, unknown>) => {
        clearTimeout(timer);
        res(payload);
      });
    });

  it("delivers a cell.updated event to a subscribed member", async () => {
    const socket = connect(access);
    await waitConnected(socket);

    const ack = await socket.emitWithAck("subscribe", { databaseId: dbId });
    expect(ack).toMatchObject({ ok: true, databaseId: dbId });

    const eventPromise = waitEvent(socket);
    const setCell = await request(http)
      .put(`/api/rows/${rowA}/cells/${estimatePropId}`)
      .set("authorization", auth(access))
      .send({ value: 7 });
    expect(setCell.status).toBe(200);

    const event = await eventPromise;
    expect(event).toMatchObject({
      databaseId: dbId,
      type: "cell.updated",
      payload: { rowPageId: rowA, propertyId: estimatePropId, value: 7 },
    });
  });

  it("rejects a connection with an invalid token", async () => {
    const socket = connect("not-a-real-jwt");
    // The gateway disconnects an unauthenticated socket; the client sees either a
    // connect_error or an immediate disconnect after connect.
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(new Error("expected rejection")), 8000);
      const done = () => {
        clearTimeout(timer);
        res();
      };
      socket.once("connect_error", done);
      socket.once("disconnect", done);
      socket.once("connect", () => {
        // Connected at the transport layer; the gateway should drop us shortly.
        socket.once("disconnect", done);
      });
    });
    expect(socket.connected).toBe(false);
  });

  it("does not deliver events for a database the user cannot access", async () => {
    const outsider = await onboard("rt-outsider@example.com");
    const socket = connect(outsider);
    await waitConnected(socket);

    const ack = await socket.emitWithAck("subscribe", { databaseId: dbId });
    expect(ack).toMatchObject({ ok: false, error: "forbidden" });

    // Mutate the cell; the outsider (not in the room) must receive nothing.
    let received = false;
    socket.once("database:event", () => {
      received = true;
    });
    const setCell = await request(http)
      .put(`/api/rows/${rowA}/cells/${estimatePropId}`)
      .set("authorization", auth(access))
      .send({ value: 11 });
    expect(setCell.status).toBe(200);

    await new Promise((r) => setTimeout(r, 1500));
    expect(received).toBe(false);
  });
});
