import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  validateCellValue,
  isComputed,
  CellValidationError,
  type CellValue,
} from "@inclination/db-engine";
import type {
  CreateRowInput,
  PropertyType,
  RelationLinkInput,
  SetCellInput,
} from "@inclination/shared";
import type { Prisma } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { DatabaseAccessService } from "./database-access.service";
import { DatabaseEventsService } from "./database-events.service";
import { computeSortKey } from "../pages/sort-key";

/**
 * Row, cell and relation operations.
 *
 * A row is a `Page` of type `row` whose parent is the database container page
 * (or a parent row for sub-items), so a row can also be opened as a full page.
 * Cells are stored per (rowPage, property); computed types are never set
 * directly. Relations are bidirectional and maintained as a pair in a
 * transaction.
 */
@Injectable()
export class RowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DatabaseAccessService,
    private readonly events: DatabaseEventsService,
  ) {}

  private async siblings(parentId: string) {
    return this.prisma.page.findMany({
      where: { parentId },
      select: { id: true, sortKey: true },
    });
  }

  /**
   * Create a row under a database (or under a parent row for a sub-item). The
   * row's `title` mirrors the primary cell where applicable; we store the given
   * title on the Page so it can be opened as a full page.
   */
  async create(userId: string, databaseId: string, input: CreateRowInput) {
    const { database, page: container } = await this.access.requireDatabase(
      userId,
      databaseId,
    );

    let parentId = container.id;
    if (input.parentRowId) {
      // Sub-item: parent must be a row of THIS database.
      const { row: parentRow } = await this.access.requireRow(userId, input.parentRowId);
      const parentContainer = await this.access.resolveRowContainer(parentRow);
      if (!parentContainer || parentContainer.id !== databaseId) {
        throw new BadRequestException("parentRowId is not a row of this database");
      }
      parentId = parentRow.id;
    }

    const sortKey = computeSortKey(await this.siblings(parentId));
    const row = await this.prisma.page.create({
      data: {
        workspaceId: container.workspaceId,
        parentId,
        type: "row",
        title: input.title ?? "",
        sortKey,
        createdById: userId,
        editedById: userId,
      },
    });

    this.events.emit({
      databaseId,
      type: "row.created",
      actorId: userId,
      payload: { rowPageId: row.id, parentRowId: input.parentRowId ?? null },
    });
    void database;
    return row;
  }

  /** List the (non-archived) rows under a database (top-level + sub-items). */
  async list(userId: string, databaseId: string) {
    await this.access.requireDatabase(userId, databaseId);
    // Top-level rows parent the container; sub-items parent another row. Collect
    // the whole row subtree under the container.
    const rows: { id: string; parentId: string | null; title: string; sortKey: string }[] = [];
    let frontier = [databaseId];
    const seen = new Set<string>();
    while (frontier.length > 0) {
      const children = await this.prisma.page.findMany({
        where: { parentId: { in: frontier }, type: "row", archivedAt: null },
        select: { id: true, parentId: true, title: true, sortKey: true },
        orderBy: { sortKey: "asc" },
      });
      const next: string[] = [];
      for (const c of children) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        rows.push(c);
        next.push(c.id);
      }
      frontier = next;
    }
    return rows;
  }

  /**
   * Set (LWW) a cell value. Rejects computed types, validates the value per type
   * via the engine (400 on invalid), upserts the Cell, and bumps the row Page's
   * `editedBy`/`updatedAt` so last_edited_* recompute.
   */
  async setCell(userId: string, rowPageId: string, input: SetCellInput) {
    const { row, database } = await this.access.requireRow(userId, rowPageId);

    const property = await this.prisma.property.findUnique({
      where: { id: input.propertyId },
    });
    if (!property || property.databaseId !== database.pageId) {
      throw new BadRequestException("propertyId is not a property of this row's database");
    }
    const type = property.type as PropertyType;
    if (isComputed(type)) {
      throw new BadRequestException(`property type "${type}" is computed and cannot be set`);
    }
    if (type === "relation") {
      throw new BadRequestException(
        "relation values are managed via relation links, not set as a cell",
      );
    }

    let normalized: CellValue;
    try {
      normalized = validateCellValue(type, property.config, input.value);
    } catch (err) {
      if (err instanceof CellValidationError) throw new BadRequestException(err.message);
      throw err;
    }

    await this.prisma.$transaction(async (tx) => {
      if (normalized === null) {
        await tx.cell.deleteMany({ where: { rowPageId, propertyId: input.propertyId } });
      } else {
        await tx.cell.upsert({
          where: { rowPageId_propertyId: { rowPageId, propertyId: input.propertyId } },
          create: {
            rowPageId,
            propertyId: input.propertyId,
            value: normalized as Prisma.InputJsonValue,
          },
          update: { value: normalized as Prisma.InputJsonValue },
        });
      }
      // Keep the row Page title in sync with the primary cell so the row opens
      // as a page with a sensible title.
      const pageData: Prisma.PageUpdateInput = { editedById: userId };
      if (property.isPrimary) {
        pageData.title = typeof normalized === "string" ? normalized : "";
      }
      await tx.page.update({ where: { id: rowPageId }, data: pageData });
    });

    this.events.emit({
      databaseId: database.pageId,
      type: "cell.updated",
      actorId: userId,
      payload: { rowPageId, propertyId: input.propertyId, value: normalized },
    });
    void row;
    return { rowPageId, propertyId: input.propertyId, value: normalized };
  }

  /**
   * Link two rows through a relation property. Maintains the two-way mirror (the
   * paired property's reverse edge) in one transaction. Idempotent.
   */
  async link(userId: string, propertyId: string, input: RelationLinkInput) {
    const { property, database } = await this.resolveRelationProperty(userId, propertyId, input);

    await this.prisma.$transaction(async (tx) => {
      await tx.relationLink.upsert({
        where: {
          propertyId_fromRowId_toRowId: {
            propertyId,
            fromRowId: input.fromRowId,
            toRowId: input.toRowId,
          },
        },
        create: { propertyId, fromRowId: input.fromRowId, toRowId: input.toRowId },
        update: {},
      });
      const pairedId = (property.config as { pairedPropertyId?: string }).pairedPropertyId;
      if (pairedId) {
        await tx.relationLink.upsert({
          where: {
            propertyId_fromRowId_toRowId: {
              propertyId: pairedId,
              fromRowId: input.toRowId,
              toRowId: input.fromRowId,
            },
          },
          create: { propertyId: pairedId, fromRowId: input.toRowId, toRowId: input.fromRowId },
          update: {},
        });
      }
    });

    this.events.emit({
      databaseId: database.pageId,
      type: "relation.linked",
      actorId: userId,
      payload: { propertyId, fromRowId: input.fromRowId, toRowId: input.toRowId },
    });
    return { linked: true };
  }

  /** Unlink two rows, removing both directions of the pair. */
  async unlink(userId: string, propertyId: string, input: RelationLinkInput) {
    const { property, database } = await this.resolveRelationProperty(userId, propertyId, input);

    await this.prisma.$transaction(async (tx) => {
      await tx.relationLink.deleteMany({
        where: { propertyId, fromRowId: input.fromRowId, toRowId: input.toRowId },
      });
      const pairedId = (property.config as { pairedPropertyId?: string }).pairedPropertyId;
      if (pairedId) {
        await tx.relationLink.deleteMany({
          where: { propertyId: pairedId, fromRowId: input.toRowId, toRowId: input.fromRowId },
        });
      }
    });

    this.events.emit({
      databaseId: database.pageId,
      type: "relation.unlinked",
      actorId: userId,
      payload: { propertyId, fromRowId: input.fromRowId, toRowId: input.toRowId },
    });
    return { unlinked: true };
  }

  /**
   * Validate that `propertyId` is a relation property the caller can access and
   * that both endpoint rows are valid rows the caller can access (no IDOR), and
   * that the `to` row belongs to the relation's target database.
   */
  private async resolveRelationProperty(
    userId: string,
    propertyId: string,
    input: RelationLinkInput,
  ) {
    const { property, database } = await this.access.requireProperty(userId, propertyId);
    if (property.type !== "relation") {
      throw new BadRequestException("propertyId is not a relation property");
    }
    // The `from` row must be a row of this property's database.
    const { row: fromRow } = await this.access.requireRow(userId, input.fromRowId);
    const fromContainer = await this.access.resolveRowContainer(fromRow);
    if (!fromContainer || fromContainer.id !== database.pageId) {
      throw new BadRequestException("fromRowId is not a row of this property's database");
    }
    // The `to` row must be a row of the relation target database (caller must
    // also be able to access it → requireRow authorizes via its container).
    const target = (property.config as { targetDatabaseId?: string }).targetDatabaseId;
    const { row: toRow } = await this.access.requireRow(userId, input.toRowId);
    const toContainer = await this.access.resolveRowContainer(toRow);
    if (!toContainer || (target && toContainer.id !== target)) {
      throw new BadRequestException("toRowId is not a row of the relation target database");
    }
    void fromRow;
    void toRow;
    return { property, database };
  }
}
