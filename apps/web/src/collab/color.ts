/**
 * Deterministic presence colors derived from a user id.
 *
 * CollaborationCursor renders a remote user's caret/selection in their color;
 * deriving it from the (stable) user id means the same person always gets the
 * same color across sessions and across other clients, without any server round
 * trip. Pure + deterministic so it can be unit tested.
 */

/**
 * A small, hand-picked palette with good contrast against a white editor and
 * against each other. Indexing into a fixed palette (rather than emitting an
 * arbitrary hex) keeps cursors readable and avoids near-white colors.
 */
export const PRESENCE_PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#d97706", // amber
  "#9333ea", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
] as const;

/**
 * Hash a string into a non-negative 32-bit integer (FNV-1a). Stable across
 * runs and platforms — same input always yields the same number.
 */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned 32-bit.
  return hash >>> 0;
}

/**
 * Map a user id to a stable color from {@link PRESENCE_PALETTE}. The same id
 * always returns the same color; an empty id falls back to the first entry.
 */
export function colorForUserId(userId: string): string {
  if (!userId) return PRESENCE_PALETTE[0];
  const index = hashString(userId) % PRESENCE_PALETTE.length;
  // Index is always in-bounds (modulo length); the fallback satisfies the
  // noUncheckedIndexedAccess type and is never reached at runtime.
  return PRESENCE_PALETTE[index] ?? PRESENCE_PALETTE[0];
}
