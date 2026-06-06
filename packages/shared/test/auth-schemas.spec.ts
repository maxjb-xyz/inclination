import { describe, expect, it } from "vitest";
import {
  createWorkspaceSchema,
  inviteSchema,
  loginSchema,
  passwordResetConfirmSchema,
  registerSchema,
  updateProfileSchema,
} from "../src/auth-schemas";

describe("registerSchema", () => {
  it("accepts a valid registration and normalizes the email", () => {
    const parsed = registerSchema.parse({
      email: "  Alice@Example.COM ",
      password: "correcthorsebattery",
      displayName: " Alice ",
    });
    expect(parsed.email).toBe("alice@example.com");
    expect(parsed.displayName).toBe("Alice");
  });

  it("rejects a short password", () => {
    const r = registerSchema.safeParse({
      email: "a@b.com",
      password: "short",
      displayName: "A",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(registerSchema.safeParse({ email: "nope", password: "x".repeat(10), displayName: "A" }).success).toBe(
      false,
    );
  });
});

describe("loginSchema", () => {
  it("requires a non-empty password but does not enforce length", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("passwordResetConfirmSchema", () => {
  it("enforces the password policy", () => {
    expect(passwordResetConfirmSchema.safeParse({ token: "t", password: "short" }).success).toBe(false);
    expect(
      passwordResetConfirmSchema.safeParse({ token: "t", password: "longenoughpw" }).success,
    ).toBe(true);
  });
});

describe("updateProfileSchema", () => {
  it("requires at least one field", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ displayName: "New" }).success).toBe(true);
  });
});

describe("createWorkspaceSchema", () => {
  it("bounds the name length", () => {
    expect(createWorkspaceSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "My Workspace" }).success).toBe(true);
  });
});

describe("inviteSchema", () => {
  it("accepts non-owner roles and rejects owner", () => {
    expect(inviteSchema.safeParse({ email: "a@b.com", role: "member" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "a@b.com", role: "admin" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "a@b.com", role: "owner" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.com", role: "bogus" }).success).toBe(false);
  });
});
