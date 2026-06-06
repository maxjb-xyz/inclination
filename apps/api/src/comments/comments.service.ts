import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateCommentInput } from "@inclination/shared";
import type { Comment, Prisma } from "@inclination/db";
import { resolvePageAccess } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { extractMentionedUserIds, replyRecipientIds, type RichTextNode } from "./mentions";
import { resolveThreadId } from "./thread";

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Assert the caller has the requested capability on the page, using the SAME
   * shared resolver the sync server uses (spec §9). Returns the resolved access.
   * `null` from the resolver means missing-page-or-no-access → 403 (we 404 the
   * page separately when needed so callers don't leak existence).
   */
  private async requireAccess(
    userId: string,
    pageId: string,
    capability: "read" | "comment",
  ): Promise<NonNullable<Awaited<ReturnType<typeof resolvePageAccess>>>> {
    const access = await resolvePageAccess(this.prisma, userId, pageId);
    if (!access || !access.canRead) {
      throw new ForbiddenException("You do not have access to this page");
    }
    if (capability === "comment" && !access.canComment) {
      throw new ForbiddenException("You do not have permission to comment on this page");
    }
    return access;
  }

  /**
   * Create a comment on a page (requires `canComment`).
   *
   * - A top-level comment (no `parentCommentId`) starts a new thread: its
   *   `threadId` is set to its own id (two-step: create, then self-set).
   * - A reply inherits the parent's `threadId`; the parent must belong to the
   *   same page.
   * - After persisting, fan out notifications:
   *   - `mention`: every user `@`-mentioned in the body who still has access to
   *     the page (resolvePageAccess !== null), excluding the author.
   *   - `comment_reply` (replies only): the thread-root author + distinct prior
   *     participants who still have access, excluding the replier.
   */
  async create(userId: string, pageId: string, input: CreateCommentInput): Promise<Comment> {
    await this.requireAccess(userId, pageId, "comment");

    let parent: Comment | null = null;
    if (input.parentCommentId) {
      parent = await this.prisma.comment.findUnique({ where: { id: input.parentCommentId } });
      if (!parent) throw new NotFoundException("Parent comment not found");
      if (parent.pageId !== pageId) {
        throw new BadRequestException("Parent comment belongs to a different page");
      }
    }

    const body = input.body as Prisma.InputJsonValue;
    const blockAnchor =
      input.blockAnchor !== undefined ? (input.blockAnchor as Prisma.InputJsonValue) : undefined;

    let comment: Comment;
    if (parent) {
      comment = await this.prisma.comment.create({
        data: {
          pageId,
          authorId: userId,
          body,
          ...(blockAnchor !== undefined ? { blockAnchor } : {}),
          threadId: parent.threadId,
          parentCommentId: parent.id,
        },
      });
    } else {
      // Top-level: create then set threadId = its own id so the root anchors the
      // thread (resolveThreadId(id, null) === id).
      const created = await this.prisma.comment.create({
        data: {
          pageId,
          authorId: userId,
          body,
          ...(blockAnchor !== undefined ? { blockAnchor } : {}),
          threadId: "", // placeholder; replaced immediately below
        },
      });
      comment = await this.prisma.comment.update({
        where: { id: created.id },
        data: { threadId: resolveThreadId(created.id, null) },
      });
    }

    await this.fanOutNotifications(userId, pageId, comment, parent);
    return comment;
  }

  /** Create mention + comment_reply notifications for a freshly-created comment. */
  private async fanOutNotifications(
    authorId: string,
    pageId: string,
    comment: Comment,
    parent: Comment | null,
  ): Promise<void> {
    // Candidate recipients: mentions (always) + reply participants (replies).
    const mentioned = extractMentionedUserIds(comment.body as RichTextNode);

    let replyTargets: string[] = [];
    if (parent) {
      const threadComments = await this.prisma.comment.findMany({
        where: { threadId: comment.threadId, id: { not: comment.id } },
        select: { authorId: true, parentCommentId: true, id: true, threadId: true },
        orderBy: { createdAt: "asc" },
      });
      // The root author is the author of the comment whose id === threadId.
      const root = threadComments.find((c) => c.id === comment.threadId);
      const rootAuthorId = root?.authorId ?? parent.authorId;
      const priorAuthors = threadComments.map((c) => c.authorId);
      replyTargets = replyRecipientIds(authorId, rootAuthorId, priorAuthors);
    }

    // Dedupe: a user mentioned in a reply gets a single `mention` (takes
    // precedence over the reply notification for them).
    const mentionSet = new Set(mentioned);
    const candidates: { recipientId: string; type: "mention" | "comment_reply" }[] = [];
    for (const id of mentioned) {
      if (id === authorId) continue;
      candidates.push({ recipientId: id, type: "mention" });
    }
    for (const id of replyTargets) {
      if (id === authorId || mentionSet.has(id)) continue;
      candidates.push({ recipientId: id, type: "comment_reply" });
    }
    if (candidates.length === 0) return;

    // Only notify users who still have access to the page.
    const allowed = await this.filterByPageAccess(
      candidates.map((c) => c.recipientId),
      pageId,
    );

    const sourceRef = { pageId, commentId: comment.id, threadId: comment.threadId };
    const toCreate = candidates
      .filter((c) => allowed.has(c.recipientId))
      .map((c) => ({ recipientId: c.recipientId, type: c.type, sourceRef }));

    await this.notifications.createMany(toCreate);
  }

  /** Subset of `userIds` that currently have (any) access to the page. */
  private async filterByPageAccess(userIds: string[], pageId: string): Promise<Set<string>> {
    const allowed = new Set<string>();
    for (const id of new Set(userIds)) {
      const access = await resolvePageAccess(this.prisma, id, pageId);
      if (access) allowed.add(id);
    }
    return allowed;
  }

  /**
   * List a page's comments (requires `canRead`). Returns a flat list ordered by
   * creation time, each enriched with its `author` ({ id, displayName,
   * avatarUrl }). Each row carries `threadId`, `parentCommentId` and
   * `resolvedAt` so the client can group into threads; `blockAnchor` is present
   * for inline-anchored comments.
   */
  async list(userId: string, pageId: string) {
    await this.requireAccess(userId, pageId, "read");
    const comments = await this.prisma.comment.findMany({
      where: { pageId },
      orderBy: { createdAt: "asc" },
    });

    const authorIds = Array.from(new Set(comments.map((c) => c.authorId)));
    const authors = authorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(authors.map((a) => [a.id, a]));

    return comments.map((c) => ({
      ...c,
      author: byId.get(c.authorId) ?? null,
    }));
  }

  /** Load a comment or 404. */
  private async loadComment(id: string): Promise<Comment> {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException("Comment not found");
    return comment;
  }

  /**
   * Resolve the whole THREAD the given comment belongs to (requires
   * `canComment`): stamp `resolvedAt` on every comment sharing its `threadId`.
   * Idempotent.
   */
  async resolve(userId: string, commentId: string) {
    const comment = await this.loadComment(commentId);
    await this.requireAccess(userId, comment.pageId, "comment");
    const now = new Date();
    const res = await this.prisma.comment.updateMany({
      where: { threadId: comment.threadId },
      data: { resolvedAt: now },
    });
    return { resolved: res.count, resolvedAt: now, threadId: comment.threadId };
  }

  /** Clear `resolvedAt` on the whole thread (requires `canComment`). */
  async unresolve(userId: string, commentId: string) {
    const comment = await this.loadComment(commentId);
    await this.requireAccess(userId, comment.pageId, "comment");
    const res = await this.prisma.comment.updateMany({
      where: { threadId: comment.threadId },
      data: { resolvedAt: null },
    });
    return { unresolved: res.count, threadId: comment.threadId };
  }

  /**
   * Delete a comment. Permitted to the comment's author, or to anyone with
   * `canWrite`/`canShare` on the page (moderation). Deleting a thread root does
   * not cascade replies here — only the single comment is removed.
   */
  async remove(userId: string, commentId: string) {
    const comment = await this.loadComment(commentId);
    const access = await resolvePageAccess(this.prisma, userId, comment.pageId);
    if (!access || !access.canRead) {
      throw new ForbiddenException("You do not have access to this page");
    }
    const isAuthor = comment.authorId === userId;
    if (!isAuthor && !access.canWrite && !access.canShare) {
      throw new ForbiddenException("You cannot delete this comment");
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
    return { deleted: 1, id: commentId };
  }
}
