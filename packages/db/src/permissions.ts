/**
 * Shared page-authorization resolver.
 *
 * This is the SINGLE source of truth for "can this user read/write this page?".
 * It is invoked from both the API (`pages.service.ts`) and the sync server
 * (`apps/sync`) so the two services cannot drift apart (spec §9 invariant).
 *
 * Phase 3 rule (membership-based): a member of the page's workspace gets full
 * read+write; everyone else is denied. `null` means "no access" — the page does
 * not exist, or the user is not a member. Phase 6 will extend this with
 * fine-grained `Permission` grants and roles (read / comment / edit / full)
 * without changing the call sites.
 */

export interface PageAccess {
  canRead: boolean;
  canWrite: boolean;
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
      select: { workspaceId: true; archivedAt: true };
    }): Promise<{ workspaceId: string; archivedAt: Date | null } | null>;
  };
  workspaceMember: {
    findUnique(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
    }): Promise<{ role: string } | { id: string } | Record<string, unknown> | null>;
  };
}

/**
 * Resolve a user's access to a page.
 *
 * @returns `{ canRead, canWrite }` when the user may access the page, or `null`
 *          when the page is missing or the user is not a member of its workspace.
 */
export async function resolvePageAccess(
  prisma: PageAccessPrisma,
  userId: string,
  pageId: string,
): Promise<PageAccess | null> {
  if (!userId || !pageId) return null;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceId: true, archivedAt: true },
  });
  if (!page) return null;

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } },
  });
  if (!member) return null;

  // Phase 3: any workspace member has full access to the page body.
  return { canRead: true, canWrite: true };
}
