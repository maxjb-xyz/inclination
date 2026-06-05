import { Inject, Injectable } from "@nestjs/common";
import { livenessReport, serviceHealth, type ReadinessReport } from "@inclination/shared";
import { HEALTH_PROBES, type HealthProbe } from "./checks";

@Injectable()
export class HealthService {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbe[]) {}

  /** Liveness: the process is up and able to answer. */
  liveness(): { status: "ok" } {
    return livenessReport();
  }

  /** Readiness: every backing dependency is reachable. */
  readiness(): Promise<ReadinessReport> {
    return serviceHealth(
      this.probes.map((probe) => ({ name: probe.name, check: () => probe.ping() })),
    );
  }
}
