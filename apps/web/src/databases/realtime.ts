import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "../auth/authStore";
import { realtimeOrigin, realtimePath } from "./realtimeUrl";
import type { DatabaseEvent } from "./realtimeReducer";

type EventListener = (event: DatabaseEvent) => void;

/**
 * A token provider — the fresh access token to hand the socket on each
 * (re)connect. Injectable so the singleton can be unit-tested without the real
 * zustand store.
 */
export type TokenProvider = () => string;

/**
 * Singleton socket.io connection to the realtime gateway (T4).
 *
 * - One connection per browser tab, shared across every open database view.
 * - Auth: the access token is passed in the handshake `auth.token`; on reconnect
 *   socket.io re-runs the auth callback, so we read a FRESH token each time
 *   (an expired token after a long disconnect would otherwise be reused).
 * - Subscriptions are ref-counted per database id: the first subscriber emits
 *   `subscribe { databaseId }`, the last unsubscriber emits `unsubscribe`.
 * - Re-subscribes all active rooms on reconnect (rooms are server-side and lost
 *   when the socket drops).
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly refCounts = new Map<string, number>();

  constructor(
    private readonly getToken: TokenProvider,
    private readonly connect: (token: TokenProvider) => Socket = defaultConnect,
  ) {}

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;
    const socket = this.connect(this.getToken);
    socket.on("database:event", (event: DatabaseEvent) => {
      const set = this.listeners.get(event.databaseId);
      if (!set) return;
      for (const fn of set) fn(event);
    });
    // On (re)connect, (re)subscribe every active room.
    socket.on("connect", () => {
      for (const [databaseId, count] of this.refCounts) {
        if (count > 0) socket.emit("subscribe", { databaseId });
      }
    });
    this.socket = socket;
    return socket;
  }

  /**
   * Subscribe to a database's realtime events. Returns an unsubscribe function.
   * Idempotent per-listener; ref-counts the server room so the room is joined
   * once and left when the last listener detaches.
   */
  subscribe(databaseId: string, listener: EventListener): () => void {
    const socket = this.ensureSocket();

    let set = this.listeners.get(databaseId);
    if (!set) {
      set = new Set();
      this.listeners.set(databaseId, set);
    }
    set.add(listener);

    const next = (this.refCounts.get(databaseId) ?? 0) + 1;
    this.refCounts.set(databaseId, next);
    if (next === 1) {
      if (socket.connected) socket.emit("subscribe", { databaseId });
      // else the `connect` handler will subscribe once connected.
    }

    return () => {
      const s = this.listeners.get(databaseId);
      s?.delete(listener);
      const count = (this.refCounts.get(databaseId) ?? 1) - 1;
      this.refCounts.set(databaseId, Math.max(0, count));
      if (count <= 0) {
        this.listeners.delete(databaseId);
        this.refCounts.delete(databaseId);
        this.socket?.emit("unsubscribe", { databaseId });
      }
    };
  }

  /** Tear the connection down (e.g. on logout). Mostly for tests/cleanup. */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.listeners.clear();
    this.refCounts.clear();
  }
}

/** Build the real socket.io connection with a fresh-token auth callback. */
function defaultConnect(getToken: TokenProvider): Socket {
  return io(realtimeOrigin(), {
    path: realtimePath(),
    transports: ["websocket"],
    // socket.io invokes this on every (re)connect → always a fresh token.
    auth: (cb: (data: { token: string }) => void) => cb({ token: getToken() }),
  });
}

/** Singleton wired to the real auth store. */
export const realtimeClient = new RealtimeClient(
  () => useAuthStore.getState().tokens?.accessToken ?? "",
);
