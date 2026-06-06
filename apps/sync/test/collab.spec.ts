import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import {
  authenticateDocument,
  authenticatePage,
  authenticateSyncedBlock,
  documentNameToPageId,
  documentNameToSyncedId,
  fetchSyncedState,
  fetchYdocState,
  maybeWriteSnapshot,
  pageIdToDocumentName,
  storeSyncedState,
  storeYdocState,
  syncedIdToDocumentName,
  type CollabPrisma,
  type SyncedAccessPrisma,
} from "../src/collab.js";
import type { PageAccessPrisma } from "@inclination/db";

const SECRET = "test-sync-secret";

function signToken(sub: string, opts: jwt.SignOptions = {}): string {
  return jwt.sign({ sub }, SECRET, { expiresIn: "15m", ...opts });
}

/**
 * Fake Prisma for the auth path (page lookup + membership + grants). The shared
 * resolver walks the page's ancestor chain; a single root page (parentId=null)
 * keeps these auth tests focused on the membership/grant outcome. `grants`
 * defaults to none so the workspace-role default applies.
 */
function authPrisma(opts: {
  page?: { workspaceId: string; archivedAt: Date | null } | null;
  member?: Record<string, unknown> | null;
  grants?: { pageId: string; subjectType: string; subjectId: string | null; role: string }[];
}): PageAccessPrisma {
  const pageRow = opts.page
    ? { id: "page-1", parentId: null, ...opts.page }
    : null;
  return {
    page: { findUnique: vi.fn().mockResolvedValue(pageRow) },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue(opts.member ?? null) },
    permission: { findMany: vi.fn().mockResolvedValue(opts.grants ?? []) },
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

  it("parses synced:{id} and rejects malformed/page names", () => {
    expect(documentNameToSyncedId("synced:blk-9")).toBe("blk-9");
    expect(syncedIdToDocumentName("blk-9")).toBe("synced:blk-9");
    expect(documentNameToSyncedId("synced:")).toBeNull();
    expect(documentNameToSyncedId("page:blk-9")).toBeNull();
    expect(documentNameToSyncedId("")).toBeNull();
    // A page name is not a synced name and vice-versa.
    expect(documentNameToPageId("synced:blk-9")).toBeNull();
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

/** Fake Prisma for synced-block authorization. */
function syncedAuthPrisma(opts: {
  block?: { workspaceId: string } | null;
  member?: Record<string, unknown> | null;
}): SyncedAccessPrisma {
  return {
    syncedBlock: { findUnique: vi.fn().mockResolvedValue(opts.block ?? null) },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue(opts.member ?? null) },
  } as unknown as SyncedAccessPrisma;
}

describe("authenticateSyncedBlock", () => {
  it("authenticates a workspace member (writable)", async () => {
    const prisma = syncedAuthPrisma({ block: { workspaceId: "ws-1" }, member: { id: "m-1" } });
    const token = signToken("user-1");

    const result = await authenticateSyncedBlock(
      { prisma, secret: SECRET },
      token,
      "synced:blk-1",
    );
    expect(result.context).toEqual({ userId: "user-1" });
    expect(result.readOnly).toBe(false);
  });

  it("rejects a non-member of the block's workspace", async () => {
    const prisma = syncedAuthPrisma({ block: { workspaceId: "ws-1" }, member: null });
    const token = signToken("outsider");
    await expect(
      authenticateSyncedBlock({ prisma, secret: SECRET }, token, "synced:blk-1"),
    ).rejects.toThrow(/Access denied/);
  });

  it("rejects a missing synced block", async () => {
    const prisma = syncedAuthPrisma({ block: null });
    const token = signToken("user-1");
    await expect(
      authenticateSyncedBlock({ prisma, secret: SECRET }, token, "synced:ghost"),
    ).rejects.toThrow(/Access denied/);
  });

  it("rejects a forged token before authorizing", async () => {
    const prisma = syncedAuthPrisma({ block: { workspaceId: "ws-1" }, member: { id: "m-1" } });
    const forged = jwt.sign({ sub: "user-1" }, "wrong-secret", { expiresIn: "15m" });
    await expect(
      authenticateSyncedBlock({ prisma, secret: SECRET }, forged, "synced:blk-1"),
    ).rejects.toThrow(/Invalid token/);
  });

  it("rejects a malformed synced document name before touching the db", async () => {
    const prisma = syncedAuthPrisma({ block: { workspaceId: "ws-1" }, member: { id: "m-1" } });
    const token = signToken("user-1");
    await expect(
      authenticateSyncedBlock({ prisma, secret: SECRET }, token, "synced:"),
    ).rejects.toThrow(/Invalid document name/);
    expect(prisma.syncedBlock.findUnique as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe("authenticateDocument routing", () => {
  it("routes page:{id} to the page resolver and synced:{id} to the synced resolver", async () => {
    // A single fake satisfying BOTH surfaces: a member of ws-1, a page in ws-1,
    // and a synced block in ws-1.
    const prisma = {
      page: { findUnique: vi.fn().mockResolvedValue({ id: "page-1", parentId: null, workspaceId: "ws-1", archivedAt: null }) },
      permission: { findMany: vi.fn().mockResolvedValue([]) },
      syncedBlock: { findUnique: vi.fn().mockResolvedValue({ workspaceId: "ws-1" }) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ id: "m-1", role: "member" }) },
    } as unknown as PageAccessPrisma & SyncedAccessPrisma;
    const token = signToken("user-1");

    const page = await authenticateDocument({ prisma, secret: SECRET }, token, "page:page-1");
    expect(page.context).toEqual({ userId: "user-1" });

    const synced = await authenticateDocument({ prisma, secret: SECRET }, token, "synced:blk-1");
    expect(synced.context).toEqual({ userId: "user-1" });
    expect((prisma.syncedBlock.findUnique as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

/** In-memory fake of the synced persistence surface. */
function syncedCollabPrisma() {
  const states = new Map<string, Uint8Array>();
  const prisma = {
    syncedBlock: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const v = states.get(where.id);
        return v ? { ydocState: v as Uint8Array<ArrayBuffer> } : { ydocState: null };
      },
      update: async ({ where, data }: { where: { id: string }; data: { ydocState: Uint8Array } }) => {
        states.set(where.id, data.ydocState);
        return undefined;
      },
    },
  } as unknown as CollabPrisma;
  return { prisma, states };
}

describe("synced store / fetch round-trip", () => {
  it("stores a synced Yjs update and fetches it back", async () => {
    const { prisma } = syncedCollabPrisma();
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "synced content");
    const update = Y.encodeStateAsUpdate(doc);

    await storeSyncedState(prisma, "synced:blk-1", update);
    const loaded = await fetchSyncedState(prisma, "synced:blk-1");

    expect(loaded).not.toBeNull();
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, loaded!);
    expect(doc2.getText("body").toString()).toBe("synced content");
  });

  it("returns null when no synced state stored, and throws on malformed names", async () => {
    const { prisma } = syncedCollabPrisma();
    expect(await fetchSyncedState(prisma, "synced:none")).toBeNull();
    expect(await fetchSyncedState(prisma, "page:x")).toBeNull();
    await expect(storeSyncedState(prisma, "page:x", new Uint8Array([1]))).rejects.toThrow(
      /Invalid document name/,
    );
  });
});
