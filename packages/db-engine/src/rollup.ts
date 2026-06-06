/**
 * Rollup engine — aggregate a list of target-property values from related rows.
 *
 * Pure. `computeRollup` takes the chosen aggregation, the raw normalized values
 * of the target property across linked rows, and the target property type. It
 * returns a scalar (number/boolean/date/string) or, for `show_original`, the
 * original list. Numeric aggregations ignore non-numbers; date aggregations
 * operate on date values.
 */

import type { Aggregation, PropertyType } from "@inclination/shared";
import type { CellValue, DateValue } from "./property-value";

/** A rollup result: a scalar, a date ISO string, or the original values list. */
export type RollupResult = number | boolean | string | null | CellValue[];

export class RollupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollupError";
  }
}

function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return !(value as DateValue).start;
  return false;
}

/** Extract finite numbers from values, skipping anything non-numeric. */
function numbers(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function dateMsList(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    let ms = NaN;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) ms = new Date((v as DateValue).start).getTime();
    else if (typeof v === "string") ms = new Date(v).getTime();
    if (!Number.isNaN(ms)) out.push(ms);
  }
  return out;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Count of "checked" values for percent_checked when target is a checkbox. */
function isChecked(v: CellValue): boolean {
  return v === true;
}

/**
 * Compute an aggregation over `targetValues` (the normalized cell values of the
 * target property across all linked rows) given the target property `type`.
 */
export function computeRollup(
  aggregation: Aggregation,
  targetValues: CellValue[],
  type: PropertyType,
): RollupResult {
  const total = targetValues.length;
  const nonEmpty = targetValues.filter((v) => !isEmpty(v));

  switch (aggregation) {
    case "count":
      return total;
    case "count_values":
      // count of populated cells, counting each element of multi-valued cells
      return nonEmpty.reduce<number>((acc, v) => acc + (Array.isArray(v) ? v.length : 1), 0);
    case "count_unique": {
      const set = new Set<string>();
      for (const v of nonEmpty) {
        if (Array.isArray(v)) v.forEach((x) => set.add(JSON.stringify(x)));
        else set.add(JSON.stringify(v));
      }
      return set.size;
    }
    case "count_empty":
      return total - nonEmpty.length;
    case "count_not_empty":
      return nonEmpty.length;

    case "sum": {
      const nums = numbers(targetValues);
      return nums.reduce((a, b) => a + b, 0);
    }
    case "avg": {
      const nums = numbers(targetValues);
      return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case "median": {
      return median(numbers(targetValues));
    }
    case "min": {
      if (type === "date" || type === "created_time" || type === "last_edited_time") {
        const ms = dateMsList(targetValues);
        return ms.length === 0 ? null : new Date(Math.min(...ms)).toISOString();
      }
      const nums = numbers(targetValues);
      return nums.length === 0 ? null : Math.min(...nums);
    }
    case "max": {
      if (type === "date" || type === "created_time" || type === "last_edited_time") {
        const ms = dateMsList(targetValues);
        return ms.length === 0 ? null : new Date(Math.max(...ms)).toISOString();
      }
      const nums = numbers(targetValues);
      return nums.length === 0 ? null : Math.max(...nums);
    }
    case "range": {
      if (type === "date" || type === "created_time" || type === "last_edited_time") {
        const ms = dateMsList(targetValues);
        // range over dates → milliseconds difference
        return ms.length === 0 ? null : Math.max(...ms) - Math.min(...ms);
      }
      const nums = numbers(targetValues);
      return nums.length === 0 ? null : Math.max(...nums) - Math.min(...nums);
    }

    case "earliest": {
      const ms = dateMsList(targetValues);
      return ms.length === 0 ? null : new Date(Math.min(...ms)).toISOString();
    }
    case "latest": {
      const ms = dateMsList(targetValues);
      return ms.length === 0 ? null : new Date(Math.max(...ms)).toISOString();
    }

    case "percent_checked": {
      if (total === 0) return null;
      const checked = targetValues.filter(isChecked).length;
      return checked / total;
    }
    case "percent_unchecked": {
      if (total === 0) return null;
      const checked = targetValues.filter(isChecked).length;
      return (total - checked) / total;
    }
    case "percent_empty": {
      if (total === 0) return null;
      return (total - nonEmpty.length) / total;
    }
    case "percent_not_empty": {
      if (total === 0) return null;
      return nonEmpty.length / total;
    }

    case "show_original":
      return targetValues;

    default:
      throw new RollupError(`unsupported aggregation "${aggregation as string}"`);
  }
}
