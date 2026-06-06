import { describe, expect, it, vi } from "vitest";
import {
  resolvePageAccess,
  capabilitiesForRole,
  type PageAccessPrisma,
} from "../src/permissions";

/**
 * Unit tests for the shared page-access resolver (spec §5). A hand-rolled fake
 * Prisma backed by an in-memory page tree + grant list + membership lets us
 * assert the full algorithm (tree inheritance, nearest-grant-wins, role
 * defaults, guest scoping) without a live database. The same resolver is
 * exercised against real Postgres in the API/sync integration tests.
 */

interface PageNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  archivedAt?: Date | null;
}

interface Grant {
  pageId: string;
  subjectType: string;
  subjectId: string | null;
  role: string;
}

interface World {
  pages: PageNode[];
  /** workspaceId|userId -> role (absence = non-member). */
  members: Record<string, string>;
  grants: Grant[];
}

function fakePrisma(world: World) {
  const page = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const p = world.pages.find((x) => x.id === where.id);
      if (!p) return null;
      return {
        id: p.id,
        workspaceId: p.workspaceId,
        parentId: p.parentId,
        archivedAt: p.archivedAt ?? null,
      };
    }),
  };
  const workspaceMember = {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { workspaceId_userId: { workspaceId: string; userId: string } };
      }) => {
        const { workspaceId, userId } = where.workspaceId_userId;
        const role = world.members[`${workspaceId}|${userId}`];
        return role ? { id: "m", role } : null;
      },
    ),
  };
  const permission = {
    findMany: vi.fn(async ({ where }: { where: { pageId: { in: string[] } } }) => {
      const set = new Set(where.pageId.in);
      return world.grants.filter((g) => set.has(g.pageId));
    }),
  };
  return {
    prisma: { page, workspaceMember, permission } as unknown as PageAccessPrisma,
    page,
    workspaceMember,
    permission,
  };
}

/** A small workspace with a 3-level tree: root → child → grandchild + a sibling. */
function tree(extra?: Partial<World>): World {
  return {
    pages: [
      { id: "root", workspaceId: "ws", parentId: null },
      { id: "child", workspaceId: "ws", parentId: "root" },
      { id: "grandchild", workspaceId: "ws", parentId: "child" },
      { id: "sibling", workspaceId: "ws", parentId: "root" },
    ],
    members: {},
    grants: [],
    ...extra,
  };
}

describe("capabilitiesForRole", () => {
  it("maps each role to the spec capability bundle", () => {
    expect(capabilitiesForRole("full")).toEqual({
      role: "full",
      canRead: true,
      canComment: true,
      canWrite: true,
      canShare: true,
    });
    expect(capabilitiesForRole("edit")).toEqual({
      role: "edit",
      canRead: true,
      canComment: true,
      canWrite: true,
      canShare: false,
    });
    expect(capabilitiesForRole("comment")).toEqual({
      role: "comment",
      canRead: true,
      canComment: true,
      canWrite: false,
      canShare: false,
    });
    expect(capabilitiesForRole("read")).toEqual({
      role: "read",
      canRead: true,
      canComment: false,
      canWrite: false,
      canShare: false,
    });
  });
});

describe("resolvePageAccess — guards", () => {
  it("returns null for empty user or page ids without touching the db", async () => {
    const { prisma, page } = fakePrisma(tree());
    expect(await resolvePageAccess(prisma, "", "child")).toBeNull();
    expect(await resolvePageAccess(prisma, "u", "")).toBeNull();
    expect(page.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the page does not exist", async () => {
    const { prisma } = fakePrisma(tree());
    expect(await resolvePageAccess(prisma, "u", "missing")).toBeNull();
  });

  it("survives a parent cycle (bounded walk) and still resolves", async () => {
    // root.parent = child, child.parent = root  → a cycle.
    const world: World = {
      pages: [
        { id: "root", workspaceId: "ws", parentId: "child" },
        { id: "child", workspaceId: "ws", parentId: "root" },
      ],
      members: { "ws|owner": "owner" },
      grants: [],
    };
    const { prisma } = fakePrisma(world);
    const access = await resolvePageAccess(prisma, "owner", "child");
    expect(access?.role).toBe("full");
  });
});

describe("resolvePageAccess — workspace role defaults", () => {
  it("owner → full", async () => {
    const { prisma } = fakePrisma(tree({ members: { "ws|u": "owner" } }));
    expect((await resolvePageAccess(prisma, "u", "child"))?.role).toBe("full");
  });

  it("admin → full", async () => {
    const { prisma } = fakePrisma(tree({ members: { "ws|u": "admin" } }));
    expect((await resolvePageAccess(prisma, "u", "child"))?.role).toBe("full");
  });

  it("member → edit (read+write, no share)", async () => {
    const { prisma } = fakePrisma(tree({ members: { "ws|u": "member" } }));
    const access = await resolvePageAccess(prisma, "u", "child");
    expect(access).toEqual({
      role: "edit",
      canRead: true,
      canComment: true,
      canWrite: true,
      canShare: false,
    });
  });

  it("guest → null (no default, page-grant only)", async () => {
    const { prisma } = fakePrisma(tree({ members: { "ws|u": "guest" } }));
    expect(await resolvePageAccess(prisma, "u", "child")).toBeNull();
  });

  it("non-member → null", async () => {
    const { prisma } = fakePrisma(tree());
    expect(await resolvePageAccess(prisma, "stranger", "child")).toBeNull();
  });
});

describe("resolvePageAccess — explicit user grants", () => {
  it("an explicit grant on the page itself wins for a non-member guest", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [{ pageId: "child", subjectType: "user", subjectId: "g", role: "read" }],
      }),
    );
    const access = await resolvePageAccess(prisma, "g", "child");
    expect(access?.role).toBe("read");
    expect(access?.canRead).toBe(true);
    expect(access?.canWrite).toBe(false);
  });

  it("an ancestor grant is inherited down the tree", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [{ pageId: "child", subjectType: "user", subjectId: "g", role: "edit" }],
      }),
    );
    // grandchild has no own grant but inherits child's edit grant.
    const access = await resolvePageAccess(prisma, "g", "grandchild");
    expect(access?.role).toBe("edit");
    expect(access?.canWrite).toBe(true);
  });

  it("the NEAREST grant wins even when it is LESS permissive than an ancestor's", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [
          { pageId: "child", subjectType: "user", subjectId: "g", role: "read" }, // nearer, weaker
          { pageId: "root", subjectType: "user", subjectId: "g", role: "full" }, // farther, stronger
        ],
      }),
    );
    const access = await resolvePageAccess(prisma, "g", "grandchild");
    // grandchild's nearest grant is on `child` (read) → read wins, NOT root's full.
    expect(access?.role).toBe("read");
  });

  it("the NEAREST grant wins even when it is MORE permissive than an ancestor's", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [
          { pageId: "child", subjectType: "user", subjectId: "g", role: "full" }, // nearer, stronger
          { pageId: "root", subjectType: "user", subjectId: "g", role: "read" }, // farther, weaker
        ],
      }),
    );
    const access = await resolvePageAccess(prisma, "g", "grandchild");
    expect(access?.role).toBe("full");
  });

  it("among multiple grants at the SAME level, the most permissive wins", async () => {
    // A user grant (comment) and a workspace grant (full) both on `child`.
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|u": "member" },
        grants: [
          { pageId: "child", subjectType: "user", subjectId: "u", role: "comment" },
          { pageId: "child", subjectType: "workspace", subjectId: "ws", role: "full" },
        ],
      }),
    );
    const access = await resolvePageAccess(prisma, "u", "child");
    expect(access?.role).toBe("full");
  });
});

describe("resolvePageAccess — guest subtree scoping (the gate)", () => {
  it("a guest granted on a subtree page gets that page AND its descendants", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [{ pageId: "child", subjectType: "user", subjectId: "g", role: "read" }],
      }),
    );
    expect((await resolvePageAccess(prisma, "g", "child"))?.canRead).toBe(true);
    expect((await resolvePageAccess(prisma, "g", "grandchild"))?.canRead).toBe(true);
  });

  it("a guest is denied on a sibling outside the granted subtree", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [{ pageId: "child", subjectType: "user", subjectId: "g", role: "read" }],
      }),
    );
    // `sibling` is under root but not under `child` → no inherited grant → denied.
    expect(await resolvePageAccess(prisma, "g", "sibling")).toBeNull();
  });

  it("a guest is denied on the ancestor above the granted page", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [{ pageId: "child", subjectType: "user", subjectId: "g", role: "read" }],
      }),
    );
    // `root` is ABOVE the grant on `child`; the grant does not bubble up → denied.
    expect(await resolvePageAccess(prisma, "g", "root")).toBeNull();
  });
});

describe("resolvePageAccess — workspace-subject grants", () => {
  it("a workspace grant applies to any member of that workspace", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|u": "member" },
        grants: [{ pageId: "child", subjectType: "workspace", subjectId: "ws", role: "read" }],
      }),
    );
    // member would default to edit, but the nearer explicit workspace grant
    // (read) wins on `child`.
    const access = await resolvePageAccess(prisma, "u", "child");
    expect(access?.role).toBe("read");
  });

  it("a workspace grant does NOT apply to a non-member", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: {},
        grants: [{ pageId: "child", subjectType: "workspace", subjectId: "ws", role: "full" }],
      }),
    );
    expect(await resolvePageAccess(prisma, "stranger", "child")).toBeNull();
  });

  it("a workspace grant does NOT apply to a guest of a DIFFERENT workspace id", async () => {
    const { prisma } = fakePrisma(
      tree({
        members: { "ws|g": "guest" },
        grants: [
          { pageId: "child", subjectType: "workspace", subjectId: "other-ws", role: "full" },
        ],
      }),
    );
    // The grant's subjectId is a different workspace → does not apply → guest
    // falls through to no default → null.
    expect(await resolvePageAccess(prisma, "g", "child")).toBeNull();
  });
});

describe("resolvePageAccess — efficiency", () => {
  it("loads all path grants in a single permission.findMany query", async () => {
    const { prisma, permission, page } = fakePrisma(
      tree({ members: { "ws|u": "member" } }),
    );
    await resolvePageAccess(prisma, "u", "grandchild");
    // One findMany for the whole ancestor chain (not one per ancestor).
    expect(permission.findMany).toHaveBeenCalledTimes(1);
    expect(permission.findMany).toHaveBeenCalledWith({
      where: { pageId: { in: ["grandchild", "child", "root"] } },
      select: { pageId: true, subjectType: true, subjectId: true, role: true },
    });
    // The page walk visits each ancestor exactly once.
    expect(page.findUnique).toHaveBeenCalledTimes(3);
  });
});
