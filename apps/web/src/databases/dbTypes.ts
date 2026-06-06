import type {
  PropertyType,
  ViewType,
  ViewConfig,
  PropertyConfig,
} from "@inclination/shared";
import type { Page } from "../api/types";

/**
 * Web-side mirrors of the database value shapes. The web app deliberately does
 * not depend on `@inclination/db-engine` (a server package), so the cell/value
 * shapes it produces and reads are redeclared here to match the API contract.
 */

/** A date cell value. `start` (and optional `end`) are ISO-8601 strings. */
export interface DateValue {
  start: string;
  end?: string;
  includeTime?: boolean;
}

/** A single file reference on a `files` cell. */
export interface FileValue {
  url: string;
  name?: string;
}

/** A settable cell value (mirrors the engine's `CellValue`). `null` = empty. */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | DateValue
  | FileValue[]
  | null;

/** A rollup aggregation result. */
export type RollupResult = number | boolean | string | null | CellValue[];

/** A formula evaluation result (or an error sentinel). */
export type FormulaValue = number | string | boolean | null | { error: string };

/** A computed value: relation ids, rollup, formula, or a single user id. */
export type ComputedValue = string[] | RollupResult | FormulaValue | string | null;

/** Computed values for a row, keyed by propertyId. */
export type ComputedValues = Record<string, ComputedValue>;

export function isFormulaError(v: unknown): v is { error: string } {
  return typeof v === "object" && v !== null && "error" in (v as object);
}

/** A database property (column). */
export interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  order: number;
  isPrimary: boolean;
}

/** A saved view. */
export interface View {
  id: string;
  databaseId: string;
  type: ViewType;
  name: string;
  order: number;
  config: ViewConfig;
}

/** A database with its container page, properties and views. */
export interface Database {
  pageId: string;
  defaultViewId: string | null;
  subitemsEnabled: boolean;
  subitemsPropertyId: string | null;
  page: Page;
  properties: Property[];
  views: View[];
}

/** A row page (subset surfaced by list/create). */
export interface RowPage {
  id: string;
  parentId: string | null;
  title: string;
  sortKey?: string;
}

/** A row in a query result. */
export interface QueryResultRow {
  pageId: string;
  cells: Record<string, CellValue>;
  computed: ComputedValues;
}

/** A grouping bucket in a query result (board columns / grouped table). */
export interface QueryGroup {
  key: string;
  label: string;
  isEmpty: boolean;
  pageIds: string[];
}

/** The shape returned by POST /databases/:id/query. */
export interface QueryRowsResult {
  rows: QueryResultRow[];
  groups?: QueryGroup[];
  nextCursor: string | null;
}

/** The result of a cell PUT. */
export interface SetCellResult {
  rowPageId: string;
  propertyId: string;
  value: CellValue;
}
