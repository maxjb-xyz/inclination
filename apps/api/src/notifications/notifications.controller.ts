import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { NotificationsService } from "./notifications.service";

/** Current-user notification inbox (spec §5/§6). A user only sees/marks their own. */
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: PublicUser, @Query("limit") limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : undefined;
    return this.notifications.list(user.id, Number.isFinite(n as number) ? n : undefined);
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() user: PublicUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Post(":id/read")
  markRead(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post("read-all")
  markAllRead(@CurrentUser() user: PublicUser) {
    return this.notifications.markAllRead(user.id);
  }
}
