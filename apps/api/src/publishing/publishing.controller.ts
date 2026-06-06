import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  importMarkdownSchema,
  publishPageSchema,
  type ImportMarkdownInput,
  type PublishPageInput,
} from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { PublishingService } from "./publishing.service";
import { ImportService } from "./import.service";
import { SyncedBlocksService } from "./synced-blocks.service";

/**
 * Page-scoped publishing + export endpoints (all JWT-guarded), under `/pages/:id`:
 *   POST /pages/:id/publish        — publish/re-publish (canShare)
 *   POST /pages/:id/unpublish      — unpublish (canShare)
 *   GET  /pages/:id/public-share   — current settings or null (canRead)
 *   GET  /pages/:id/export/markdown — Markdown export (canRead)
 */
@Controller("pages/:id")
@UseGuards(JwtAuthGuard)
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Post("publish")
  publish(
    @CurrentUser() user: PublicUser,
    @Param("id") pageId: string,
    @Body(new ZodValidationPipe(publishPageSchema)) body: PublishPageInput,
  ) {
    return this.publishing.publish(user.id, pageId, body);
  }

  @Post("unpublish")
  unpublish(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.publishing.unpublish(user.id, pageId);
  }

  @Get("public-share")
  settings(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.publishing.getSettings(user.id, pageId);
  }

  @Get("export/markdown")
  exportMarkdown(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.publishing.exportMarkdown(user.id, pageId);
  }
}

/**
 * The UNAUTHENTICATED public read endpoint (spec §8): `GET /api/public/:slug`.
 * Deliberately has NO JwtAuthGuard so logged-out viewers can read a published
 * page. The service returns content ONLY for `published === true` shares and
 * 404s otherwise, so unpublished/unknown slugs leak nothing.
 */
@Controller("public")
export class PublicReadController {
  constructor(private readonly publishing: PublishingService) {}

  @Get(":slug")
  read(@Param("slug") slug: string) {
    return this.publishing.getPublic(slug);
  }
}

/**
 * Workspace-scoped import + synced-block creation (JWT-guarded; membership
 * enforced in the services), under `/workspaces/:wsId`:
 *   POST /workspaces/:wsId/import/markdown — import a Markdown file into a tree
 *   POST /workspaces/:wsId/synced-blocks   — create a synced block → { id }
 */
@Controller("workspaces/:wsId")
@UseGuards(JwtAuthGuard)
export class WorkspacePublishingController {
  constructor(
    private readonly importer: ImportService,
    private readonly syncedBlocks: SyncedBlocksService,
  ) {}

  @Post("import/markdown")
  importMarkdown(
    @CurrentUser() user: PublicUser,
    @Param("wsId") wsId: string,
    @Body(new ZodValidationPipe(importMarkdownSchema)) body: ImportMarkdownInput,
  ) {
    return this.importer.importMarkdown(user.id, wsId, body);
  }

  @Post("synced-blocks")
  createSyncedBlock(@CurrentUser() user: PublicUser, @Param("wsId") wsId: string) {
    return this.syncedBlocks.create(user.id, wsId);
  }
}

/**
 * Synced-block read endpoint (JWT-guarded; workspace membership in the service):
 *   GET /synced-blocks/:id — metadata for an embedded synced block
 */
@Controller("synced-blocks")
@UseGuards(JwtAuthGuard)
export class SyncedBlocksController {
  constructor(private readonly syncedBlocks: SyncedBlocksService) {}

  @Get(":id")
  get(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.syncedBlocks.get(user.id, id);
  }
}
