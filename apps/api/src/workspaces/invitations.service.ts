import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { InviteInput } from "@inclination/shared";
import type { WorkspaceMember } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { AppConfig } from "../config/app-config";
import { WorkspacesService } from "./workspaces.service";

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly workspaces: WorkspacesService,
  ) {}

  private hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  async invite(userId: string, workspaceId: string, input: InviteInput) {
    await this.workspaces.requireRole(userId, workspaceId, ["owner", "admin"]);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new BadRequestException("Workspace not found");

    const rawToken = randomBytes(32).toString("base64url");
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        email: input.email,
        role: input.role as WorkspaceMember["role"],
        tokenHash: this.hash(rawToken),
        expiresAt: new Date(Date.now() + this.config.inviteTokenTtlSec * 1000),
        invitedById: userId,
      },
    });
    await this.mail.sendInvitationEmail(input.email, rawToken, workspace.name);
    return { id: invitation.id, email: invitation.email, role: invitation.role };
  }

  /** Accept an invitation as the authenticated user (whose email must match). */
  async accept(userId: string, userEmail: string, rawToken: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Invalid or expired invitation");
    }
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException("This invitation was issued to a different email");
    }

    await this.prisma.$transaction([
      this.prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
          invitedById: invitation.invitedById,
        },
        update: {},
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
    return { workspaceId: invitation.workspaceId, role: invitation.role };
  }

  async listForWorkspace(userId: string, workspaceId: string) {
    await this.workspaces.requireRole(userId, workspaceId, ["owner", "admin"]);
    const rows = await this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    }));
  }
}
