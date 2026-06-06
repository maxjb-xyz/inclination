/**
 * Group engine — partition rows by a property into ordered groups.
 *
 * Pure. Group ordering follows the property's option order (select/status),
 * checked-then-unchecked (checkbox), or first-seen order (person/text). A
 * trailing "No value" group collects empty cells.
 */

import type { PropertyType } from "@inclination/shared";
import type { CellValue, DateValue } from "./property-value";

/** One ordered group of rows sharing a group key. */
export interface RowGroup<Row> {
  /** Stable group key: an option id, user id, "true"/"false", or "" for empty. */
  key: string;
  /** Human-readable label hint (option id / user id / "Checked" / "No value"). */
  label: string;
  /** True for the trailing empty/"No value" bucket. */
  isEmpty: boolean;
  rows: Row[];
}

export interface GroupAccessors<Row> {
  getValue(row: Row, propertyId: string): CellValue;
  getType(propertyId: string): PropertyType;
  /**
   * Optional explicit ordering of group keys (e.g. select/status option ids in
   * config order). Groups appear in this order; unknown keys follow in
   * first-seen order; the empty group is always last.
   */
  getGroupOrder?(propertyId: string): string[] | undefined;
}

export interface GroupOptions {
  /** Emit groups with no rows for every key in `getGroupOrder` (board columns). */
  includeEmptyGroups?: boolean;
}

const EMPTY_KEY = "";

function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return !(value as DateValue).start;
  return false;
}

/**
 * Map a row's cell value to one or more group keys. A multi-valued property
 * (multi_select/person) places the row into every matching group.
 */
function keysFor(type: PropertyType, value: CellValue): string[] {
  if (isEmpty(value) && type !== "checkbox") return [EMPTY_KEY];
  switch (type) {
    case "checkbox":
      return [value === true ? "true" : "false"];
    case "select":
    case "status":
      return typeof value === "string" ? [value] : [EMPTY_KEY];
    case "multi_select":
    case "person":
    case "relation":
      return Array.isArray(value) && value.length > 0
        ? value.filter((v): v is string => typeof v === "string")
        : [EMPTY_KEY];
    default:
      return typeof value === "string" ? [value] : [EMPTY_KEY];
  }
}

function labelFor(type: PropertyType, key: string): string {
  if (key === EMPTY_KEY) return "No value";
  if (type === "checkbox") return key === "true" ? "Checked" : "Unchecked";
  return key;
}

/**
 * Group `rows` by `propertyId`. Returns ordered groups; the empty/"No value"
 * group (and "Unchecked" for checkbox) sorts last. Rows in multi-valued
 * properties appear in each matching group.
 */
export function groupRows<Row>(
  rows: Row[],
  propertyId: string,
  acc: GroupAccessors<Row>,
  options: GroupOptions = {},
): RowGroup<Row>[] {
  const type = acc.getType(propertyId);
  const buckets = new Map<string, Row[]>();
  const firstSeen: string[] = [];

  const touch = (key: string) => {
    if (!buckets.has(key)) {
      buckets.set(key, []);
      firstSeen.push(key);
    }
    return buckets.get(key)!;
  };

  // Seed configured groups so they appear even when empty (if requested).
  const configured = acc.getGroupOrder?.(propertyId);
  if (options.includeEmptyGroups && configured) {
    if (type === "checkbox") {
      touch("true");
      touch("false");
    } else {
      for (const k of configured) touch(k);
    }
  }

  for (const row of rows) {
    const value = acc.getValue(row, propertyId);
    for (const key of keysFor(type, value)) {
      touch(key).push(row);
    }
  }

  // Determine ordering.
  const orderIndex = new Map<string, number>();
  if (type === "checkbox") {
    orderIndex.set("true", 0);
    orderIndex.set("false", 1);
  } else if (configured) {
    configured.forEach((k, i) => orderIndex.set(k, i));
  }

  const keys = Array.from(buckets.keys());
  keys.sort((a, b) => {
    if (a === EMPTY_KEY) return 1; // empty always last
    if (b === EMPTY_KEY) return -1;
    const ai = orderIndex.get(a);
    const bi = orderIndex.get(b);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return firstSeen.indexOf(a) - firstSeen.indexOf(b);
  });

  return keys.map((key) => ({
    key,
    label: labelFor(type, key),
    isEmpty: key === EMPTY_KEY,
    rows: buckets.get(key)!,
  }));
}
