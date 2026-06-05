import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { HEALTH_PROBES } from "./health/checks";
import { PrismaService } from "./prisma/prisma.service";
import { StorageService } from "./storage/storage.service";

@Module({
  controllers: [HealthController],
  providers: [
    PrismaService,
    StorageService,
    HealthService,
    {
      provide: HEALTH_PROBES,
      useFactory: (prisma: PrismaService, storage: StorageService) => [prisma, storage],
      inject: [PrismaService, StorageService],
    },
  ],
})
export class AppModule {}
