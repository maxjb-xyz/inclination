import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/**
 * Integration gate: with a real Postgres and a real MinIO reachable, the API's
 * /api/ready endpoint reports 200 with both dependency probes "up". This proves
 * the readiness wiring (PrismaService + StorageService) against real infra.
 */
describe("API readiness (integration)", () => {
  let pg: StartedPostgreSqlContainer;
  let minio: StartedTestContainer;
  let app: INestApplication;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("inclination")
      .withUsername("inclination")
      .withPassword("inclination_dev_pw")
      .start();

    minio = await new GenericContainer("minio/minio:latest")
      .withEnvironment({
        MINIO_ROOT_USER: "inclination",
        MINIO_ROOT_PASSWORD: "inclination_dev_pw",
      })
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
      .start();

    process.env.DATABASE_URL = pg.getConnectionUri();
    process.env.S3_ENDPOINT = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    process.env.S3_REGION = "us-east-1";
    process.env.S3_FORCE_PATH_STYLE = "true";
    process.env.S3_ACCESS_KEY = "inclination";
    process.env.S3_SECRET_KEY = "inclination_dev_pw";

    // Import AFTER env is set so PrismaClient reads the container DATABASE_URL.
    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await minio?.stop();
    await pg?.stop();
  });

  it("liveness returns ok", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("readiness returns 200 with both probes up", async () => {
    const res = await request(app.getHttpServer()).get("/api/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    const states = Object.fromEntries(
      res.body.checks.map((c: { name: string; state: string }) => [c.name, c.state]),
    );
    expect(states.postgres).toBe("up");
    expect(states.minio).toBe("up");
  });
});
