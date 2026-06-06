import { Module } from "@nestjs/common";
import { SnapshotsController } from "./snapshots.controller";
import { SnapshotsService } from "./snapshots.service";

/**
 * Version history (spec §5): list / preview / manual-create / restore a page's
 * Yjs snapshots. Authorization is via the shared resolver inside the service
 * (canRead for list/preview, canWrite for create/restore).
 */
@Module({
  controllers: [SnapshotsController],
  providers: [SnapshotsService],
})
export class SnapshotsModule {}
