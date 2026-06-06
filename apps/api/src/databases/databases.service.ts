import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateDatabaseInput,
  UpdateDatabaseInput,
} from "@inclination/shared";
import type { Prisma } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DatabaseAccessService } from "./database-access.service";
import { DatabaseEventsService } from "./database-events.service";
import { computeSortKey } from "../pages/sort-key";

/**
 * Database container lifecycle: create a new database (a Page of type
 * `database` + a Database row + a default Table view + a primary `text` "Name"
 * property), convert an existing page into a database, and update database-level
 * settings (default view, sub-items).
 */
@Injectable()
export class DatabasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly access: DatabaseAccessService,
    private readonly events: DatabaseEventsService,
  ) {}

  /** Sortable siblings under a parent (for the container page's sortKey). */
  private async siblings(workspaceId: string, parentId: string | null) {
    return this.prisma.page.findMany({
      where: { workspaceId, parentId },
      select: { id: true, sortKey: true },
    });
  }

  /**
   * Create a brand-new database. Creates the container Page, the Database row, a
   * primary `text` "Name" property and a default Table view, all in one
   * transaction. The default view is set as the database's `defaultViewId`.
   */
  async create(userId: string, workspaceId: string, input: CreateDatabaseInput) {
    await this.workspaces.requireMember(userId, workspaceId);

    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await this.prisma.page.findUnique({ where: { id: parentId } });
      if (!parent) throw new NotFoundException("Parent page not found");
      if (parent.workspaceId !== workspaceId) {
        throw new BadRequestException("Parent page is in a different workspace");
      }
    }

    const sortKey = computeSortKey(await this.siblings(workspaceId, parentId));

    const result = await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.create({
        data: {
          workspaceId,
          parentId,
          type: "database",
          title: input.title ?? "",
          sortKey,
          createdById: userId,
          editedById: userId,
        },
      });

      await tx.database.create({ data: { pageId: page.id } });

      const primary = await tx.property.create({
        data: {
          databaseId: page.id,
          name: "Name",
          type: "text",
          config: {},
          order: 0,
          isPrimary: true,
        },
      });

      const view = await tx.view.create({
        data: {
          databaseId: page.id,
          type: "table",
          name: "Table",
          order: 0,
          config: { visibleProperties: [primary.id] } as Prisma.InputJsonValue,
        },
      });

      const database = await tx.database.update({
        where: { pageId: page.id },
        data: { defaultViewId: view.id },
      });

      return { page, database, primary, view };
    });

    return {
      ...result.database,
      page: result.page,
      properties: [result.primary],
      views: [result.view],
    };
  }

  /**
   * Convert an existing (document) page into a database: attaches a Database row,
   * a primary `text` "Name" property and a default Table view. The page's own
   * children are untouched (they remain document children, not rows).
   */
  async convert(userId: string, pageId: string) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException("Page not found");
    // Authorize via the shared resolver before mutating.
    await this.workspaces.requireMember(userId, page.workspaceId);

    if (page.type === "database") {
      throw new ConflictException("Page is already a database");
    }
    if (page.type === "row") {
      throw new BadRequestException("A row page cannot be converted into a database");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const container = await tx.page.update({
        where: { id: pageId },
        data: { type: "database", editedById: userId },
      });
      await tx.database.create({ data: { pageId } });
      const primary = await tx.property.create({
        data: {
          databaseId: pageId,
          name: "Name",
          type: "text",
          config: {},
          order: 0,
          isPrimary: true,
        },
      });
      const view = await tx.view.create({
        data: {
          databaseId: pageId,
          type: "table",
          name: "Table",
          order: 0,
          config: { visibleProperties: [primary.id] } as Prisma.InputJsonValue,
        },
      });
      const database = await tx.database.update({
        where: { pageId },
        data: { defaultViewId: view.id },
      });
      return { container, database, primary, view };
    });

    return {
      ...result.database,
      page: result.container,
      properties: [result.primary],
      views: [result.view],
    };
  }

  /** Full database with properties (ordered) and views (ordered). */
  async get(userId: string, databaseId: string) {
    const { database, page } = await this.access.requireDatabase(userId, databaseId);
    const [properties, views] = await Promise.all([
      this.prisma.property.findMany({
        where: { databaseId },
        orderBy: { order: "asc" },
      }),
      this.prisma.view.findMany({
        where: { databaseId },
        orderBy: { order: "asc" },
      }),
    ]);
    return { ...database, page, properties, views };
  }

  /** Update database-level settings: default view, sub-items config. */
  async update(userId: string, databaseId: string, input: UpdateDatabaseInput) {
    const { database } = await this.access.requireDatabase(userId, databaseId, "write");

    if (input.defaultViewId) {
      const view = await this.prisma.view.findUnique({
        where: { id: input.defaultViewId },
      });
      if (!view || view.databaseId !== databaseId) {
        throw new BadRequestException("defaultViewId is not a view of this database");
      }
    }
    if (input.subitemsPropertyId) {
      const prop = await this.prisma.property.findUnique({
        where: { id: input.subitemsPropertyId },
      });
      if (!prop || prop.databaseId !== databaseId || prop.type !== "relation") {
        throw new BadRequestException(
          "subitemsPropertyId must be a relation property of this database",
        );
      }
    }

    const updated = await this.prisma.database.update({
      where: { pageId: databaseId },
      data: {
        ...(input.defaultViewId !== undefined ? { defaultViewId: input.defaultViewId } : {}),
        ...(input.subitemsEnabled !== undefined ? { subitemsEnabled: input.subitemsEnabled } : {}),
        ...(input.subitemsPropertyId !== undefined
          ? { subitemsPropertyId: input.subitemsPropertyId }
          : {}),
      },
    });

    this.events.emit({
      databaseId,
      type: "database.updated",
      actorId: userId,
      payload: { databaseId },
    });
    void database;
    return updated;
  }
}
