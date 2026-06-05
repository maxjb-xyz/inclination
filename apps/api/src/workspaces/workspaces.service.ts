import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from "@inclination/shared";
import type { Prisma, WorkspaceMember } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";

type Role = WorkspaceMember["role"];

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the membership row or throws 403 if the user is not a member. */
  async requireMember(userId: string, workspaceId: string): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) {
      throw new ForbiddenException("You are not a member of this workspace");
    }
    return member;
  }

  async requireRole(userId: string, workspaceId: string, roles: Role[]): Promise<WorkspaceMember> {
    const member = await this.requireMember(userId, workspaceId);
    if (!roles.includes(member.role)) {
      throw new ForbiddenException("Insufficient workspace role");
    }
    return member;
  }

  async create(userId: string, input: CreateWorkspaceInput) {
    return this.prisma.workspace.create({
      data: {
        name: input.name,
        icon: input.icon,
        members: { create: { userId, role: "owner" } },
      },
    });
  }

  async listForUser(userId: string) {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async get(userId: string, workspaceId: string) {
    await this.requireMember(userId, workspaceId);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException("Workspace not found");
    return workspace;
  }

  async update(userId: string, workspaceId: string, input: UpdateWorkspaceInput) {
    await this.requireRole(userId, workspaceId, ["owner", "admin"]);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.settings !== undefined
          ? { settings: input.settings as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async members(userId: string, workspaceId: string) {
    await this.requireMember(userId, workspaceId);
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    });
    return rows.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      displayName: m.user.displayName,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
    }));
  }
}
