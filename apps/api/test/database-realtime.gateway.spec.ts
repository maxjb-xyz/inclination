import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { DatabaseRealtimeGateway } from "../src/databases/realtime/database-realtime.gateway";
import type { AppConfig } from "../src/config/app-config";
import type { DatabaseAccessService } from "../src/databases/database-access.service";

const SECRET = "gateway-test-secret";

function makeGateway(opts: {
  canAccess?: boolean;
} = {}): {
  gateway: DatabaseRealtimeGateway;
  requireDatabase: ReturnType<typeof vi.fn>;
} {
  const config = { jwtAccessSecret: SECRET } as AppConfig;
  const requireDatabase = vi.fn(async () => {
    if (opts.canAccess === false) throw new Error("forbidden");
    return {} as never;
  });
  const access = { requireDatabase } as unknown as DatabaseAccessService;
  return { gateway: new DatabaseRealtimeGateway(config, access), requireDatabase };
}

/** A fake socket.io Socket recording join/leave/disconnect and carrying data. */
function makeSocket(handshake: unknown) {
  return {
    handshake,
    data: {} as { userId?: string },
    join: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("DatabaseRealtimeGateway", () => {
  describe("handleConnection", () => {
    it("stores userId for a valid handshake token", () => {
      const { gateway } = makeGateway();
      const token = jwt.sign({ sub: "user-1" }, SECRET, { expiresIn: 60 });
      const socket = makeSocket({ auth: { token } });
      gateway.handleConnection(socket as never);
      expect(socket.data.userId).toBe("user-1");
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it("disconnects a socket with an invalid token", () => {
      const { gateway } = makeGateway();
      const socket = makeSocket({ auth: { token: "bogus" } });
      gateway.handleConnection(socket as never);
      expect(socket.data.userId).toBeUndefined();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it("disconnects a socket with no token", () => {
      const { gateway } = makeGateway();
      const socket = makeSocket({ auth: {} });
      gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe("onSubscribe", () => {
    it("joins the database room when access is allowed", async () => {
      const { gateway, requireDatabase } = makeGateway({ canAccess: true });
      const socket = makeSocket({});
      socket.data.userId = "user-1";
      const ack = await gateway.onSubscribe(socket as never, { databaseId: "db-1" });
      expect(requireDatabase).toHaveBeenCalledWith("user-1", "db-1");
      expect(socket.join).toHaveBeenCalledWith("database:db-1");
      expect(ack).toEqual({ ok: true, databaseId: "db-1" });
    });

    it("rejects subscribe to a database the user cannot access (no join)", async () => {
      const { gateway } = makeGateway({ canAccess: false });
      const socket = makeSocket({});
      socket.data.userId = "user-1";
      const ack = await gateway.onSubscribe(socket as never, { databaseId: "db-1" });
      expect(socket.join).not.toHaveBeenCalled();
      expect(ack).toEqual({ ok: false, error: "forbidden" });
    });

    it("rejects subscribe from an unauthenticated socket", async () => {
      const { gateway, requireDatabase } = makeGateway();
      const socket = makeSocket({});
      const ack = await gateway.onSubscribe(socket as never, { databaseId: "db-1" });
      expect(requireDatabase).not.toHaveBeenCalled();
      expect(ack).toEqual({ ok: false, error: "unauthorized" });
    });
  });

  describe("onUnsubscribe", () => {
    it("leaves the room", async () => {
      const { gateway } = makeGateway();
      const socket = makeSocket({});
      const ack = await gateway.onUnsubscribe(socket as never, { databaseId: "db-1" });
      expect(socket.leave).toHaveBeenCalledWith("database:db-1");
      expect(ack).toEqual({ ok: true });
    });
  });

  describe("emit", () => {
    it("broadcasts the event to the database room as database:event", () => {
      const { gateway } = makeGateway();
      const emit = vi.fn();
      const to = vi.fn(() => ({ emit }));
      // Inject a fake server (the @WebSocketServer field).
      (gateway as unknown as { server: { to: typeof to } }).server = { to };

      const event = {
        databaseId: "db-1",
        type: "cell.updated" as const,
        actorId: "user-1",
        payload: { rowPageId: "r1", propertyId: "p1", value: "hello" },
      };
      gateway.emit(event);
      expect(to).toHaveBeenCalledWith("database:db-1");
      expect(emit).toHaveBeenCalledWith("database:event", event);
    });

    it("is a no-op when the server is not yet bound", () => {
      const { gateway } = makeGateway();
      expect(() =>
        gateway.emit({ databaseId: "db-1", type: "row.created", payload: {} }),
      ).not.toThrow();
    });
  });
});
