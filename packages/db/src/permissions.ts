/**
 * Shared page-authorization resolver.
 *
 * This is the SINGLE source of truth for "what may this user do with this page?".
 * It is invoked from both the API (`pages.service.ts`, `database-access.service.ts`)
 * and the sync server (`apps/sync`) so the two services cannot drift apart
 * (spec §9 invariant).
 *
 * Algorithm (spec §5 "Permission resolution"):
 *  1. Load the page and walk up its ancestor chain (page → parents → root),
 *     bounded to guard against cycles / pathologically deep trees.
 *  2. Load the user's WorkspaceMember for the page's workspace (their role).
 *  3. Walk from the page upward. At each level look for explicit `Permission`
 *     grants matching the user directly (subjectType=user, subjectId=userId) or
 *     the user's workspace (subjectType=workspace, subjectId=workspaceId — only
 *     if the user is a member). The NEAREST level with any matching grant wins;
 *     within that level, the most permissive grant wins. (`public` grants resolve
 *     to `read` and are honoured if present, but Phase 6 does not create them —
 *     that's Phase 8 publishing.)
 *  4. If no explicit grant on the path: apply the workspace default for the
 *     member's role — owner/admin → full, member → edit, GUEST → none (null).
 *     A non-member with no grant → null.
 *  5. Map the resulting PermissionRole to capabilities.
 *
 * `null` means "no access" (page missing, or no role/grant resolves). The shape
 * is `{ role, canRead, canComment, canWrite, canShare }` so call sites can gate
 * read vs comment vs write vs share off one resolution.
 */

import type { PermissionRole, WorkspaceRole } from "@inclination/shared";

export type { PermissionRole };

export interface PageAccess {
  /** The effective permission role the user holds on this page. */
  role: PermissionRole;
  canRead: boolean;
  canComment: boolean;
  canWrite: boolean;
  canShare: boolean;
}

/**
 * Capability bundle for each permission role (spec §5):
 *   full    → read + comment + write + share/manage
 *   edit    → read + comment + write
 *   comment → read + comment
 *   read    → read
 */
export function capabilitiesForRole(role: PermissionRole): PageAccess {
  switch (role) {
    case "full":
      return { role, canRead: true, canComment: true, canWrite: true, canShare: true };
    case "edit":
      return { role, canRead: true, canComment: true, canWrite: true, canShare: false };
    case "comment":
      return { role, canRead: true, canComment: true, canWrite: false, canShare: false };
    case "read":
      return { role, canRead: true, canComment: false, canWrite: false, canShare: false };
  }
}

/** Workspace member role → default page permission role (null = no default). */
function defaultRoleForMember(workspaceRole: WorkspaceRole): PermissionRole | null {
  switch (workspaceRole) {
    case "owner":
    case "admin":
      return "full";
    case "member":
      return "edit";
    case "guest":
      // Guests get NO workspace-wide default — they only see pages explicitly
      // granted to them (or to a subtree above the page).
      return null;
  }
}

/** Higher value = more permissive. Used to pick the strongest grant at a level. */
const ROLE_RANK: Record<PermissionRole, number> = {
  read: 0,
  comment: 1,
  edit: 2,
  full: 3,
};

/** Return whichever of two roles is more permissive. */
function mostPermissive(a: PermissionRole, b: PermissionRole): PermissionRole {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/** Guard against cycles / runaway trees while walking ancestors. */
const MAX_ANCESTOR_DEPTH = 1000;

/**
 * A single explicit grant as the resolver consumes it. Mirrors the `Permission`
 * row's relevant columns.
 */
interface GrantRow {
  pageId: string;
  subjectType: string;
  subjectId: string | null;
  role: string;
}

/**
 * Minimal structural view of the Prisma client this resolver depends on. Using
 * an interface (rather than the concrete `PrismaClient`) keeps the resolver
 * trivially unit-testable with a hand-rolled fake and avoids coupling the
 * signature to the full generated client surface.
 */
export interface PageAccessPrisma {
  page: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; workspaceId: true; parentId: true; archivedAt: true };
    }): Promise<{
      id: string;
      workspaceId: string;
      parentId: string | null;
      archivedAt: Date | null;
    } | null>;
  };
  workspaceMember: {
    findUnique(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
    }): Promise<{ role: string } | { id: string } | Record<string, unknown> | null>;
  };
  permission: {
    findMany(args: {
      where: { pageId: { in: string[] } };
      select: { pageId: true; subjectType: true; subjectId: true; role: true };
    }): Promise<GrantRow[]>;
  };
}

/** Coerce an unknown string column into a known PermissionRole, or null. */
function asPermissionRole(role: string): PermissionRole | null {
  return role === "full" || role === "edit" || role === "comment" || role === "read"
    ? role
    : null;
}

/**
 * Resolve a user's access to a page.
 *
 * @returns `{ role, canRead, canComment, canWrite, canShare }` when the user may
 *          access the page, or `null` when the page is missing or no role/grant
 *          resolves to access.
 */
export async function resolvePageAccess(
  prisma: PageAccessPrisma,
  userId: string,
  pageId: string,
): Promise<PageAccess | null> {
  if (!userId || !pageId) return null;

  // 1. Walk the ancestor chain, nearest (the page itself) first.
  const chain: { id: string; workspaceId: string }[] = [];
  let cursor: string | null = pageId;
  const seen = new Set<string>();
  let workspaceId: string | null = null;

  while (cursor && !seen.has(cursor) && chain.length < MAX_ANCESTOR_DEPTH) {
    seen.add(cursor);
    const node: {
      id: string;
      workspaceId: string;
      parentId: string | null;
      archivedAt: Date | null;
    } | null = await prisma.page.findUnique({
      where: { id: cursor },
      select: { id: true, workspaceId: true, parentId: true, archivedAt: true },
    });
    if (!node) break;
    if (workspaceId === null) workspaceId = node.workspaceId;
    chain.push({ id: node.id, workspaceId: node.workspaceId });
    cursor = node.parentId;
  }

  // The target page does not exist → no access.
  if (chain.length === 0 || workspaceId === null) return null;

  // 2. The user's membership/role in the page's workspace (may be absent).
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  const memberRole =
    member && typeof (member as { role?: unknown }).role === "string"
      ? ((member as { role: string }).role as WorkspaceRole)
      : null;
  const isMember = memberRole !== null;

  // 3. Load every grant on the ancestor path in ONE query, then find the
  //    nearest level (chain order) with a grant that applies to this user.
  const pageIds = chain.map((p) => p.id);
  const grants = await prisma.permission.findMany({
    where: { pageId: { in: pageIds } },
    select: { pageId: true, subjectType: true, subjectId: true, role: true },
  });

  const byPage = new Map<string, GrantRow[]>();
  for (const g of grants) {
    const list = byPage.get(g.pageId);
    if (list) list.push(g);
    else byPage.set(g.pageId, [g]);
  }

  // Does a grant apply to (user, workspace, public)?
  const applies = (g: GrantRow): PermissionRole | null => {
    if (g.subjectType === "user" && g.subjectId === userId) return asPermissionRole(g.role);
    if (g.subjectType === "workspace" && isMember && g.subjectId === workspaceId)
      return asPermissionRole(g.role);
    // `public` grants (Phase 8) resolve to read for anyone who can reach them.
    if (g.subjectType === "public") return asPermissionRole(g.role) ? "read" : null;
    return null;
  };

  // Walk nearest → farthest; first level with any applicable grant wins, and
  // among that level's applicable grants take the most permissive (spec §5).
  for (const node of chain) {
    const levelGrants = byPage.get(node.id);
    if (!levelGrants) continue;
    let best: PermissionRole | null = null;
    for (const g of levelGrants) {
      const r = applies(g);
      if (r) best = best === null ? r : mostPermissive(best, r);
    }
    if (best !== null) return capabilitiesForRole(best);
  }

  // 4. No explicit grant on the path → workspace default for the member's role.
  if (!isMember || memberRole === null) return null;
  const defaultRole = defaultRoleForMember(memberRole);
  if (defaultRole === null) return null; // guest with no grant → no access.

  return capabilitiesForRole(defaultRole);
}
