import { afterEach, describe, expect, it } from "vitest";
import { assertSyncSecretsAreSafe } from "../src/collab.js";

const saved = { NODE_ENV: process.env.NODE_ENV, JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET };
afterEach(() => {
  process.env.NODE_ENV = saved.NODE_ENV;
  process.env.JWT_ACCESS_SECRET = saved.JWT_ACCESS_SECRET;
});

describe("assertSyncSecretsAreSafe", () => {
  it("throws in production with a weak/empty secret", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "dev_access_secret_change_me";
    expect(() => assertSyncSecretsAreSafe()).toThrow(/JWT_ACCESS_SECRET/);
    process.env.JWT_ACCESS_SECRET = "";
    expect(() => assertSyncSecretsAreSafe()).toThrow();
  });

  it("passes in production with a strong secret", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "a-strong-unique-shared-secret-1234567890";
    expect(() => assertSyncSecretsAreSafe()).not.toThrow();
  });

  it("does not throw outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_ACCESS_SECRET = "dev_access_secret_change_me";
    expect(() => assertSyncSecretsAreSafe()).not.toThrow();
  });
});
