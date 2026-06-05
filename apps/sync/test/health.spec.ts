import { describe, expect, it } from "vitest";
import { liveness, readiness } from "../src/health.js";

describe("sync liveness", () => {
  it("returns 200 ok", () => {
    expect(liveness()).toEqual({ statusCode: 200, body: { status: "ok" } });
  });
});

describe("sync readiness", () => {
  it("returns 200 when the db ping resolves", async () => {
    const res = await readiness(async () => [{ "?column?": 1 }]);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns 503 when the db ping rejects", async () => {
    const res = await readiness(async () => {
      throw new Error("connection refused");
    });
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe("error");
    const report = res.body as { checks: { name: string; state: string }[] };
    expect(report.checks.find((c) => c.name === "postgres")?.state).toBe("down");
  });
});
