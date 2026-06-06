/** Product-wide constants shared across services. */

export const APP_NAME = "Inclination";

/** Workspace member roles (spec §5). */
export const WORKSPACE_ROLES = ["owner", "admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Page kinds — the universal node (spec §5). */
export const PAGE_TYPES = ["document", "database", "row"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Permission roles (spec §5). */
export const PERMISSION_ROLES = ["full", "edit", "comment", "read"] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];

// ─────────────────────────────────────────────────────────────
// Phase 5 — Databases / collections (spec §5)
// ─────────────────────────────────────────────────────────────

/** Database property (column) types (spec §5). */
export const PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "person",
  "checkbox",
  "url",
  "email",
  "phone",
  "files",
  "relation",
  "rollup",
  "formula",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * Property types whose value is computed/derived server-side rather than set
 * directly by a user. setCell must reject these (the engines in T2 own them).
 */
export const COMPUTED_PROPERTY_TYPES = [
  "rollup",
  "formula",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
] as const;
export type ComputedPropertyType = (typeof COMPUTED_PROPERTY_TYPES)[number];

/** Database view types (spec §5). */
export const VIEW_TYPES = ["table", "board", "calendar", "gallery"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/** Rollup aggregation functions (spec §5). */
export const AGGREGATIONS = [
  "count",
  "count_values",
  "count_unique",
  "count_empty",
  "count_not_empty",
  "sum",
  "avg",
  "median",
  "min",
  "max",
  "range",
  "show_original",
  "percent_checked",
  "percent_unchecked",
  "percent_empty",
  "percent_not_empty",
  "earliest",
  "latest",
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** Sort directions. */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Boolean conjunctions for the filter AND/OR tree (spec §5). */
export const FILTER_CONJUNCTIONS = ["and", "or"] as const;
export type FilterConjunction = (typeof FILTER_CONJUNCTIONS)[number];

/** Option colors for select/multi_select/status. */
export const PROPERTY_OPTION_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;
export type PropertyOptionColor = (typeof PROPERTY_OPTION_COLORS)[number];

/** Status option groups (To-do / In progress / Complete) (spec §5). */
export const STATUS_GROUPS = ["todo", "in_progress", "complete"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** Number display formats. */
export const NUMBER_FORMATS = [
  "number",
  "number_with_commas",
  "percent",
  "dollar",
  "euro",
  "pound",
  "yen",
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** Gallery card cover source. */
export const GALLERY_COVER_SOURCES = ["none", "files_property", "page_cover"] as const;
export type GalleryCoverSource = (typeof GALLERY_COVER_SOURCES)[number];

/** Gallery card sizes. */
export const GALLERY_CARD_SIZES = ["small", "medium", "large"] as const;
export type GalleryCardSize = (typeof GALLERY_CARD_SIZES)[number];

/**
 * Filter operators, grouped by the property-value category they apply to. T2's
 * filter engine evaluates these against a row's cells; the API/web reuse the
 * groupings to offer the right operators per property type.
 */
export const FILTER_OPERATORS = {
  text: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty",
  ],
  number: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "is_empty",
    "is_not_empty",
  ],
  select: ["equals", "not_equals", "is_empty", "is_not_empty"],
  multi_select: ["contains", "not_contains", "is_empty", "is_not_empty"],
  date: [
    "equals",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "is_empty",
    "is_not_empty",
  ],
  checkbox: ["equals"],
  person: ["contains", "not_contains", "is_empty", "is_not_empty"],
  relation: ["contains", "not_contains", "is_empty", "is_not_empty"],
} as const;

export type FilterOperatorCategory = keyof typeof FILTER_OPERATORS;
export type FilterOperator =
  (typeof FILTER_OPERATORS)[FilterOperatorCategory][number];

/** Flat set of every known filter operator across all categories. */
export const ALL_FILTER_OPERATORS = Array.from(
  new Set(Object.values(FILTER_OPERATORS).flat()),
) as FilterOperator[];

// ─────────────────────────────────────────────────────────────
// Phase 7 — Files / uploads (spec §9: presigned uploads scoped to
// workspace + content-type + size cap)
// ─────────────────────────────────────────────────────────────

/** Maximum upload size for a presigned PUT (25 MiB). */
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Allowed upload content types (spec §9 content-type allowlist): common images
 * plus everyday document formats. The presign endpoint rejects anything not in
 * this set with 400. Kept deliberately conservative — the editor's media blocks
 * (image/file/video) cover these.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  // Video
  "video/mp4",
  "video/webm",
  // Documents
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];
