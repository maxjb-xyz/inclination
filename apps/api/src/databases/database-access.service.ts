import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Database, Page, Property, View } from "@inclination/db";
import { resolvePageAccess } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Centralised authorization + entity resolution for the databases feature.
 *
 * Every database-owned entity (Database / Property / View / row Page / Cell)
 * ultimately belongs to a container Page that lives in a workspace. This service
 * resolves any of them to that container page and authorizes the caller through
 * the SAME shared `resolvePageAccess` resolver the rest of the API/sync use, so
 * there is no duplicated authz and no IDOR: a property/view/row/cell op always
 * verifies the user can access the owning database's workspace.
 *
 * Each `require*` returns the resolved entity AND the container Page so callers
 * never re-query.
 */
@Injectable()
export class DatabaseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Authorize access to a container page (404 if missing, 403 if not a member). */
  private async authorize(userId: string, containerPageId: string): Promise<void> {
    const access = await resolvePageAccess(this.prisma, userId, containerPageId);
    if (!access) {
      // resolvePageAccess returns null for both a missing page and a non-member.
      // The caller has already established the page exists, so null = not a member.
      throw new ForbiddenException("You are not a member of this workspace");
    }
  }

  /** Resolve a database by its container pageId, authorizing the caller. */
  async requireDatabase(
    userId: string,
    databaseId: string,
  ): Promise<{ database: Database; page: Page }> {
    const database = await this.prisma.database.findUnique({
      where: { pageId: databaseId },
      include: { page: true },
    });
    if (!database) throw new NotFoundException("Database not found");
    await this.authorize(userId, database.pageId);
    return { database, page: database.page };
  }

  /** Resolve a property and its owning database, authorizing the caller. */
  async requireProperty(
    userId: string,
    propertyId: string,
  ): Promise<{ property: Property; database: Database; page: Page }> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { database: { include: { page: true } } },
    });
    if (!property) throw new NotFoundException("Property not found");
    await this.authorize(userId, property.database.pageId);
    return { property, database: property.database, page: property.database.page };
  }

  /** Resolve a view and its owning database, authorizing the caller. */
  async requireView(
    userId: string,
    viewId: string,
  ): Promise<{ view: View; database: Database; page: Page }> {
    const view = await this.prisma.view.findUnique({
      where: { id: viewId },
      include: { database: { include: { page: true } } },
    });
    if (!view) throw new NotFoundException("View not found");
    await this.authorize(userId, view.database.pageId);
    return { view, database: view.database, page: view.database.page };
  }

  /**
   * Resolve a row Page (a Page of type `row`) and its owning database,
   * authorizing the caller via the database's container page.
   */
  async requireRow(
    userId: string,
    rowPageId: string,
  ): Promise<{ row: Page; database: Database; container: Page }> {
    const row = await this.prisma.page.findUnique({ where: { id: rowPageId } });
    if (!row || row.type !== "row") throw new NotFoundException("Row not found");
    const container = await this.resolveRowContainer(row);
    if (!container) throw new NotFoundException("Row's database not found");
    const database = await this.prisma.database.findUnique({
      where: { pageId: container.id },
    });
    if (!database) throw new NotFoundException("Row's database not found");
    await this.authorize(userId, container.id);
    return { row, database, container };
  }

  /**
   * Walk a row's parent chain up to its database container page. A row's parent
   * is either the container `database` page or a parent `row` (sub-item); follow
   * row parents until we hit the container.
   */
  async resolveRowContainer(row: Page): Promise<Page | null> {
    let cursor: string | null = row.parentId;
    const seen = new Set<string>([row.id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const parent: Page | null = await this.prisma.page.findUnique({
        where: { id: cursor },
      });
      if (!parent) return null;
      if (parent.type === "database") return parent;
      cursor = parent.parentId;
    }
    return null;
  }
}
