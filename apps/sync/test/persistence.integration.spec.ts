import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { PrismaClient } from "@inclination/db";
import {
  authenticatePage,
  fetchYdocState,
  maybeWriteSnapshot,
  storeYdocState,
} from "../src/collab.js";

/**
 * Exercises the sync server's persistence + auth logic against a REAL Postgres
 * (Testcontainers), reusing the migration-apply pattern from the API integration
 * tests. We test the store/fetch/snapshot functions and onAuthenticate directly
 * rather than wiring a full websocket client (the spec permits this and it is far
 * less flaky).
 */
describe("Sync persistence + auth (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  const SECRET = "test-sync-integration-secret";

  // Seeded ids.
  let userId = "";
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
      cwd: resolve(__dirname, "../../../packages/db"),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = databaseUrl;
    // Import getPrisma after DATABASE_URL is set so the client connects correctly.
    const { getPrisma } = await import("@inclination/db");
    prisma = getPrisma();

    const user = await prisma.user.create({
      data: { email: "member@example.com", displayName: "Member" },
    });
    const outsider = await prisma.user.create({
      data: { email: "outsider@example.com", displayName: "Outsider" },
    });
    userId = user.id;
    outsiderId = outsider.id;

    const workspace = await prisma.workspace.create({
      data: { name: "Acme", members: { create: { userId, role: "owner" } } },
    });
    workspaceId = workspace.id;

    const page = await prisma.page.create({
      data: { workspaceId, title: "Doc", sortKey: "a0", createdById: userId },
    });
    pageId = page.id;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pg?.stop();
  });

  it("stores a Yjs update and fetches it back from real Postgres", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "real postgres roundtrip");
    const update = Y.encodeStateAsUpdate(doc);

    await storeYdocState(prisma, `page:${pageId}`, update);

    const loaded = await fetchYdocState(prisma, `page:${pageId}`);
    expect(loaded).not.toBeNull();

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, loaded!);
    expect(doc2.getText("body").toString()).toBe("real postgres roundtrip");

    // The PageContent row exists with the bytes persisted.
    const row = await prisma.pageContent.findUnique({ where: { pageId } });
    expect(row?.ydocState).toBeTruthy();
  });

  it("creates a fresh PageContent row when none exists, then updates it", async () => {
    const page2 = await prisma.page.create({
      data: { workspaceId, title: "Doc2", sortKey: "a1", createdById: userId },
    });

    const d1 = new Y.Doc();
    d1.getText("body").insert(0, "first");
    await storeYdocState(prisma, `page:${page2.id}`, Y.encodeStateAsUpdate(d1));

    const d2 = new Y.Doc();
    Y.applyUpdate(d2, (await fetchYdocState(prisma, `page:${page2.id}`))!);
    d2.getText("body").insert(d2.getText("body").length, " + second");
    await storeYdocState(prisma, `page:${page2.id}`, Y.encodeStateAsUpdate(d2));

    const d3 = new Y.Doc();
    Y.applyUpdate(d3, (await fetchYdocState(prisma, `page:${page2.id}`))!);
    expect(d3.getText("body").toString()).toBe("first + second");
  });

  it("persists a PageSnapshot row (throttled) to real Postgres", async () => {
    const last = new Map<string, number>();
    const state = Y.encodeStateAsUpdate((() => {
      const d = new Y.Doc();
      d.getText("body").insert(0, "snap");
      return d;
    })());

    const wrote = await maybeWriteSnapshot(prisma, `page:${pageId}`, state, last, {
      now: 0,
      minIntervalMs: 60_000,
      authorId: userId,
    });
    expect(wrote).toBe(true);

    const snaps = await prisma.pageSnapshot.findMany({ where: { pageId } });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.authorId).toBe(userId);
    expect(snaps[0]!.ydocSnapshot).toBeTruthy();
  });

  it("authenticates a member against real Postgres and rejects a non-member", async () => {
    const memberToken = jwt.sign({ sub: userId }, SECRET, { expiresIn: "15m" });
    const outsiderToken = jwt.sign({ sub: outsiderId }, SECRET, { expiresIn: "15m" });

    const ok = await authenticatePage({ prisma, secret: SECRET }, memberToken, `page:${pageId}`);
    expect(ok.context).toEqual({ userId });
    expect(ok.readOnly).toBe(false);

    await expect(
      authenticatePage({ prisma, secret: SECRET }, outsiderToken, `page:${pageId}`),
    ).rejects.toThrow(/Access denied/);

    await expect(
      authenticatePage({ prisma, secret: SECRET }, memberToken, `page:${"00000000-0000-0000-0000-000000000000"}`),
    ).rejects.toThrow(/Access denied/);
  });
});
