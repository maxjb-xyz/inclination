import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import {
  PublicReadController,
  PublishingController,
  SyncedBlocksController,
  WorkspacePublishingController,
} from "./publishing.controller";
import { PublishingService } from "./publishing.service";
import { ImportService } from "./import.service";
import { SyncedBlocksService } from "./synced-blocks.service";

/**
 * Phase 8 — publishing, Markdown import/export, and synced blocks (spec §5/§8).
 * Reuses the shared `resolvePageAccess` (publish=canShare, export=canRead) and
 * `WorkspacesService.requireMember` (import + synced blocks). The public read
 * controller is intentionally unauthenticated; the service serves only
 * published content.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [
    PublishingController,
    PublicReadController,
    WorkspacePublishingController,
    SyncedBlocksController,
  ],
  providers: [PublishingService, ImportService, SyncedBlocksService],
  exports: [PublishingService, ImportService, SyncedBlocksService],
})
export class PublishingModule {}
