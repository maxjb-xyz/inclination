import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreatePageInput,
  MovePageInput,
  SaveContentInput,
  UpdatePageInput,
} from "@inclination/shared";
import type { Page, Prisma } from "@inclination/db";
import { resolvePageAccess } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { computeSortKey, type SortableSibling } from "./sort-key";

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Loads a page or throws 404. */
  private async loadPage(id: string): Promise<Page> {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException("Page not found");
    return page;
  }

  /**
   * Loads the page (404 if missing) and asserts the caller may access it, using
   * the SAME shared resolver the sync server uses (spec §9) so API and sync
   * authorization cannot drift. `resolvePageAccess` returns null for both a
   * missing page and a non-member; since `loadPage` already 404s on a missing
   * page, a null here means "not a member" → 403 (preserving prior behavior).
   */
  private async requirePageAccess(userId: string, id: string): Promise<Page> {
    const page = await this.loadPage(id);
    const access = await resolvePageAccess(this.prisma, userId, id);
    if (!access) {
      throw new ForbiddenException("You are not a member of this workspace");
    }
    return page;
  }

  /** Returns the sortable siblings under a parent (or workspace root), excluding `excludeId`. */
  private async siblings(
    workspaceId: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<SortableSibling[]> {
    const rows = await this.prisma.page.findMany({
      where: {
        workspaceId,
        parentId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, sortKey: true },
    });
    return rows;
  }

  async create(userId: string, workspaceId: string, input: CreatePageInput) {
    await this.workspaces.requireMember(userId, workspaceId);

    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await this.loadPage(parentId);
      if (parent.workspaceId !== workspaceId) {
        throw new BadRequestException("Parent page is in a different workspace");
      }
    }

    const sortKey = computeSortKey(await this.siblings(workspaceId, parentId));

    return this.prisma.page.create({
      data: {
        workspaceId,
        parentId,
        type: input.type ?? "document",
        title: input.title ?? "",
        icon: input.icon,
        sortKey,
        createdById: userId,
        editedById: userId,
      },
    });
  }

  /** Flat list of non-archived pages for the sidebar; client builds the tree. */
  async listTree(userId: string, workspaceId: string) {
    await this.workspaces.requireMember(userId, workspaceId);
    return this.prisma.page.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ parentId: "asc" }, { sortKey: "asc" }],
    });
  }

  /** Archived pages for the trash view. */
  async listTrash(userId: string, workspaceId: string) {
    await this.workspaces.requireMember(userId, workspaceId);
    return this.prisma.page.findMany({
      where: { workspaceId, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
    });
  }

  /** Page meta plus its ancestor chain (root first), for breadcrumbs. */
  async get(userId: string, id: string) {
    const page = await this.requirePageAccess(userId, id);
    const breadcrumbs: Page[] = [];
    let cursor: string | null = page.parentId;
    const seen = new Set<string>([page.id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const ancestor: Page | null = await this.prisma.page.findUnique({ where: { id: cursor } });
      if (!ancestor) break;
      breadcrumbs.unshift(ancestor);
      cursor = ancestor.parentId;
    }
    return { page, breadcrumbs };
  }

  async update(userId: string, id: string, input: UpdatePageInput) {
    await this.requirePageAccess(userId, id);
    return this.prisma.page.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.cover !== undefined ? { cover: input.cover } : {}),
        editedById: userId,
      },
    });
  }

  /** True if `candidateAncestorId` is `pageId` or any of its descendants. */
  private async isSelfOrDescendant(pageId: string, candidateAncestorId: string): Promise<boolean> {
    if (pageId === candidateAncestorId) return true;
    // Walk up from the candidate target parent; if we reach `pageId`, it's a cycle.
    let cursor: string | null = candidateAncestorId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === pageId) return true;
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const node: { parentId: string | null } | null = await this.prisma.page.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = node?.parentId ?? null;
    }
    return false;
  }

  async move(userId: string, id: string, input: MovePageInput) {
    const page = await this.requirePageAccess(userId, id);
    const newParentId = input.parentId !== undefined ? input.parentId : page.parentId;

    if (newParentId) {
      const parent = await this.loadPage(newParentId);
      if (parent.workspaceId !== page.workspaceId) {
        throw new BadRequestException("Target parent is in a different workspace");
      }
      // Cycle guard: cannot move a page under itself or one of its descendants.
      if (await this.isSelfOrDescendant(page.id, newParentId)) {
        throw new ConflictException("Cannot move a page under itself or a descendant");
      }
    }

    const siblings = await this.siblings(page.workspaceId, newParentId, page.id);
    let sortKey: string;
    try {
      sortKey = computeSortKey(siblings, input.beforeId, input.afterId);
    } catch {
      throw new BadRequestException("beforeId/afterId is not a sibling of the target parent");
    }

    return this.prisma.page.update({
      where: { id },
      data: { parentId: newParentId, sortKey, editedById: userId },
    });
  }

  /** Collects the ids of a page and all of its descendants (BFS). */
  private async subtreeIds(rootId: string): Promise<string[]> {
    const ids: string[] = [rootId];
    let frontier: string[] = [rootId];
    while (frontier.length > 0) {
      const children = await this.prisma.page.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      const next = children.map((c) => c.id);
      ids.push(...next);
      frontier = next;
    }
    return ids;
  }

  /** Soft-delete: archive the page and cascade archived state to all descendants. */
  async archive(userId: string, id: string) {
    const page = await this.requirePageAccess(userId, id);
    const ids = await this.subtreeIds(page.id);
    const now = new Date();
    await this.prisma.page.updateMany({
      where: { id: { in: ids }, archivedAt: null },
      data: { archivedAt: now },
    });
    return { archived: ids.length };
  }

  /** Restore: clear archivedAt on the page, its descendants, and any archived ancestors. */
  async restore(userId: string, id: string) {
    const page = await this.requirePageAccess(userId, id);
    const ids = await this.subtreeIds(page.id);

    // Un-archive archived ancestors so the restored page is reachable in the tree.
    let cursor: string | null = page.parentId;
    const seen = new Set<string>([page.id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const ancestor: Page | null = await this.prisma.page.findUnique({ where: { id: cursor } });
      if (!ancestor) break;
      if (ancestor.archivedAt) ids.push(ancestor.id);
      cursor = ancestor.parentId;
    }

    await this.prisma.page.updateMany({
      where: { id: { in: ids } },
      data: { archivedAt: null },
    });
    return { restored: ids.length };
  }

  async getContent(userId: string, id: string) {
    await this.requirePageAccess(userId, id);
    const content = await this.prisma.pageContent.findUnique({ where: { pageId: id } });
    return { doc: content?.doc ?? {}, updatedAt: content?.updatedAt ?? null };
  }

  async saveContent(userId: string, id: string, input: SaveContentInput) {
    await this.requirePageAccess(userId, id);
    const doc = input.doc as Prisma.InputJsonValue;
    const content = await this.prisma.pageContent.upsert({
      where: { pageId: id },
      create: { pageId: id, doc },
      update: { doc },
    });
    await this.prisma.page.update({ where: { id }, data: { editedById: userId } });
    return { doc: content.doc, updatedAt: content.updatedAt };
  }
}
