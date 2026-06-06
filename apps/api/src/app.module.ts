import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { HEALTH_PROBES } from "./health/checks";
import { MailModule } from "./mail/mail.module";
import { PagesModule } from "./pages/pages.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PrismaService } from "./prisma/prisma.service";
import { StorageService } from "./storage/storage.service";
import { UsersModule } from "./users/users.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MailModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    UsersModule,
    WorkspacesModule,
    PagesModule,
  ],
  controllers: [HealthController],
  providers: [
    StorageService,
    HealthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: HEALTH_PROBES,
      useFactory: (prisma: PrismaService, storage: StorageService) => [prisma, storage],
      inject: [PrismaService, StorageService],
    },
  ],
})
export class AppModule {}
