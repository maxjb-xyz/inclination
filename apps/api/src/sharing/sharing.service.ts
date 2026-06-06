import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ShareInviteInput, UpsertPermissionInput } from "@inclination/shared";
import { resolvePageAccess } from "@inclination/db";
import type { Page } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InvitationsService } from "../workspaces/invitations.service";

/**
 * Phase 6 T3 — page sharing / permission grants (spec §5/§6).
 *
 * All authorization goes through the SAME shared `resolvePageAccess` the rest of
 * the API and the sync server use — viewing the grant list requires `canRead`,
 * mutating grants (PUT/DELETE/share-invite) requires `canShare`. No duplicated
 * authz: the resolver is the single source of truth.
 */
@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly invitations: InvitationsService,
  ) {}

  /** Load a page or 404 (used so we never leak existence past the access gate). */
  private async loadPage(pageId: string): Promise<Page> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException("Page not found");
    return page;
  }

  /**
   * Assert the caller may access the page at the requested capability via the
   * shared resolver. `read` is required to view grants; `share` to mutate them.
   * Returns the loaded page so callers know its workspace.
   */
  private async requireAccess(
    userId: string,
    pageId: string,
    capability: "read" | "share",
  ): Promise<Page> {
    const page = await this.loadPage(pageId);
    const access = await resolvePageAccess(this.prisma, userId, pageId);
    if (!access || !access.canRead) {
      throw new ForbiddenException("You do not have access to this page");
    }
    if (capability === "share" && !access.canShare) {
      throw new ForbiddenException("You do not have permission to share this page");
    }
    return page;
  }

  /**
   * List the explicit grants on a page (requires `canRead`), each enriched with
   * subject info: `user` grants get the user's displayName/email/avatar;
   * `workspace` grants get the workspace name. `public` grants (Phase 8) are
   * surfaced as-is. Most-recent first.
   */
  async listPermissions(userId: string, pageId: string) {
    await this.requireAccess(userId, pageId, "read");
    const grants = await this.prisma.permission.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
    });

    const userIds = grants
      .filter((g) => g.subjectType === "user" && g.subjectId)
      .map((g) => g.subjectId as string);
    const workspaceIds = grants
      .filter((g) => g.subjectType === "workspace" && g.subjectId)
      .map((g) => g.subjectId as string);

    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, email: true, avatarUrl: true },
        })
      : [];
    const workspaces = workspaceIds.length
      ? await this.prisma.workspace.findMany({
          where: { id: { in: workspaceIds } },
          select: { id: true, name: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const wsById = new Map(workspaces.map((w) => [w.id, w]));

    return grants.map((g) => {
      const base = {
        id: g.id,
        pageId: g.pageId,
        subjectType: g.subjectType,
        subjectId: g.subjectId,
        role: g.role,
        createdAt: g.createdAt,
      };
      if (g.subjectType === "user" && g.subjectId) {
        const u = userById.get(g.subjectId) ?? null;
        return { ...base, subject: u ? { kind: "user" as const, ...u } : null };
      }
      if (g.subjectType === "workspace" && g.subjectId) {
        const w = wsById.get(g.subjectId) ?? null;
        return {
          ...base,
          subject: w ? { kind: "workspace" as const, id: w.id, name: w.name } : null,
        };
      }
      return { ...base, subject: { kind: "public" as const } };
    });
  }

  /**
   * Upsert a grant on a page (requires `canShare`). Validates the subject exists
   * and belongs to the page's workspace:
   *  - `user`   → must be a WorkspaceMember of the page's workspace.
   *  - `workspace` → must be the page's own workspace.
   * Creates a `share` Notification for a freshly-granted user (skipped on a pure
   * role change to the same subject to avoid notification spam).
   */
  async upsertPermission(userId: string, pageId: string, input: UpsertPermissionInput) {
    const page = await this.requireAccess(userId, pageId, "share");

    if (input.subjectType === "user") {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: input.subjectId } },
      });
      if (!member) {
        throw new BadRequestException("That user is not a member of this workspace");
      }
    } else {
      // subjectType === "workspace": only the page's own workspace may be granted.
      if (input.subjectId !== page.workspaceId) {
        throw new BadRequestException("Can only grant the page's own workspace");
      }
    }

    const existing = await this.prisma.permission.findUnique({
      where: {
        pageId_subjectType_subjectId: {
          pageId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
    });

    const grant = await this.prisma.permission.upsert({
      where: {
        pageId_subjectType_subjectId: {
          pageId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
      create: {
        pageId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        role: input.role,
      },
      update: { role: input.role },
    });

    // Notify a user the first time they are granted access (not on re-grants).
    if (input.subjectType === "user" && !existing && input.subjectId !== userId) {
      await this.notifications.create({
        recipientId: input.subjectId,
        type: "share",
        sourceRef: { pageId, grantedById: userId, role: input.role },
      });
    }

    return grant;
  }

  /** Remove a grant by id (requires `canShare`). 404 if the grant isn't on this page. */
  async removePermission(userId: string, pageId: string, permId: string) {
    await this.requireAccess(userId, pageId, "share");
    const grant = await this.prisma.permission.findUnique({ where: { id: permId } });
    if (!grant || grant.pageId !== pageId) {
      throw new NotFoundException("Permission not found on this page");
    }
    await this.prisma.permission.delete({ where: { id: permId } });
    return { deleted: 1, id: permId };
  }

  /**
   * Invite a person to THIS page by email (requires `canShare`).
   *
   * - If a user with that email already exists: ensure they are a WorkspaceMember
   *   of the page's workspace (created as `guest` if not already a member — an
   *   existing member keeps their role), grant them the page `Permission`, and
   *   create a `share` Notification. Returns `{ kind: "granted", userId, … }`.
   * - If NO user with that email exists: fall back to the Phase-1 workspace
   *   invitation flow with role `guest` (an email is sent). On acceptance they
   *   become a workspace guest; the page grant is NOT pre-created (we have no
   *   userId yet). Returns `{ kind: "invited", … }`.
   *   (Documented simplification: the page grant is auto-applied for existing
   *   users only; a brand-new invitee is sent a guest workspace invite and the
   *   sharer re-shares the page once they have an account. This keeps us from
   *   creating dangling user-less Permission rows.)
   */
  async shareInvite(userId: string, pageId: string, input: ShareInviteInput) {
    const page = await this.requireAccess(userId, pageId, "share");
    const email = input.email.trim().toLowerCase();

    const target = await this.prisma.user.findUnique({ where: { email } });

    if (target) {
      // Ensure workspace membership (guest if not already a member).
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: target.id } },
      });
      if (!member) {
        await this.prisma.workspaceMember.create({
          data: {
            workspaceId: page.workspaceId,
            userId: target.id,
            role: "guest",
            invitedById: userId,
          },
        });
      }

      const grant = await this.prisma.permission.upsert({
        where: {
          pageId_subjectType_subjectId: {
            pageId,
            subjectType: "user",
            subjectId: target.id,
          },
        },
        create: { pageId, subjectType: "user", subjectId: target.id, role: input.role },
        update: { role: input.role },
      });

      if (target.id !== userId) {
        await this.notifications.create({
          recipientId: target.id,
          type: "share",
          sourceRef: { pageId, grantedById: userId, role: input.role },
        });
      }

      return {
        kind: "granted" as const,
        userId: target.id,
        permissionId: grant.id,
        role: grant.role,
        guest: !member,
      };
    }

    // No account yet → Phase-1 workspace invitation as a guest. The page-level
    // grant cannot be created without a userId; the inviter re-shares the page
    // once the invitee has accepted (documented above).
    await this.invitations.invite(userId, page.workspaceId, { email, role: "guest" });
    return { kind: "invited" as const, email };
  }

  /**
   * The caller's resolved capabilities for a page: `GET /pages/:id/access`.
   * 404 if the page is missing, 403 if the caller has no access at all; else
   * `{ role, canRead, canComment, canWrite, canShare }`. Lets the web hide edit/
   * share affordances and put the editor read-only when `!canWrite`.
   */
  async access(userId: string, pageId: string) {
    await this.loadPage(pageId);
    const access = await resolvePageAccess(this.prisma, userId, pageId);
    if (!access) {
      throw new ForbiddenException("You do not have access to this page");
    }
    return access;
  }
}
