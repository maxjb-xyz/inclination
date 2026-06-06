import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Notification type discriminator (spec §5). Comments produce `mention` and
 * `comment_reply`; T3 sharing adds `share`; Phase-1 invites add `invite`. New
 * types can be passed freely — the column is a plain string.
 */
export type NotificationType = "mention" | "comment_reply" | "share" | "invite";

/** A single notification to persist. `sourceRef` points at the originating entity. */
export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType | string;
  sourceRef: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one notification. Injectable + simple so Comments (mention/reply),
   * T3 sharing (share grants) and Phase-1 invites can all reuse it.
   */
  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        sourceRef: input.sourceRef as Prisma.InputJsonValue,
      },
    });
  }

  /** Persist many notifications at once (mention/reply fan-out). Skips empties. */
  async createMany(inputs: CreateNotificationInput[]) {
    if (inputs.length === 0) return { count: 0 };
    return this.prisma.notification.createMany({
      data: inputs.map((i) => ({
        recipientId: i.recipientId,
        type: i.type,
        sourceRef: i.sourceRef as Prisma.InputJsonValue,
      })),
    });
  }

  /**
   * The current user's notifications, newest first, bounded. Where a
   * `sourceRef.pageId` is present and cheap to resolve, we attach a small
   * `preview` ({ pageTitle }); failures to resolve are silently omitted.
   */
  async list(userId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: "desc" },
      take,
    });

    // Resolve page titles for refs that carry a pageId, in one query.
    const pageIds = Array.from(
      new Set(
        rows
          .map((r) => (r.sourceRef as { pageId?: unknown } | null)?.pageId)
          .filter((id): id is string => typeof id === "string"),
      ),
    );
    const titles = new Map<string, string>();
    if (pageIds.length) {
      const pages = await this.prisma.page.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, title: true },
      });
      for (const p of pages) titles.set(p.id, p.title);
    }

    return rows.map((r) => {
      const ref = (r.sourceRef as { pageId?: unknown } | null) ?? {};
      const pageId = typeof ref.pageId === "string" ? ref.pageId : null;
      const preview = pageId && titles.has(pageId) ? { pageTitle: titles.get(pageId)! } : null;
      return { ...r, preview };
    });
  }

  /** Count of the current user's unread notifications. */
  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { recipientId: userId, readAt: null },
    });
    return { count };
  }

  /** Mark one notification read. 404 if missing, 403 if it isn't the caller's. */
  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException("Notification not found");
    if (notification.recipientId !== userId) {
      throw new ForbiddenException("Not your notification");
    }
    if (notification.readAt) return notification;
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  /** Mark all of the caller's unread notifications read. */
  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}
