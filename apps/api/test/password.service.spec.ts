import { describe, expect, it } from "vitest";
import { PasswordService } from "../src/auth/password.service";

describe("PasswordService", () => {
  const svc = new PasswordService();

  it("hashes to something other than the plaintext (argon2id)", async () => {
    const hash = await svc.hash("correcthorsebattery");
    expect(hash).not.toBe("correcthorsebattery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await svc.hash("correcthorsebattery");
    expect(await svc.verify(hash, "correcthorsebattery")).toBe(true);
    expect(await svc.verify(hash, "wrong")).toBe(false);
  });

  it("returns false (not throw) for a malformed hash", async () => {
    expect(await svc.verify("not-a-hash", "x")).toBe(false);
  });
});
