/**
 * Shared health/readiness contract used by every service so the API and the
 * sync server report status in an identical shape.
 */

export type HealthStatus = "ok" | "error";
export type CheckState = "up" | "down";

export interface CheckResult {
  name: string;
  state: CheckState;
  /** Optional human-readable detail (e.g. an error message when down). */
  detail?: string;
}

export interface ReadinessReport {
  status: HealthStatus;
  checks: CheckResult[];
}

/** A single dependency probe: a name plus an async function that throws when unhealthy. */
export interface Probe {
  name: string;
  check: () => Promise<unknown>;
}

/** A trivially-healthy liveness report. */
export function livenessReport(): { status: "ok" } {
  return { status: "ok" };
}

/**
 * Run every probe and assemble a {@link ReadinessReport}. Overall status is
 * "ok" only when every probe resolves; any rejection marks that check "down"
 * and the overall status "error".
 */
export async function serviceHealth(probes: Probe[]): Promise<ReadinessReport> {
  const checks = await Promise.all(
    probes.map(async (probe): Promise<CheckResult> => {
      try {
        await probe.check();
        return { name: probe.name, state: "up" };
      } catch (err) {
        return {
          name: probe.name,
          state: "down",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const status: HealthStatus = checks.every((c) => c.state === "up") ? "ok" : "error";
  return { status, checks };
}
