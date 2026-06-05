import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { ReadinessReport } from "@inclination/shared";
import { HealthService } from "./health.service";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness probe — always 200 while the process can answer. */
  @Get("health")
  liveness(): { status: "ok" } {
    return this.health.liveness();
  }

  /** Readiness probe — 200 when every dependency is up, else 503 (body carries the report). */
  @Get("ready")
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== "ok") {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
