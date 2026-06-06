import { BadRequestException, Injectable } from "@nestjs/common";
import {
  parsePropertyConfig,
  type CreatePropertyInput,
  type PropertyType,
  type ReorderPropertiesInput,
  type RelationConfig,
  type UpdatePropertyInput,
} from "@inclination/shared";
import type { Prisma, Property } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { DatabaseAccessService } from "./database-access.service";
import { DatabaseEventsService } from "./database-events.service";

/**
 * Property (column) CRUD. Validates per-type `config` via the shared Zod
 * schemas, enforces exactly one primary property, and — for `relation`
 * properties — maintains the two-way mirror property on the target database.
 */
@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DatabaseAccessService,
    private readonly events: DatabaseEventsService,
  ) {}

  private assertConfig(type: PropertyType, config: unknown) {
    const result = parsePropertyConfig(type, config);
    if (!result.success) {
      throw new BadRequestException(`Invalid config for property type "${type}"`);
    }
    return result.data;
  }

  private async nextOrder(databaseId: string): Promise<number> {
    const max = await this.prisma.property.aggregate({
      where: { databaseId },
      _max: { order: true },
    });
    return (max._max.order ?? -1) + 1;
  }

  /**
   * Create a property. For a `relation` property, also create (or point at) the
   * paired mirror property on the target database so links are two-way, all in
   * one transaction.
   */
  async create(userId: string, databaseId: string, input: CreatePropertyInput) {
    const { database } = await this.access.requireDatabase(userId, databaseId);
    const config = this.assertConfig(input.type, input.config);

    // Relation target validation + paired-property resolution.
    if (input.type === "relation") {
      const relCfg = config as RelationConfig;
      const target = await this.prisma.database.findUnique({
        where: { pageId: relCfg.targetDatabaseId },
      });
      if (!target) {
        throw new BadRequestException("relation targetDatabaseId is not a database");
      }
      // The caller must be able to access the target database too.
      await this.access.requireDatabase(userId, relCfg.targetDatabaseId);
    }

    const order = input.order ?? (await this.nextOrder(databaseId));

    const created = await this.prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          databaseId,
          name: input.name,
          type: input.type,
          config: (config ?? {}) as Prisma.InputJsonValue,
          order,
          isPrimary: input.isPrimary ?? false,
        },
      });

      if (input.isPrimary) {
        await tx.property.updateMany({
          where: { databaseId, id: { not: property.id } },
          data: { isPrimary: false },
        });
      }

      if (input.type === "relation") {
        await this.wireRelationPair(tx, property, config as RelationConfig, databaseId);
      }

      return property;
    });

    const fresh = await this.prisma.property.findUnique({ where: { id: created.id } });
    this.events.emit({
      databaseId,
      type: "property.created",
      actorId: userId,
      payload: { propertyId: created.id },
    });
    void database;
    return fresh;
  }

  /**
   * Wire up the two-way relation mirror. If `pairedPropertyId` is given and valid
   * on the target database, point both at each other. Otherwise create a mirror
   * relation property on the target database pointing back at this database, and
   * link the pair.
   */
  private async wireRelationPair(
    tx: Prisma.TransactionClient,
    property: Property,
    relCfg: RelationConfig,
    databaseId: string,
  ): Promise<void> {
    const targetDbId = relCfg.targetDatabaseId;

    if (relCfg.pairedPropertyId) {
      const paired = await tx.property.findUnique({
        where: { id: relCfg.pairedPropertyId },
      });
      if (!paired || paired.databaseId !== targetDbId || paired.type !== "relation") {
        throw new BadRequestException(
          "pairedPropertyId must be a relation property on the target database",
        );
      }
      // Link both sides to each other.
      await tx.property.update({
        where: { id: paired.id },
        data: {
          config: {
            ...(paired.config as object),
            targetDatabaseId: databaseId,
            pairedPropertyId: property.id,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.property.update({
        where: { id: property.id },
        data: {
          config: { ...relCfg, pairedPropertyId: paired.id } as Prisma.InputJsonValue,
        },
      });
      return;
    }

    // No paired id: create a mirror property on the target database.
    const order = (
      await tx.property.aggregate({
        where: { databaseId: targetDbId },
        _max: { order: true },
      })
    )._max.order;
    const mirror = await tx.property.create({
      data: {
        databaseId: targetDbId,
        name: "Related",
        type: "relation",
        config: {
          targetDatabaseId: databaseId,
          pairedPropertyId: property.id,
          ...(relCfg.isDependency ? { isDependency: true } : {}),
        } as Prisma.InputJsonValue,
        order: (order ?? -1) + 1,
        isPrimary: false,
      },
    });
    await tx.property.update({
      where: { id: property.id },
      data: {
        config: { ...relCfg, pairedPropertyId: mirror.id } as Prisma.InputJsonValue,
      },
    });
  }

  /** Update a property's name/config/order/isPrimary (type is fixed once set). */
  async update(userId: string, propertyId: string, input: UpdatePropertyInput) {
    const { property, database } = await this.access.requireProperty(userId, propertyId);

    if (input.type !== undefined && input.type !== property.type) {
      throw new BadRequestException(
        "Changing a property's type is not supported; create a new property instead",
      );
    }

    let config: unknown | undefined;
    if (input.config !== undefined) {
      config = this.assertConfig(property.type as PropertyType, input.config);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.property.update({
        where: { id: propertyId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(config !== undefined ? { config: (config ?? {}) as Prisma.InputJsonValue } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        },
      });
      if (input.isPrimary) {
        await tx.property.updateMany({
          where: { databaseId: database.pageId, id: { not: propertyId } },
          data: { isPrimary: false },
        });
      }
      return next;
    });

    this.events.emit({
      databaseId: database.pageId,
      type: "property.updated",
      actorId: userId,
      payload: { propertyId },
    });
    return updated;
  }

  /** Reorder all properties of a database to match the given id sequence. */
  async reorder(userId: string, databaseId: string, input: ReorderPropertiesInput) {
    await this.access.requireDatabase(userId, databaseId);
    const existing = await this.prisma.property.findMany({
      where: { databaseId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((p) => p.id));
    const requested = input.propertyIds;
    if (requested.length !== existing.length || requested.some((id) => !existingIds.has(id))) {
      throw new BadRequestException(
        "propertyIds must be a permutation of this database's property ids",
      );
    }

    await this.prisma.$transaction(
      requested.map((id, index) =>
        this.prisma.property.update({ where: { id }, data: { order: index } }),
      ),
    );

    this.events.emit({
      databaseId,
      type: "property.reordered",
      actorId: userId,
      payload: { propertyIds: requested },
    });
    return this.prisma.property.findMany({
      where: { databaseId },
      orderBy: { order: "asc" },
    });
  }

  /** Delete a property. Cells/relation links cascade. A primary cannot be deleted. */
  async remove(userId: string, propertyId: string) {
    const { property, database } = await this.access.requireProperty(userId, propertyId);
    if (property.isPrimary) {
      throw new BadRequestException("The primary property cannot be deleted");
    }
    await this.prisma.property.delete({ where: { id: propertyId } });
    this.events.emit({
      databaseId: database.pageId,
      type: "property.deleted",
      actorId: userId,
      payload: { propertyId },
    });
    return { deleted: true };
  }
}
