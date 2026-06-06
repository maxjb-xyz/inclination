/**
 * Filter engine — evaluate an AND/OR tree of conditions against a single row.
 *
 * Pure: time-relative operators take an injected `now` (no Date.now). Operators
 * are dispatched by the *property type* of each condition's target, using the
 * groupings in {@link FILTER_OPERATORS}.
 */

import {
  isFilterNode,
  type FilterCondition,
  type FilterNode,
  type PropertyType,
} from "@inclination/shared";
import type { CellValue, DateValue } from "./property-value";

/**
 * Resolves a row's data for the filter engine. `getValue` returns the
 * normalized cell value (see {@link CellValue}); `getType` returns the property
 * type so the engine can pick the right operator semantics.
 */
export interface FilterContext {
  getValue(propertyId: string): CellValue;
  getType(propertyId: string): PropertyType;
  /** Injected current time (ms epoch) for relative date operators. */
  now: number;
}

/** Thrown when a condition uses an operator unsupported by its property type. */
export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

// ── value helpers ─────────────────────────────────────────────

function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  // A date with a start is non-empty; an object without start is empty.
  if (typeof value === "object") return !(value as DateValue).start;
  // numbers / booleans are never "empty" (false is a real value)
  return false;
}

function asText(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  if (typeof value === "object") return (value as DateValue).start ?? "";
  return "";
}

function dateMs(value: CellValue): number | null {
  if (value === null) return null;
  if (typeof value === "object" && !Array.isArray(value) && (value as DateValue).start) {
    const t = new Date((value as DateValue).start).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function operandMs(operand: unknown): number | null {
  if (operand === null || operand === undefined) return null;
  if (typeof operand === "number") return operand;
  if (typeof operand === "string") {
    const t = new Date(operand).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof operand === "object") {
    const start = (operand as { start?: unknown }).start;
    if (typeof start === "string") {
      const t = new Date(start).getTime();
      return Number.isNaN(t) ? null : t;
    }
  }
  return null;
}

function membership(value: CellValue): string[] {
  if (value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

// ── per-type condition evaluation ─────────────────────────────

function evalText(op: string, value: CellValue, operand: unknown): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(value);
    case "is_not_empty":
      return !isEmpty(value);
  }
  const text = asText(value).toLowerCase();
  const target = operand == null ? "" : String(operand).toLowerCase();
  switch (op) {
    case "equals":
      return text === target;
    case "not_equals":
      return text !== target;
    case "contains":
      return text.includes(target);
    case "not_contains":
      return !text.includes(target);
    case "starts_with":
      return text.startsWith(target);
    case "ends_with":
      return text.endsWith(target);
    default:
      throw new FilterError(`unsupported text operator "${op}"`);
  }
}

function evalNumber(op: string, value: CellValue, operand: unknown): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(value);
    case "is_not_empty":
      return !isEmpty(value);
  }
  const n = typeof value === "number" ? value : null;
  const target = typeof operand === "number" ? operand : Number(operand);
  if (n === null || Number.isNaN(target)) {
    // a missing value never satisfies a comparison
    return op === "not_equals" ? n === null && !Number.isNaN(target) : false;
  }
  switch (op) {
    case "equals":
      return n === target;
    case "not_equals":
      return n !== target;
    case "greater_than":
      return n > target;
    case "greater_than_or_equal":
      return n >= target;
    case "less_than":
      return n < target;
    case "less_than_or_equal":
      return n <= target;
    default:
      throw new FilterError(`unsupported number operator "${op}"`);
  }
}

function evalSelect(op: string, value: CellValue, operand: unknown): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(value);
    case "is_not_empty":
      return !isEmpty(value);
    case "equals":
      return typeof value === "string" && value === operand;
    case "not_equals":
      return !(typeof value === "string" && value === operand);
    case "is_any_of": {
      const opts = Array.isArray(operand) ? operand : [];
      return typeof value === "string" && opts.includes(value);
    }
    default:
      throw new FilterError(`unsupported select operator "${op}"`);
  }
}

function evalMultiMembership(op: string, value: CellValue, operand: unknown): boolean {
  // multi_select / person / relation
  const items = membership(value);
  switch (op) {
    case "is_empty":
      return items.length === 0;
    case "is_not_empty":
      return items.length > 0;
    case "contains":
      return typeof operand === "string" && items.includes(operand);
    case "not_contains":
      return !(typeof operand === "string" && items.includes(operand));
    case "is_any_of": {
      const opts = Array.isArray(operand) ? operand : [];
      return items.some((i) => opts.includes(i));
    }
    default:
      throw new FilterError(`unsupported membership operator "${op}"`);
  }
}

function evalDate(op: string, value: CellValue, operand: unknown, now: number): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(value);
    case "is_not_empty":
      return !isEmpty(value);
  }
  const ms = dateMs(value);
  if (ms === null) return false;

  // relative operators inject `now`; they ignore `operand`.
  const relative = relativeRange(op, now);
  if (relative) {
    return ms >= relative.from && ms < relative.to;
  }

  const target = operandMs(operand);
  if (target === null) return false;
  switch (op) {
    case "equals":
      // same calendar instant (compare by day if both midnight-ish handled by caller)
      return ms === target;
    case "before":
      return ms < target;
    case "after":
      return ms > target;
    case "on_or_before":
      return ms <= target;
    case "on_or_after":
      return ms >= target;
    default:
      throw new FilterError(`unsupported date operator "${op}"`);
  }
}

/**
 * Explicit, deterministic relative-date windows computed from injected `now`
 * (UTC). Returns a half-open `[from, to)` range in ms, or null if `op` is not a
 * recognised relative operator.
 */
function relativeRange(op: string, now: number): { from: number; to: number } | null {
  const DAY = 86_400_000;
  const d = new Date(now);
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  switch (op) {
    case "is_today":
      return { from: startOfDay, to: startOfDay + DAY };
    case "is_yesterday":
      return { from: startOfDay - DAY, to: startOfDay };
    case "is_tomorrow":
      return { from: startOfDay + DAY, to: startOfDay + 2 * DAY };
    case "is_this_week": {
      // week starts Monday (UTC)
      const dow = (new Date(startOfDay).getUTCDay() + 6) % 7; // 0=Mon
      const from = startOfDay - dow * DAY;
      return { from, to: from + 7 * DAY };
    }
    case "is_past":
      return { from: -Infinity, to: startOfDay };
    case "is_future":
      return { from: startOfDay + DAY, to: Infinity };
    default:
      return null;
  }
}

function evalCheckbox(op: string, value: CellValue, operand: unknown): boolean {
  const checked = value === true;
  switch (op) {
    case "equals":
      return checked === Boolean(operand);
    case "checked":
      return checked;
    case "unchecked":
      return !checked;
    default:
      throw new FilterError(`unsupported checkbox operator "${op}"`);
  }
}

/** Operators valid for any property type regardless of category. */
function evalCondition(condition: FilterCondition, ctx: FilterContext): boolean {
  const { propertyId, operator, value: operand } = condition;
  const type = ctx.getType(propertyId);
  const value = ctx.getValue(propertyId);

  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return evalText(operator, value, operand);
    case "number":
      return evalNumber(operator, value, operand);
    case "select":
    case "status":
      return evalSelect(operator, value, operand);
    case "multi_select":
    case "person":
    case "relation":
      return evalMultiMembership(operator, value, operand);
    case "date":
    case "created_time":
    case "last_edited_time":
      return evalDate(operator, value, operand, ctx.now);
    case "checkbox":
      return evalCheckbox(operator, value, operand);
    case "created_by":
    case "last_edited_by":
      return evalMultiMembership(operator, value, operand);
    case "formula":
    case "rollup": {
      // computed values are dynamically typed; pick by the value's runtime shape
      if (typeof value === "number") return evalNumber(operator, value, operand);
      if (typeof value === "boolean") return evalCheckbox(operator, value, operand);
      if (Array.isArray(value)) return evalMultiMembership(operator, value, operand);
      if (value !== null && typeof value === "object") return evalDate(operator, value, operand, ctx.now);
      return evalText(operator, value, operand);
    }
    default:
      throw new FilterError(`no filter semantics for property type "${type}"`);
  }
}

/**
 * Evaluate a filter node (AND/OR tree, arbitrarily nested) against a row via
 * `ctx`. An empty `and` matches everything; an empty `or` matches nothing.
 */
export function evaluateFilter(node: FilterNode, ctx: FilterContext): boolean {
  const conj = node.conjunction;
  if (node.conditions.length === 0) return conj === "and";
  const results = node.conditions.map((child) =>
    isFilterNode(child) ? evaluateFilter(child, ctx) : evalCondition(child, ctx),
  );
  return conj === "and" ? results.every(Boolean) : results.some(Boolean);
}
