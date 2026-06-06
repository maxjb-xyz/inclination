import type { CellValue } from "./dbTypes";

/** The columns are id'd `col:{groupKey}` so droppable ids don't clash with rows. */
export const BOARD_COLUMN_PREFIX = "col:";

/**
 * Compute the cell value to PUT when a board card is dropped into a column.
 * The group `key` produced by the query engine is the option id (or the empty
 * string for the "no value" column), so dropping onto a column means setting the
 * grouping property to that option (or clearing it). Returns `null` to clear.
 *
 * Pure + exported so the board's drop handler can be unit-tested without DnD.
 */
export function moveCardValue(targetGroupKey: string): CellValue {
  return targetGroupKey === "" ? null : targetGroupKey;
}

/** The result of a board drop: which cell to set, to what value. */
export interface BoardDrop {
  rowId: string;
  value: CellValue;
}

/**
 * Resolve a dnd-kit drag-end into the cell mutation it implies, or `null` when
 * the card was dropped outside any column. `activeId` is the dragged row's page
 * id; `overId` is the droppable column id (`col:{groupKey}`). Pure for testing.
 */
export function boardDrop(activeId: string, overId: string | null): BoardDrop | null {
  if (overId === null) return null;
  const groupKey = overId.startsWith(BOARD_COLUMN_PREFIX)
    ? overId.slice(BOARD_COLUMN_PREFIX.length)
    : overId;
  return { rowId: activeId, value: moveCardValue(groupKey) };
}
