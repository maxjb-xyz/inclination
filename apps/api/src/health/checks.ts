/**
 * A dependency that can report whether it is reachable. Implemented by
 * PrismaService (postgres) and StorageService (minio). Defining the health
 * surface as an interface keeps HealthService unit-testable with fakes.
 */
export interface HealthProbe {
  readonly name: string;
  /** Resolves when the dependency is reachable; rejects otherwise. */
  ping(): Promise<unknown>;
}

/** DI token for the array of probes the readiness check aggregates. */
export const HEALTH_PROBES = Symbol("HEALTH_PROBES");
