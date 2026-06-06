/**
 * Detect the unauthenticated public-page route from a pathname.
 *
 * The SPA has no router; the app shell calls this against
 * `window.location.pathname` BEFORE the auth gate so `/public/:slug` renders for
 * logged-out visitors. Returns the decoded slug, or null for any other path.
 */
export function publicSlugFromPath(pathname: string): string | null {
  const match = /^\/public\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}
