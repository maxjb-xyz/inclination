import { describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "../src/databases/realtime";
import type { DatabaseEvent } from "../src/databases/realtimeReducer";

/** A minimal fake socket.io socket. */
function fakeSocket() {
  const handlers = new Map<string, (arg: unknown) => void>();
  const emitted: { event: string; arg: unknown }[] = [];
  return {
    connected: true,
    on: (event: string, cb: (arg: unknown) => void) => {
      handlers.set(event, cb);
    },
    emit: (event: string, arg?: unknown) => {
      emitted.push({ event, arg });
    },
    disconnect: vi.fn(),
    /** Test helper: deliver a database:event. */
    fire: (event: DatabaseEvent) => handlers.get("database:event")?.(event),
    emitted,
  };
}

describe("RealtimeClient", () => {
  it("subscribes (ref-counted) and delivers events to listeners", () => {
    const socket = fakeSocket();
    const client = new RealtimeClient(
      () => "tok",
      () => socket as never,
    );

    const received: DatabaseEvent[] = [];
    const off = client.subscribe("db1", (e) => received.push(e));

    // First subscriber emits a subscribe for the room.
    expect(socket.emitted).toContainEqual({ event: "subscribe", arg: { databaseId: "db1" } });

    const event: DatabaseEvent = { databaseId: "db1", type: "cell.updated", payload: {} };
    socket.fire(event);
    expect(received).toEqual([event]);

    // Events for other databases are not delivered.
    socket.fire({ databaseId: "other", type: "cell.updated", payload: {} });
    expect(received).toHaveLength(1);

    // Last unsubscribe emits unsubscribe.
    off();
    expect(socket.emitted).toContainEqual({ event: "unsubscribe", arg: { databaseId: "db1" } });
  });

  it("emits subscribe only once for the room across multiple listeners", () => {
    const socket = fakeSocket();
    const client = new RealtimeClient(
      () => "tok",
      () => socket as never,
    );
    const off1 = client.subscribe("db1", () => {});
    const off2 = client.subscribe("db1", () => {});
    const subscribes = socket.emitted.filter((e) => e.event === "subscribe");
    expect(subscribes).toHaveLength(1);
    off1();
    // Still one listener → no unsubscribe yet.
    expect(socket.emitted.filter((e) => e.event === "unsubscribe")).toHaveLength(0);
    off2();
    expect(socket.emitted.filter((e) => e.event === "unsubscribe")).toHaveLength(1);
  });
});
