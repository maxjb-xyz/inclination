import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createPageSchema,
  movePageSchema,
  saveContentSchema,
  setReferencesSchema,
  updatePageSchema,
  type CreatePageInput,
  type MovePageInput,
  type SaveContentInput,
  type SetReferencesInput,
  type UpdatePageInput,
} from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { PagesService } from "./pages.service";

/** Workspace-scoped page collection endpoints. */
@Controller("workspaces/:wsId")
@UseGuards(JwtAuthGuard)
export class WorkspacePagesController {
  constructor(private readonly pages: PagesService) {}

  @Post("pages")
  create(
    @CurrentUser() user: PublicUser,
    @Param("wsId") wsId: string,
    @Body(new ZodValidationPipe(createPageSchema)) body: CreatePageInput,
  ) {
    return this.pages.create(user.id, wsId, body);
  }

  @Get("pages")
  list(@CurrentUser() user: PublicUser, @Param("wsId") wsId: string) {
    return this.pages.listTree(user.id, wsId);
  }

  @Get("trash")
  trash(@CurrentUser() user: PublicUser, @Param("wsId") wsId: string) {
    return this.pages.listTrash(user.id, wsId);
  }

  /** Autocomplete for `@`-mentions and page links: members + pages by title. */
  @Get("search/mentionable")
  mentionable(
    @CurrentUser() user: PublicUser,
    @Param("wsId") wsId: string,
    @Query("q") q?: string,
  ) {
    return this.pages.searchMentionable(user.id, wsId, q ?? "");
  }
}

/** Page-scoped endpoints (meta, move, trash/restore, content). */
@Controller("pages")
@UseGuards(JwtAuthGuard)
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get(":id")
  get(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.pages.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePageSchema)) body: UpdatePageInput,
  ) {
    return this.pages.update(user.id, id, body);
  }

  @Post(":id/move")
  move(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(movePageSchema)) body: MovePageInput,
  ) {
    return this.pages.move(user.id, id, body);
  }

  @Delete(":id")
  archive(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.pages.archive(user.id, id);
  }

  @Post(":id/restore")
  restore(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.pages.restore(user.id, id);
  }

  @Get(":id/content")
  getContent(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.pages.getContent(user.id, id);
  }

  @Put(":id/content")
  saveContent(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(saveContentSchema)) body: SaveContentInput,
  ) {
    return this.pages.saveContent(user.id, id, body);
  }

  @Put(":id/references")
  setReferences(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setReferencesSchema)) body: SetReferencesInput,
  ) {
    return this.pages.setReferences(user.id, id, body);
  }

  @Get(":id/backlinks")
  backlinks(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.pages.backlinks(user.id, id);
  }
}
