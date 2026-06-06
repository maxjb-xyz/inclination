import type { CellValue, QueryRowsResult } from "./dbTypes";

/** A realtime event mirroring the API's `DatabaseEvent` (T4). */
export interface DatabaseEvent {
  databaseId: string;
  type:
    | "cell.updated"
    | "row.created"
    | "row.deleted"
    | "property.created"
    | "property.updated"
    | "property.deleted"
    | "property.reordered"
    | "view.created"
    | "view.updated"
    | "view.deleted"
    | "database.updated"
    | "relation.linked"
    | "relation.unlinked";
  payload: Record<string, unknown>;
  actorId?: string;
}

/**
 * Pure cache-patch reducer for a `database:event`. Given the currently-cached
 * query result and an event, returns the patched result (or the same reference
 * when nothing applies). Kept side-effect-free so it is exhaustively unit-tested
 * without a socket or query client.
 *
 * Only `cell.updated` can be applied in place against a query result; row
 * additions/removals, relation changes and structural changes (property/view)
 * require a refetch (the caller invalidates the query for those), so this
 * reducer returns `null` to signal "refetch needed".
 */
export function patchQueryResult(
  current: QueryRowsResult | undefined,
  event: DatabaseEvent,
): QueryRowsResult | null {
  if (!current) return null;

  if (event.type === "cell.updated") {
    const rowPageId = event.payload.rowPageId as string | undefined;
    const propertyId = event.payload.propertyId as string | undefined;
    if (!rowPageId || !propertyId) return current;
    const value = event.payload.value as CellValue;

    let changed = false;
    const rows = current.rows.map((row) => {
      if (row.pageId !== rowPageId) return row;
      changed = true;
      return { ...row, cells: { ...row.cells, [propertyId]: value } };
    });
    // The row isn't in this page of results (pagination/filtering) — leave as-is.
    if (!changed) return current;
    return { ...current, rows };
  }

  // Anything that adds/removes rows or changes structure can't be patched in
  // place reliably (it affects grouping, ordering, computed values). Signal a
  // refetch instead.
  return null;
}
