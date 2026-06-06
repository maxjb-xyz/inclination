import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { StorageService } from "../storage/storage.service";
import { AttachmentsController, UploadsController } from "./files.controller";
import { FilesService } from "./files.service";

/**
 * Files feature (spec §9): presigned MinIO uploads scoped to a workspace
 * (content-type allowlist + size cap) and presigned downloads authorized via
 * the attachment's page (resolvePageAccess) or workspace membership.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [UploadsController, AttachmentsController],
  providers: [FilesService, StorageService],
})
export class FilesModule {}
