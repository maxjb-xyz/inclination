/**
 * Shared URL guard for user-supplied media URLs.
 *
 * The custom media nodes (file / video / bookmark / embed) take a raw URL typed
 * by the user and flow it into `href`/`src`/`iframe src`. Without validation a
 * `javascript:` href or `data:text/html` iframe src would execute script in the
 * app origin — a stored XSS that also syncs to every collaborator via Yjs.
 *
 * Defense in depth: only absolute `http:`/`https:` URLs are permitted. Everything
 * else — `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, relative paths,
 * and unparseable garbage — is rejected. Parsing with the WHATWG `URL` constructor
 * normalizes away whitespace/control-character obfuscation (e.g. `java\tscript:`)
 * before the scheme is checked.
 */

/** Schemes we allow media URLs to use. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * True only when `u` is an absolute `http:`/`https:` URL. Rejects every other
 * scheme (including `javascript:`/`data:`/`vbscript:`/`file:`/`blob:`), relative
 * URLs, empty strings, and anything `new URL` cannot parse.
 */
export function isSafeUrl(u: unknown): boolean {
  if (typeof u !== "string") return false;
  const trimmed = u.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    // No base: relative URLs (and garbage) throw and are rejected.
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

/**
 * Returns the URL when {@link isSafeUrl} accepts it, otherwise `undefined`.
 * Use at render time to gate `href`/`src` so an unsafe (possibly pre-existing or
 * synced) value never reaches the DOM.
 */
export function safeUrl(u: unknown): string | undefined {
  return isSafeUrl(u) ? (u as string).trim() : undefined;
}
