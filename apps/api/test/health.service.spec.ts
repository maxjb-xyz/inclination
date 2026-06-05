import { describe, expect, it } from "vitest";
import { HealthService } from "../src/health/health.service";
import type { HealthProbe } from "../src/health/checks";

const up = (name: string): HealthProbe => ({ name, ping: async () => undefined });
const down = (name: string): HealthProbe => ({
  name,
  ping: async () => {
    throw new Error("unreachable");
  },
});

describe("HealthService", () => {
  it("liveness is always ok", () => {
    expect(new HealthService([]).liveness()).toEqual({ status: "ok" });
  });

  it("readiness is ok when every probe is up", async () => {
    const report = await new HealthService([up("postgres"), up("minio")]).readiness();
    expect(report.status).toBe("ok");
    expect(report.checks.map((c) => c.state)).toEqual(["up", "up"]);
  });

  it("readiness is error when any probe is down", async () => {
    const report = await new HealthService([up("postgres"), down("minio")]).readiness();
    expect(report.status).toBe("error");
    expect(report.checks.find((c) => c.name === "minio")?.state).toBe("down");
    expect(report.checks.find((c) => c.name === "postgres")?.state).toBe("up");
  });
});
