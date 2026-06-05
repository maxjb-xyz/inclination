import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@inclination/db";
import type { HealthProbe } from "../health/checks";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, HealthProbe
{
  readonly name = "postgres";

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Readiness probe — a trivial round-trip that proves the connection works. */
  async ping(): Promise<unknown> {
    return this.$queryRaw`SELECT 1`;
  }
}
