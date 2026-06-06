import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createCommentSchema, type CreateCommentInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { CommentsService } from "./comments.service";

/** Page-scoped comment collection (create + list). */
@Controller("pages/:id/comments")
@UseGuards(JwtAuthGuard)
export class PageCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Param("id") pageId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateCommentInput,
  ) {
    return this.comments.create(user.id, pageId, body);
  }

  @Get()
  list(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.comments.list(user.id, pageId);
  }
}

/** Comment-scoped actions (resolve/unresolve/delete). */
@Controller("comments")
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post(":id/resolve")
  resolve(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.comments.resolve(user.id, id);
  }

  @Post(":id/unresolve")
  unresolve(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.comments.unresolve(user.id, id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.comments.remove(user.id, id);
  }
}
