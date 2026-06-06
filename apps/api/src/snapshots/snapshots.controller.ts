import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createSnapshotSchema, type CreateSnapshotInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { SnapshotsService } from "./snapshots.service";

/** Page version-history endpoints (spec §5). */
@Controller("pages/:id/snapshots")
@UseGuards(JwtAuthGuard)
export class SnapshotsController {
  constructor(private readonly snapshots: SnapshotsService) {}

  @Get()
  list(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.snapshots.list(user.id, id);
  }

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSnapshotSchema)) body: CreateSnapshotInput,
  ) {
    return this.snapshots.create(user.id, id, body);
  }

  @Get(":snapId")
  preview(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Param("snapId") snapId: string,
  ) {
    return this.snapshots.preview(user.id, id, snapId);
  }

  @Post(":snapId/restore")
  restore(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Param("snapId") snapId: string,
  ) {
    return this.snapshots.restore(user.id, id, snapId);
  }
}
