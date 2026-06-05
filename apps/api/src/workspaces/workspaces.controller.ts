import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createWorkspaceSchema,
  inviteSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceInput,
  type InviteInput,
  type UpdateWorkspaceInput,
} from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { WorkspacesService } from "./workspaces.service";
import { InvitationsService } from "./invitations.service";

@Controller("workspaces")
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    return this.workspaces.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.workspaces.listForUser(user.id);
  }

  @Get(":id")
  get(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.workspaces.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ) {
    return this.workspaces.update(user.id, id, body);
  }

  @Get(":id/members")
  members(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.workspaces.members(user.id, id);
  }

  @Post(":id/invitations")
  invite(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(inviteSchema)) body: InviteInput,
  ) {
    return this.invitations.invite(user.id, id, body);
  }

  @Get(":id/invitations")
  listInvitations(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.invitations.listForWorkspace(user.id, id);
  }
}
