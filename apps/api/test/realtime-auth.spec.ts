import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import {
  authorizeSubscribe,
  databaseRoom,
  tokenFromHandshake,
  userIdFromToken,
} from "../src/databases/realtime/realtime-auth";

const SECRET = "unit-test-secret";

describe("realtime-auth", () => {
  describe("databaseRoom", () => {
    it("namespaces the database id into a room", () => {
      expect(databaseRoom("db-1")).toBe("database:db-1");
    });
  });

  describe("userIdFromToken", () => {
    it("returns sub for a valid token signed with the same secret", () => {
      const token = jwt.sign({ sub: "user-1", email: "a@b.c" }, SECRET, { expiresIn: 60 });
      expect(userIdFromToken(token, SECRET)).toBe("user-1");
    });

    it("throws for a missing token", () => {
      expect(() => userIdFromToken(undefined, SECRET)).toThrow(/Missing/);
    });

    it("throws for a token signed with a different secret", () => {
      const token = jwt.sign({ sub: "user-1" }, "other-secret");
      expect(() => userIdFromToken(token, SECRET)).toThrow(/Invalid token/);
    });

    it("throws for an expired token", () => {
      const token = jwt.sign({ sub: "user-1" }, SECRET, { expiresIn: -10 });
      expect(() => userIdFromToken(token, SECRET)).toThrow(/Invalid token/);
    });

    it("throws when the token has no subject", () => {
      const token = jwt.sign({ email: "a@b.c" }, SECRET);
      expect(() => userIdFromToken(token, SECRET)).toThrow(/subject/);
    });
  });

  describe("tokenFromHandshake", () => {
    it("prefers the auth payload token", () => {
      expect(tokenFromHandshake({ auth: { token: "T" }, query: { token: "Q" } })).toBe("T");
    });

    it("falls back to the query token", () => {
      expect(tokenFromHandshake({ query: { token: "Q" } })).toBe("Q");
    });

    it("returns undefined when neither is a non-empty string", () => {
      expect(tokenFromHandshake({ auth: { token: "" }, query: {} })).toBeUndefined();
      expect(tokenFromHandshake(undefined)).toBeUndefined();
      expect(tokenFromHandshake({ auth: { token: 123 } })).toBeUndefined();
    });
  });

  describe("authorizeSubscribe", () => {
    it("returns the room when the checker authorizes the user", async () => {
      const room = await authorizeSubscribe("user-1", "db-1", async (uid, dbId) => {
        expect(uid).toBe("user-1");
        expect(dbId).toBe("db-1");
        return true;
      });
      expect(room).toBe("database:db-1");
    });

    it("returns null when the checker denies access (no events leak)", async () => {
      const room = await authorizeSubscribe("user-1", "db-1", async () => false);
      expect(room).toBeNull();
    });

    it("returns null for an invalid databaseId without calling the checker", async () => {
      let called = false;
      const room = await authorizeSubscribe("user-1", 42 as unknown, async () => {
        called = true;
        return true;
      });
      expect(room).toBeNull();
      expect(called).toBe(false);
    });
  });
});
