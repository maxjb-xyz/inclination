import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import {
  authenticatePage,
  documentNameToPageId,
  fetchYdocState,
  maybeWriteSnapshot,
  pageIdToDocumentName,
  storeYdocState,
  type CollabPrisma,
} from "../src/collab.js";
import type { PageAccessPrisma } from "@inclination/db";

const SECRET = "test-sync-secret";

function signToken(sub: string, opts: jwt.SignOptions = {}): string {
  return jwt.sign({ sub }, SECRET, { expiresIn: "15m", ...opts });
}

/** Fake Prisma for the auth path (page lookup + membership). */
function authPrisma(opts: {
  page?: { workspaceId: string; archivedAt: Date | null } | null;
  member?: Record<string, unknown> | null;
}): PageAccessPrisma {
  return {
    page: { findUnique: vi.fn().mockResolvedValue(opts.page ?? null) },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue(opts.member ?? null) },
  } as unknown as PageAccessPrisma;
}

const memberPage = {
  page: { workspaceId: "ws-1", archivedAt: null },
  member: { id: "m-1", role: "member" },
};

describe("documentName helpers", () => {
  it("parses page:{id}", () => {
    expect(documentNameToPageId("page:abc-123")).toBe("abc-123");
    expect(pageIdToDocumentName("abc-123")).toBe("page:abc-123");
  });

  it("rejects malformed names", () => {
    expect(documentNameToPageId("abc-123")).toBeNull();
    expect(documentNameToPageId("page:")).toBeNull();
    expect(documentNameToPageId("")).toBeNull();
    expect(documentNameToPageId("database:abc")).toBeNull();
  });
});

describe("authenticatePage", () => {
  it("authenticates a member and returns the userId context (writable)", async () => {
    const prisma = authPrisma(memberPage);
    const token = signToken("user-1");

    const result = await authenticatePage({ prisma, secret: SECRET }, token, "page:page-1");

    expect(result.context).toEqual({ userId: "user-1" });
    expect(result.readOnly).toBe(false);
  });

  it("rejects an invalid/forged token", async () => {
    const prisma = authPrisma(memberPage);
    const forged = jwt.sign({ sub: "user-1" }, "wrong-secret", { expiresIn: "15m" });

    await expect(
      authenticatePage({ prisma, secret: SECRET }, forged, "page:page-1"),
    ).rejects.toThrow(/Invalid token/);
  });

  it("rejects an expired token", async () => {
    const prisma = authPrisma(memberPage);
    const expired = signToken("user-1", { expiresIn: -10 });

    await expect(
      authenticatePage({ prisma, secret: SECRET }, expired, "page:page-1"),
    ).rejects.toThrow(/Invalid token/);
  });

  it("rejects a non-member (no access)", async () => {
    const prisma = authPrisma({ page: { workspaceId: "ws-1", archivedAt: null }, member: null });
    const token = signToken("outsider");

    await expect(
      authenticatePage({ prisma, secret: SECRET }, token, "page:page-1"),
    ).rejects.toThrow(/Access denied/);
  });

  it("rejects a missing page (no access)", async () => {
    const prisma = authPrisma({ page: null });
    const token = signToken("user-1");

    await expect(
      authenticatePage({ prisma, secret: SECRET }, token, "page:ghost"),
    ).rejects.toThrow(/Access denied/);
  });

  it("rejects a malformed document name before touching the db", async () => {
    const prisma = authPrisma(memberPage);
    const token = signToken("user-1");

    await expect(
      authenticatePage({ prisma, secret: SECRET }, token, "not-a-page"),
    ).rejects.toThrow(/Invalid document name/);
    expect((prisma.page.findUnique as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const prisma = authPrisma(memberPage);
    await expect(
      authenticatePage({ prisma, secret: SECRET }, "", "page:page-1"),
    ).rejects.toThrow(/Missing authentication token/);
  });
});

/** In-memory fake of the persistence surface. */
function collabPrisma() {
  const content = new Map<string, Uint8Array>();
  const snapshots: { pageId: string; ydocSnapshot: Uint8Array; authorId: string | null }[] = [];
  const prisma: CollabPrisma = {
    pageContent: {
      findUnique: async ({ where }) => {
        const v = content.get(where.pageId);
        return v ? { ydocState: v as Uint8Array<ArrayBuffer> } : null;
      },
      upsert: async ({ where, create, update }) => {
        content.set(where.pageId, content.has(where.pageId) ? update.ydocState : create.ydocState);
        return undefined;
      },
    },
    pageSnapshot: {
      create: async ({ data }) => {
        snapshots.push({
          pageId: data.pageId,
          ydocSnapshot: data.ydocSnapshot,
          authorId: data.authorId ?? null,
        });
        return undefined;
      },
    },
  };
  return { prisma, content, snapshots };
}

describe("store / fetch round-trip", () => {
  it("stores a Yjs update and fetches it back", async () => {
    const { prisma } = collabPrisma();
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "hello collab");
    const update = Y.encodeStateAsUpdate(doc);

    await storeYdocState(prisma, "page:page-1", update);
    const loaded = await fetchYdocState(prisma, "page:page-1");

    expect(loaded).not.toBeNull();
    // Applying the loaded state to a fresh doc reproduces the content.
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, loaded!);
    expect(doc2.getText("body").toString()).toBe("hello collab");
  });

  it("returns null when no state is stored yet", async () => {
    const { prisma } = collabPrisma();
    expect(await fetchYdocState(prisma, "page:none")).toBeNull();
  });

  it("returns null on a malformed document name and never writes", async () => {
    const { prisma, content } = collabPrisma();
    expect(await fetchYdocState(prisma, "bad")).toBeNull();
    await expect(storeYdocState(prisma, "bad", new Uint8Array([1]))).rejects.toThrow(
      /Invalid document name/,
    );
    expect(content.size).toBe(0);
  });
});

describe("maybeWriteSnapshot throttling", () => {
  it("writes the first snapshot then throttles within the interval", async () => {
    const { prisma, snapshots } = collabPrisma();
    const last = new Map<string, number>();
    const state = new Uint8Array([1, 2, 3]);

    const a = await maybeWriteSnapshot(prisma, "page:p1", state, last, {
      now: 0,
      minIntervalMs: 1000,
      authorId: "user-1",
    });
    const b = await maybeWriteSnapshot(prisma, "page:p1", state, last, {
      now: 500,
      minIntervalMs: 1000,
    });
    const c = await maybeWriteSnapshot(prisma, "page:p1", state, last, {
      now: 1500,
      minIntervalMs: 1000,
    });

    expect([a, b, c]).toEqual([true, false, true]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.authorId).toBe("user-1");
    expect(snapshots[1]!.authorId).toBeNull();
  });

  it("throttles per page independently", async () => {
    const { prisma, snapshots } = collabPrisma();
    const last = new Map<string, number>();
    const state = new Uint8Array([9]);

    await maybeWriteSnapshot(prisma, "page:p1", state, last, { now: 0, minIntervalMs: 1000 });
    await maybeWriteSnapshot(prisma, "page:p2", state, last, { now: 0, minIntervalMs: 1000 });

    expect(snapshots.map((s) => s.pageId)).toEqual(["p1", "p2"]);
  });
});
