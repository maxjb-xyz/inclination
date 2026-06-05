import { livenessReport, serviceHealth, type ReadinessReport } from "@inclination/shared";

export interface HealthResponse {
  statusCode: number;
  body: { status: "ok" } | ReadinessReport;
}

/** Liveness: the sync process is up. */
export function liveness(): HealthResponse {
  return { statusCode: 200, body: livenessReport() };
}

/**
 * Readiness: the database the sync server persists Yjs updates to is reachable.
 * `pingDb` is injected so this is unit-testable without a real database.
 */
export async function readiness(pingDb: () => Promise<unknown>): Promise<HealthResponse> {
  const report = await serviceHealth([{ name: "postgres", check: pingDb }]);
  return { statusCode: report.status === "ok" ? 200 : 503, body: report };
}
