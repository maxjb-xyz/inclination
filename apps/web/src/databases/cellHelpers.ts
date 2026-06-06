import type {
  MultiSelectConfig,
  PropertyOption,
  SelectConfig,
  StatusConfig,
} from "@inclination/shared";
import type {
  CellValue,
  ComputedValue,
  DateValue,
  FileValue,
  Property,
  RollupResult,
} from "./dbTypes";
import { isFormulaError } from "./dbTypes";

/** Options carried by select/multi_select/status configs. */
export function propertyOptions(prop: Property): PropertyOption[] {
  const cfg = prop.config as Partial<SelectConfig & MultiSelectConfig & StatusConfig>;
  return cfg.options ?? [];
}

export function optionById(prop: Property, id: string): PropertyOption | undefined {
  return propertyOptions(prop).find((o) => o.id === id);
}

/** True for property types whose value is computed and read-only in the UI. */
export function isComputedType(prop: Property): boolean {
  return (
    prop.type === "rollup" ||
    prop.type === "formula" ||
    prop.type === "relation" ||
    prop.type === "created_time" ||
    prop.type === "created_by" ||
    prop.type === "last_edited_time" ||
    prop.type === "last_edited_by"
  );
}

/** Human-readable label for a settable cell value (table/board/gallery text). */
export function formatCellValue(prop: Property, value: CellValue): string {
  if (value === null || value === undefined) return "";
  switch (prop.type) {
    case "checkbox":
      return value ? "✓" : "";
    case "select":
    case "status": {
      const opt = typeof value === "string" ? optionById(prop, value) : undefined;
      return opt?.name ?? (typeof value === "string" ? value : "");
    }
    case "multi_select": {
      if (!Array.isArray(value)) return "";
      return value
        .map((id) => optionById(prop, String(id))?.name ?? String(id))
        .join(", ");
    }
    case "date":
      return formatDate(value as DateValue);
    case "files":
      return Array.isArray(value)
        ? (value as FileValue[]).map((f) => f.name ?? f.url).join(", ")
        : "";
    case "person":
      return Array.isArray(value) ? value.join(", ") : "";
    case "number":
      return typeof value === "number" ? String(value) : "";
    default:
      return typeof value === "string" ? value : String(value);
  }
}

export function formatDate(value: DateValue | null): string {
  if (!value || !value.start) return "";
  return value.end ? `${value.start} → ${value.end}` : value.start;
}

/** Human-readable label for a computed value (rollup/formula/created/etc.). */
export function formatComputedValue(prop: Property, value: ComputedValue): string {
  if (value === null || value === undefined) return "";
  if (prop.type === "formula") {
    if (isFormulaError(value)) return `⚠ ${value.error}`;
    return String(value);
  }
  if (prop.type === "rollup") return formatRollup(value as RollupResult);
  if (prop.type === "relation") {
    return Array.isArray(value) ? `${value.length} linked` : "";
  }
  // created_by / last_edited_by → a user id; created_time / last_edited_time → iso.
  return String(value);
}

function formatRollup(value: RollupResult): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map((v) => String(v ?? "")).join(", ");
  return String(value);
}
