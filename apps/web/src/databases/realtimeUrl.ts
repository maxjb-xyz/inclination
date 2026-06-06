/**
 * Resolve the socket.io connection settings for the realtime gateway.
 *
 * The gateway is mounted at `path: /api/realtime` (so Caddy's `/api/*` proxy
 * forwards the websocket). socket.io connects to an *origin* + a `path`, so we
 * split the configured base into the two pieces it needs.
 *
 * `VITE_API_BASE` defaults to "/api"; the realtime path is that base + "/realtime".
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/** The socket.io `path` option (e.g. "/api/realtime"). */
export function realtimePath(base: string = API_BASE): string {
  return `${base.replace(/\/$/, "")}/realtime`;
}

/**
 * The origin socket.io should connect to. For a relative API base we connect to
 * the same origin (empty string = current origin); for an absolute base we use
 * its origin.
 */
export function realtimeOrigin(
  base: string = API_BASE,
  windowOrigin: string | undefined = typeof window !== "undefined"
    ? window.location.origin
    : undefined,
): string {
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return new URL(base).origin;
  }
  return windowOrigin ?? "";
}
