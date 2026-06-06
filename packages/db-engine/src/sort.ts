/**
 * Sort engine — stable, multi-key typed comparison of rows.
 *
 * Pure. Empty values sort last (in both directions) so missing data sinks to
 * the bottom — matching Notion behaviour.
 */

import type { PropertyType, Sort } from "@inclination/shared";
import type { CellValue, DateValue } from "./property-value";

/** Resolves the normalized value and type of a property for a given row. */
export interface SortAccessors<Row> {
  getValue(row: Row, propertyId: string): CellValue;
  getType(propertyId: string): PropertyType;
  /**
   * Optional ordering hint for select/status: maps an option id → its index in
   * the option list. Lower index sorts first. Missing → fall back to text.
   */
  getOptionOrder?(propertyId: string, optionId: string): number | undefined;
}

function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return !(value as DateValue).start;
  return false;
}

function dateMs(value: CellValue): number {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const t = new Date((value as DateValue).start).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

/**
 * Compare two cell values of a known property type. Returns <0 / 0 / >0.
 * Empties are treated as equal (and handled as "last" by the caller).
 */
function compareTyped<Row>(
  type: PropertyType,
  propertyId: string,
  a: CellValue,
  b: CellValue,
  acc: SortAccessors<Row>,
): number {
  switch (type) {
    case "number": {
      const an = typeof a === "number" ? a : NaN;
      const bn = typeof b === "number" ? b : NaN;
      return an === bn ? 0 : an < bn ? -1 : 1;
    }
    case "checkbox": {
      // unchecked (false) before checked (true)
      const av = a === true ? 1 : 0;
      const bv = b === true ? 1 : 0;
      return av - bv;
    }
    case "date":
    case "created_time":
    case "last_edited_time": {
      const am = dateMs(a);
      const bm = dateMs(b);
      return am === bm ? 0 : am < bm ? -1 : 1;
    }
    case "select":
    case "status": {
      if (typeof a === "string" && typeof b === "string" && acc.getOptionOrder) {
        const ao = acc.getOptionOrder(propertyId, a);
        const bo = acc.getOptionOrder(propertyId, b);
        if (ao !== undefined && bo !== undefined) return ao - bo;
      }
      return collate(toText(a), toText(b));
    }
    default:
      return collate(toText(a), toText(b));
  }
}

function toText(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : "")).join(",");
  if (typeof value === "object") return (value as DateValue).start ?? "";
  return "";
}

function collate(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Stable multi-key sort. Returns a new array; the input is not mutated. For
 * each sort key, empty values are pushed to the end regardless of direction;
 * ties fall through to the next key, then to original index (stability).
 */
export function sortRows<Row>(rows: Row[], sorts: Sort[], acc: SortAccessors<Row>): Row[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((x, y) => {
    for (const sort of sorts) {
      const type = acc.getType(sort.propertyId);
      const av = acc.getValue(x.row, sort.propertyId);
      const bv = acc.getValue(y.row, sort.propertyId);
      const ae = isEmpty(av);
      const be = isEmpty(bv);
      if (ae && be) continue;
      if (ae) return 1; // empty last
      if (be) return -1;
      const cmp = compareTyped(type, sort.propertyId, av, bv, acc);
      if (cmp !== 0) return sort.direction === "desc" ? -cmp : cmp;
    }
    return x.index - y.index; // stable
  });
  return indexed.map((i) => i.row);
}
