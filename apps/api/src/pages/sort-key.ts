import { generateKeyBetween } from "fractional-indexing";

/** A sibling page reduced to the fields needed for ordering. */
export interface SortableSibling {
  id: string;
  sortKey: string;
}

/**
 * Computes a fractional-index `sortKey` that places a page between optional
 * `before`/`after` siblings within an already-sorted list of siblings.
 *
 * - `beforeId` is the sibling the moved page should come AFTER.
 * - `afterId` is the sibling the moved page should come BEFORE.
 *
 * Only the relevant bounds are derived from the sibling list; unspecified
 * anchors fall back to the list edges (append to end when neither is given).
 * The list MUST be sorted ascending by `sortKey` and MUST exclude the page
 * being moved.
 */
export function computeSortKey(
  siblings: SortableSibling[],
  beforeId?: string | null,
  afterId?: string | null,
): string {
  const sorted = [...siblings].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  let lower: string | null = null;
  let upper: string | null = null;

  if (beforeId) {
    const idx = sorted.findIndex((s) => s.id === beforeId);
    if (idx === -1) throw new Error("beforeId is not a sibling");
    lower = sorted[idx]!.sortKey;
    upper = sorted[idx + 1]?.sortKey ?? null;
  } else if (afterId) {
    const idx = sorted.findIndex((s) => s.id === afterId);
    if (idx === -1) throw new Error("afterId is not a sibling");
    upper = sorted[idx]!.sortKey;
    lower = sorted[idx - 1]?.sortKey ?? null;
  } else {
    // No anchors: append at the end.
    lower = sorted.at(-1)?.sortKey ?? null;
    upper = null;
  }

  return generateKeyBetween(lower, upper);
}
