import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ReorderFavoritesInput } from "@inclination/shared";
import { resolvePageAccess } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Phase 9 — favorites & recently-visited (spec §5).
 *
 * Every add/visit requires the caller can READ the page via the SAME shared
 * `resolvePageAccess` the rest of the API uses (no duplicated authz). Lists
 * return only pages the caller can STILL read and that are not archived — a
 * stale Favorite/RecentlyVisited row (page archived or access revoked) is simply
 * filtered out at read time rather than eagerly cleaned up.
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Assert the page exists (404) and the caller can read it (403) via the resolver. */
  private async requireReadable(userId: string, pageId: string): Promise<void> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException("Page not found");
    const access = await resolvePageAccess(this.prisma, userId, pageId);
    if (!access || !access.canRead) {
      throw new ForbiddenException("You do not have access to this page");
    }
  }

  /**
   * Filter a set of candidate pageIds down to those the caller can still READ.
   * Resolves access for each id in parallel; archived/forbidden pages drop out.
   * Returns the readable ids in the SAME input order.
   */
  private async filterReadable(userId: string, pageIds: string[]): Promise<Set<string>> {
    if (pageIds.length === 0) return new Set();
    const results = await Promise.all(
      pageIds.map(async (id) => {
        const access = await resolvePageAccess(this.prisma, userId, id);
        return access?.canRead ? id : null;
      }),
    );
    return new Set(results.filter((id): id is string => id !== null));
  }

  /** Add the page to the caller's favorites (idempotent). Requires read access. */
  async addFavorite(userId: string, pageId: string) {
    await this.requireReadable(userId, pageId);
    // New favorites sort to the bottom: order = current count.
    const count = await this.prisma.favorite.count({ where: { userId } });
    await this.prisma.favorite.upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId, order: count },
      update: {},
    });
    return { favorited: true };
  }

  /** Remove the page from the caller's favorites (idempotent). */
  async removeFavorite(userId: string, pageId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, pageId } });
    return { favorited: false };
  }

  /**
   * The caller's favorites with page title/icon, sorted by `order` then
   * createdAt. Archived pages and pages the caller can no longer read are
   * excluded (rows are left in place — harmless).
   */
  async listFavorites(userId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    if (favorites.length === 0) return [];

    const pages = await this.prisma.page.findMany({
      where: { id: { in: favorites.map((f) => f.pageId) }, archivedAt: null },
      select: { id: true, title: true, icon: true },
    });
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const readable = await this.filterReadable(
      userId,
      favorites.map((f) => f.pageId).filter((id) => pageById.has(id)),
    );

    return favorites
      .filter((f) => readable.has(f.pageId))
      .map((f) => {
        const p = pageById.get(f.pageId)!;
        return { pageId: f.pageId, title: p.title, icon: p.icon, order: f.order };
      });
  }

  /**
   * Reorder the caller's favorites. `pageIds` is the desired order; only ids the
   * caller has actually favorited are written (others ignored). Persists `order`
   * = array index for the matched ids in one transaction.
   */
  async reorder(userId: string, input: ReorderFavoritesInput) {
    const existing = await this.prisma.favorite.findMany({
      where: { userId },
      select: { pageId: true },
    });
    const owned = new Set(existing.map((f) => f.pageId));
    const ordered = input.pageIds.filter((id) => owned.has(id));

    await this.prisma.$transaction(
      ordered.map((pageId, index) =>
        this.prisma.favorite.update({
          where: { userId_pageId: { userId, pageId } },
          data: { order: index },
        }),
      ),
    );
    return { reordered: ordered.length };
  }

  /** Record (or bump) a page visit for the caller. Requires read access. */
  async recordVisit(userId: string, pageId: string) {
    await this.requireReadable(userId, pageId);
    const now = new Date();
    await this.prisma.recentlyVisited.upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId, visitedAt: now },
      update: { visitedAt: now },
    });
    return { visited: true };
  }

  /**
   * The caller's recently-visited pages (newest first, capped) with title/icon.
   * Archived pages and pages the caller can no longer read are excluded.
   */
  async listRecents(userId: string) {
    const LIMIT = 20;
    // Pull a few extra so filtering out inaccessible/archived rows still yields a
    // useful list without an unbounded scan.
    const recents = await this.prisma.recentlyVisited.findMany({
      where: { userId },
      orderBy: { visitedAt: "desc" },
      take: LIMIT * 3,
    });
    if (recents.length === 0) return [];

    const pages = await this.prisma.page.findMany({
      where: { id: { in: recents.map((r) => r.pageId) }, archivedAt: null },
      select: { id: true, title: true, icon: true },
    });
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const readable = await this.filterReadable(
      userId,
      recents.map((r) => r.pageId).filter((id) => pageById.has(id)),
    );

    return recents
      .filter((r) => readable.has(r.pageId))
      .slice(0, LIMIT)
      .map((r) => {
        const p = pageById.get(r.pageId)!;
        return { pageId: r.pageId, title: p.title, icon: p.icon, visitedAt: r.visitedAt };
      });
  }
}
