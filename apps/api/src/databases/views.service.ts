import { Injectable } from "@nestjs/common";
import type { CreateViewInput, UpdateViewInput } from "@inclination/shared";
import type { Prisma } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { DatabaseAccessService } from "./database-access.service";
import { DatabaseEventsService } from "./database-events.service";

/**
 * View CRUD. A view carries its `config` (visible properties, filter tree,
 * sorts, groupBy, dateProperty, gallery, pageSize) validated structurally by the
 * shared Zod schema at the controller edge.
 */
@Injectable()
export class ViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DatabaseAccessService,
    private readonly events: DatabaseEventsService,
  ) {}

  private async nextOrder(databaseId: string): Promise<number> {
    const max = await this.prisma.view.aggregate({
      where: { databaseId },
      _max: { order: true },
    });
    return (max._max.order ?? -1) + 1;
  }

  async create(userId: string, databaseId: string, input: CreateViewInput) {
    await this.access.requireDatabase(userId, databaseId, "write");
    const order = input.order ?? (await this.nextOrder(databaseId));
    const view = await this.prisma.view.create({
      data: {
        databaseId,
        type: input.type,
        name: input.name,
        order,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
      },
    });
    this.events.emit({
      databaseId,
      type: "view.created",
      actorId: userId,
      payload: { viewId: view.id },
    });
    return view;
  }

  async update(userId: string, viewId: string, input: UpdateViewInput) {
    const { view, database } = await this.access.requireView(userId, viewId, "write");
    const updated = await this.prisma.view.update({
      where: { id: viewId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.config !== undefined
          ? { config: input.config as Prisma.InputJsonValue }
          : {}),
      },
    });
    this.events.emit({
      databaseId: database.pageId,
      type: "view.updated",
      actorId: userId,
      payload: { viewId },
    });
    void view;
    return updated;
  }

  async remove(userId: string, viewId: string) {
    const { view, database } = await this.access.requireView(userId, viewId, "write");
    await this.prisma.$transaction(async (tx) => {
      await tx.view.delete({ where: { id: viewId } });
      // Clear defaultViewId if it pointed at the deleted view.
      if (database.defaultViewId === viewId) {
        const fallback = await tx.view.findFirst({
          where: { databaseId: database.pageId },
          orderBy: { order: "asc" },
        });
        await tx.database.update({
          where: { pageId: database.pageId },
          data: { defaultViewId: fallback?.id ?? null },
        });
      }
    });
    this.events.emit({
      databaseId: database.pageId,
      type: "view.deleted",
      actorId: userId,
      payload: { viewId },
    });
    void view;
    return { deleted: true };
  }

  /** Set the database's default view (must belong to the database). */
  async setDefault(userId: string, viewId: string) {
    const { view, database } = await this.access.requireView(userId, viewId, "write");
    await this.prisma.database.update({
      where: { pageId: database.pageId },
      data: { defaultViewId: view.id },
    });
    this.events.emit({
      databaseId: database.pageId,
      type: "database.updated",
      actorId: userId,
      payload: { defaultViewId: viewId },
    });
    return { defaultViewId: viewId };
  }
}
