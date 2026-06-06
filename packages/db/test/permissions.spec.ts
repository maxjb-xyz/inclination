import { describe, expect, it, vi } from "vitest";
import { resolvePageAccess, type PageAccessPrisma } from "../src/permissions";

/**
 * Unit tests for the shared page-access resolver. A hand-rolled fake Prisma lets
 * us assert the membership rule without a live database; the same resolver is
 * exercised against real Postgres in the sync integration test.
 */

interface FakeOpts {
  page?: { workspaceId: string; archivedAt: Date | null } | null;
  member?: Record<string, unknown> | null;
}

function fakePrisma(opts: FakeOpts) {
  const page = { findUnique: vi.fn().mockResolvedValue(opts.page ?? null) };
  const workspaceMember = { findUnique: vi.fn().mockResolvedValue(opts.member ?? null) };
  return { prisma: { page, workspaceMember } as unknown as PageAccessPrisma, page, workspaceMember };
}

describe("resolvePageAccess", () => {
  it("grants read+write to a member of the page's workspace", async () => {
    const { prisma, page, workspaceMember } = fakePrisma({
      page: { workspaceId: "ws-1", archivedAt: null },
      member: { id: "m-1", role: "member" },
    });

    const access = await resolvePageAccess(prisma, "user-1", "page-1");

    expect(access).toEqual({ canRead: true, canWrite: true });
    expect(page.findUnique).toHaveBeenCalledWith({
      where: { id: "page-1" },
      select: { workspaceId: true, archivedAt: true },
    });
    expect(workspaceMember.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "ws-1", userId: "user-1" } },
    });
  });

  it("denies a non-member (returns null)", async () => {
    const { prisma, workspaceMember } = fakePrisma({
      page: { workspaceId: "ws-1", archivedAt: null },
      member: null,
    });

    expect(await resolvePageAccess(prisma, "user-2", "page-1")).toBeNull();
    expect(workspaceMember.findUnique).toHaveBeenCalledOnce();
  });

  it("returns null when the page does not exist (and never checks membership)", async () => {
    const { prisma, workspaceMember } = fakePrisma({ page: null });

    expect(await resolvePageAccess(prisma, "user-1", "missing")).toBeNull();
    expect(workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for empty user or page ids without touching the db", async () => {
    const { prisma, page } = fakePrisma({});

    expect(await resolvePageAccess(prisma, "", "page-1")).toBeNull();
    expect(await resolvePageAccess(prisma, "user-1", "")).toBeNull();
    expect(page.findUnique).not.toHaveBeenCalled();
  });
});
