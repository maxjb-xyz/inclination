import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { presignUploadSchema, type PresignUploadInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { FilesService } from "./files.service";

/** Workspace-scoped presigned upload endpoint (spec §9). */
@Controller("workspaces/:wsId")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly files: FilesService) {}

  @Post("uploads/presign")
  presign(
    @CurrentUser() user: PublicUser,
    @Param("wsId") wsId: string,
    @Body(new ZodValidationPipe(presignUploadSchema)) body: PresignUploadInput,
  ) {
    return this.files.presignUpload(user.id, wsId, body);
  }
}

/** Attachment download endpoint — returns a presigned GET URL as JSON. */
@Controller("attachments")
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly files: FilesService) {}

  @Get(":id")
  download(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.files.getDownloadUrl(user.id, id);
  }
}
