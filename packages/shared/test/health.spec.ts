import { describe, expect, it } from "vitest";
import { livenessReport, serviceHealth, type Probe } from "../src/health";

describe("livenessReport", () => {
  it("always reports ok", () => {
    expect(livenessReport()).toEqual({ status: "ok" });
  });
});

describe("serviceHealth", () => {
  const ok: Probe = { name: "db", check: async () => undefined };
  const fail: Probe = {
    name: "minio",
    check: async () => {
      throw new Error("connection refused");
    },
  };

  it("reports ok when all probes resolve", async () => {
    const report = await serviceHealth([ok]);
    expect(report.status).toBe("ok");
    expect(report.checks).toEqual([{ name: "db", state: "up" }]);
  });

  it("reports error and marks the failing probe down", async () => {
    const report = await serviceHealth([ok, fail]);
    expect(report.status).toBe("error");
    expect(report.checks).toContainEqual({ name: "db", state: "up" });
    expect(report.checks).toContainEqual({
      name: "minio",
      state: "down",
      detail: "connection refused",
    });
  });

  it("reports ok for an empty probe set (nothing to fail)", async () => {
    const report = await serviceHealth([]);
    expect(report.status).toBe("ok");
    expect(report.checks).toEqual([]);
  });
});
