/**
 * Property value model — a normalized representation of a cell value per
 * {@link PropertyType}, plus validation/normalization.
 *
 * Pure: no Prisma/HTTP/Date.now. Time-dependent property *types*
 * (created_time/last_edited_*) are computed elsewhere; this module only
 * validates & normalizes the *settable* types.
 */

import {
  COMPUTED_PROPERTY_TYPES,
  type PropertyType,
  type SelectConfig,
  type MultiSelectConfig,
  type StatusConfig,
  type NumberConfig,
  type DateConfig,
  type PropertyOption,
} from "@inclination/shared";

// ── Normalized cell value shapes ──────────────────────────────

/** A date cell value. `start` (and optional `end`) are ISO-8601 strings. */
export interface DateValue {
  start: string;
  end?: string;
  includeTime?: boolean;
}

/** A single uploaded file reference on a `files` cell. */
export interface FileValue {
  /** Object storage key or external URL. */
  url: string;
  name?: string;
}

/**
 * The normalized value union. `null` always represents an empty cell. Each
 * settable property type maps to exactly one of these shapes.
 */
export type CellValue =
  | string // text, url, email, phone, select, status (option id)
  | number // number
  | boolean // checkbox
  | string[] // multi_select (option ids), person (user ids)
  | DateValue // date
  | FileValue[] // files
  | null;

/** Error thrown when a value cannot be normalized for its property type. */
export class CellValidationError extends Error {
  constructor(
    public readonly propertyType: PropertyType,
    message: string,
  ) {
    super(message);
    this.name = "CellValidationError";
  }
}

const COMPUTED = new Set<string>(COMPUTED_PROPERTY_TYPES);

/**
 * True for property types whose value is computed/derived server-side and is
 * never set directly (formula, rollup, created_*, last_edited_*).
 */
export function isComputed(type: PropertyType): boolean {
  return COMPUTED.has(type);
}

// ── Helpers ───────────────────────────────────────────────────

function fail(type: PropertyType, message: string): never {
  throw new CellValidationError(type, message);
}

function isEmptyInput(value: unknown): boolean {
  return value === null || value === undefined;
}

function optionIds(config: { options?: PropertyOption[] } | undefined): Set<string> {
  return new Set((config?.options ?? []).map((o) => o.id));
}

function asString(type: PropertyType, value: unknown): string {
  if (typeof value !== "string") fail(type, `expected a string, got ${typeofLabel(value)}`);
  return value;
}

function typeofLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function normalizeIsoDate(type: PropertyType, value: unknown): string {
  if (typeof value === "number") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) fail(type, "invalid date timestamp");
    return d.toISOString();
  }
  if (typeof value !== "string") fail(type, `expected a date string, got ${typeofLabel(value)}`);
  const trimmed = value.trim();
  if (!ISO_RE.test(trimmed)) fail(type, `invalid ISO date: "${value}"`);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) fail(type, `invalid date: "${value}"`);
  return trimmed;
}

// ── Per-type normalization ────────────────────────────────────

/**
 * Validate and normalize a raw cell input for a property `type`/`config`.
 *
 * - Returns `null` for an empty value (null/undefined, or empty array/string
 *   where that is the natural "cleared" state).
 * - Throws {@link CellValidationError} for type mismatches or unknown options.
 * - Throws for computed types (they are never set directly).
 *
 * @param type   the property type
 * @param config the property's config (option lists, date settings, …)
 * @param value  the raw JSON value to normalize
 */
export function validateCellValue(
  type: PropertyType,
  config: unknown,
  value: unknown,
): CellValue {
  if (isComputed(type)) {
    fail(type, `property type "${type}" is computed and cannot be set directly`);
  }

  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone": {
      if (isEmptyInput(value)) return null;
      const s = asString(type, value);
      return s.length === 0 ? null : s;
    }

    case "number": {
      if (isEmptyInput(value)) return null;
      const cfg = config as NumberConfig | undefined;
      let n: number;
      if (typeof value === "number") {
        n = value;
      } else if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        n = Number(value);
      } else {
        fail(type, `expected a number, got ${typeofLabel(value)}`);
      }
      if (!Number.isFinite(n)) fail(type, "number must be finite");
      if (cfg?.precision !== undefined) {
        const factor = 10 ** cfg.precision;
        n = Math.round(n * factor) / factor;
      }
      return n;
    }

    case "checkbox": {
      if (isEmptyInput(value)) return false; // checkbox empty === unchecked
      if (typeof value !== "boolean") fail(type, `expected a boolean, got ${typeofLabel(value)}`);
      return value;
    }

    case "select":
    case "status": {
      if (isEmptyInput(value)) return null;
      const id = asString(type, value);
      if (id.length === 0) return null;
      const ids = optionIds(config as SelectConfig | StatusConfig | undefined);
      if (!ids.has(id)) fail(type, `unknown option id "${id}"`);
      return id;
    }

    case "multi_select": {
      if (isEmptyInput(value)) return null;
      if (!Array.isArray(value)) fail(type, `expected an array of option ids, got ${typeofLabel(value)}`);
      const ids = optionIds(config as MultiSelectConfig | undefined);
      const out: string[] = [];
      const seen = new Set<string>();
      for (const raw of value) {
        const id = asString(type, raw);
        if (!ids.has(id)) fail(type, `unknown option id "${id}"`);
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      return out.length === 0 ? null : out;
    }

    case "person": {
      if (isEmptyInput(value)) return null;
      if (!Array.isArray(value)) fail(type, `expected an array of user ids, got ${typeofLabel(value)}`);
      const out: string[] = [];
      const seen = new Set<string>();
      for (const raw of value) {
        const id = asString(type, raw);
        if (id.length === 0) fail(type, "user id must be non-empty");
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      return out.length === 0 ? null : out;
    }

    case "date": {
      if (isEmptyInput(value)) return null;
      const cfg = config as DateConfig | undefined;
      // Accept a bare ISO string/number as {start}.
      if (typeof value === "string" || typeof value === "number") {
        return { start: normalizeIsoDate(type, value) };
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        fail(type, `expected a date object {start, end?}, got ${typeofLabel(value)}`);
      }
      const obj = value as Record<string, unknown>;
      if (isEmptyInput(obj.start)) return null;
      const out: DateValue = { start: normalizeIsoDate(type, obj.start) };
      if (!isEmptyInput(obj.end)) {
        if (cfg && cfg.endDate === false) fail(type, "this date property does not allow an end date");
        out.end = normalizeIsoDate(type, obj.end);
        if (new Date(out.end).getTime() < new Date(out.start).getTime()) {
          fail(type, "date end must not be before start");
        }
      }
      if (typeof obj.includeTime === "boolean") out.includeTime = obj.includeTime;
      return out;
    }

    case "files": {
      if (isEmptyInput(value)) return null;
      if (!Array.isArray(value)) fail(type, `expected an array of files, got ${typeofLabel(value)}`);
      const out: FileValue[] = [];
      for (const raw of value) {
        if (typeof raw === "string") {
          if (raw.length === 0) fail(type, "file url must be non-empty");
          out.push({ url: raw });
          continue;
        }
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          fail(type, "each file must be a url string or {url, name?}");
        }
        const f = raw as Record<string, unknown>;
        const url = asString(type, f.url);
        if (url.length === 0) fail(type, "file url must be non-empty");
        const file: FileValue = { url };
        if (typeof f.name === "string") file.name = f.name;
        out.push(file);
      }
      return out.length === 0 ? null : out;
    }

    // relation values are managed via RelationLink rows, not set as a cell.
    case "relation":
      fail(type, "relation values are managed via relation links, not set as a cell");

    default:
      fail(type, `unsupported property type "${type}"`);
  }
}
