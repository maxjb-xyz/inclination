import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SharingController } from "./sharing.controller";
import { SharingService } from "./sharing.service";

/**
 * Page sharing / permission grants (spec §5/§6). Reuses the injectable
 * `NotificationsService` (share notifications) and `InvitationsService`
 * (Phase-1 guest invites for not-yet-registered emails). All authz flows
 * through the shared `resolvePageAccess`.
 */
@Module({
  imports: [NotificationsModule, WorkspacesModule],
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
