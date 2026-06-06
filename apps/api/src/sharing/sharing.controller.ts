import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import {
  shareInviteSchema,
  upsertPermissionSchema,
  type ShareInviteInput,
  type UpsertPermissionInput,
} from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { SharingService } from "./sharing.service";

/**
 * Page sharing endpoints (spec §5/§6), all under `/api/pages/:id`:
 *   GET    /pages/:id/permissions        — list grants (canRead)
 *   PUT    /pages/:id/permissions        — upsert a user/workspace grant (canShare)
 *   DELETE /pages/:id/permissions/:permId — remove a grant (canShare)
 *   POST   /pages/:id/share-invite       — invite a person to this page (canShare)
 *   GET    /pages/:id/access             — the caller's resolved capabilities
 */
@Controller("pages/:id")
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get("permissions")
  list(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.sharing.listPermissions(user.id, pageId);
  }

  @Put("permissions")
  upsert(
    @CurrentUser() user: PublicUser,
    @Param("id") pageId: string,
    @Body(new ZodValidationPipe(upsertPermissionSchema)) body: UpsertPermissionInput,
  ) {
    return this.sharing.upsertPermission(user.id, pageId, body);
  }

  @Delete("permissions/:permId")
  remove(
    @CurrentUser() user: PublicUser,
    @Param("id") pageId: string,
    @Param("permId") permId: string,
  ) {
    return this.sharing.removePermission(user.id, pageId, permId);
  }

  @Post("share-invite")
  shareInvite(
    @CurrentUser() user: PublicUser,
    @Param("id") pageId: string,
    @Body(new ZodValidationPipe(shareInviteSchema)) body: ShareInviteInput,
  ) {
    return this.sharing.shareInvite(user.id, pageId, body);
  }

  @Get("access")
  access(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.sharing.access(user.id, pageId);
  }
}
