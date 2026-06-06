import { afterEach, describe, expect, it } from "vitest";
import { AppConfig } from "../src/config/app-config";

const KEYS = ["NODE_ENV", "JWT_ACCESS_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function withEnv(env: Record<string, string>): AppConfig {
  for (const k of KEYS) saved[k] = process.env[k];
  delete process.env.NODE_ENV;
  delete process.env.JWT_ACCESS_SECRET;
  Object.assign(process.env, env);
  return new AppConfig();
}

describe("AppConfig.assertSecretsAreSafe", () => {
  it("throws in production with the known weak default secret", () => {
    const cfg = withEnv({ NODE_ENV: "production", JWT_ACCESS_SECRET: "dev_access_secret_change_me" });
    expect(() => cfg.assertSecretsAreSafe()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("throws in production with an empty secret", () => {
    const cfg = withEnv({ NODE_ENV: "production", JWT_ACCESS_SECRET: "" });
    expect(() => cfg.assertSecretsAreSafe()).toThrow();
  });

  it("passes in production with a strong secret", () => {
    const cfg = withEnv({ NODE_ENV: "production", JWT_ACCESS_SECRET: "a-strong-unique-secret-value-1234567890" });
    expect(() => cfg.assertSecretsAreSafe()).not.toThrow();
  });

  it("does not throw outside production even with a weak secret", () => {
    const cfg = withEnv({ NODE_ENV: "development", JWT_ACCESS_SECRET: "dev_access_secret_change_me" });
    expect(() => cfg.assertSecretsAreSafe()).not.toThrow();
  });
});
