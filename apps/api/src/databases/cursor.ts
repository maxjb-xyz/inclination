/**
 * Cursor pagination over an already-ordered list of rows.
 *
 * The query pipeline filters → sorts → (optionally) groups rows entirely in
 * memory for a request, then paginates the flat ordered list with a stable
 * cursor. The cursor is simply the page id of the last row returned; the next
 * page begins after that id's position in the ordered list. This is robust to
 * the list being recomputed between requests as long as ordering is stable.
 */

export interface Page<Row> {
  items: Row[];
  nextCursor: string | null;
}

/**
 * Slice an ordered list into a page. `cursor` is the id of the last item from
 * the previous page; results begin after it. If the cursor is not found (row
 * deleted/moved), pagination restarts from the beginning to avoid silently
 * dropping rows. `nextCursor` is null when the page reaches the end.
 */
export function paginate<Row>(
  ordered: Row[],
  idOf: (row: Row) => string,
  limit: number,
  cursor?: string | null,
): Page<Row> {
  let start = 0;
  if (cursor) {
    const idx = ordered.findIndex((r) => idOf(r) === cursor);
    start = idx === -1 ? 0 : idx + 1;
  }
  const items = ordered.slice(start, start + limit);
  const end = start + items.length;
  const nextCursor =
    end < ordered.length && items.length > 0 ? idOf(items[items.length - 1]!) : null;
  return { items, nextCursor };
}
