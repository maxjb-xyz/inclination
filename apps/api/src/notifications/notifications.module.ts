import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Notifications inbox + an injectable `NotificationsService.create(...)` reused
 * by Comments (mention/reply) and, later, T3 sharing and Phase-1 invites.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
