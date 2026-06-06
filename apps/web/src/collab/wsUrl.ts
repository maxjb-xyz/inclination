/**
 * Resolve the collaboration websocket URL.
 *
 * `VITE_COLLAB_URL` defaults to "/collab" (proxied to the sync server in dev,
 * same-origin in prod). HocuspocusProvider needs an absolute ws/wss URL, so a
 * relative value is resolved against the current page origin and the scheme is
 * mapped http->ws / https->wss. An already-absolute ws(s):// (or http(s)://)
 * value is honored as-is so deployments can point at a separate sync host.
 */

/** The configured collab path/URL, defaulting to "/collab". */
export function collabUrlSetting(): string {
  return import.meta.env.VITE_COLLAB_URL ?? "/collab";
}

/**
 * Build the absolute websocket URL the provider should connect to.
 *
 * @param setting   The configured value (e.g. "/collab" or "wss://host/collab").
 * @param origin    The page origin (e.g. "https://app.example.com"); injected
 *                  for testability — defaults to `window.location.origin`.
 */
export function buildCollabWsUrl(
  setting: string = collabUrlSetting(),
  origin: string = typeof window !== "undefined" ? window.location.origin : "http://localhost",
): string {
  // Absolute ws/wss URL — use verbatim.
  if (setting.startsWith("ws://") || setting.startsWith("wss://")) {
    return setting;
  }
  // Absolute http/https URL — swap scheme to ws/wss.
  if (setting.startsWith("http://")) {
    return `ws://${setting.slice("http://".length)}`;
  }
  if (setting.startsWith("https://")) {
    return `wss://${setting.slice("https://".length)}`;
  }
  // Relative path — resolve against origin, mapping the origin's scheme.
  const url = new URL(setting, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Drop any trailing slash the URL constructor may add for a bare origin.
  return url.toString().replace(/\/$/, setting.endsWith("/") ? "/" : "");
}
