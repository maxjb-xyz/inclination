import { z } from "zod";
import {
  AGGREGATIONS,
  ALL_FILTER_OPERATORS,
  COMPUTED_PROPERTY_TYPES,
  FILTER_CONJUNCTIONS,
  GALLERY_CARD_SIZES,
  GALLERY_COVER_SOURCES,
  NUMBER_FORMATS,
  PROPERTY_OPTION_COLORS,
  PROPERTY_TYPES,
  SORT_DIRECTIONS,
  STATUS_GROUPS,
  VIEW_TYPES,
  type ComputedPropertyType,
  type PropertyType,
} from "./constants";

// ─────────────────────────────────────────────────────────────
// Phase 5 — Databases / collections: shared types + API Zod (spec §5)
//
// T1 owns the data model and the *shape* of every input. The per-type *value*
// validators (what a `number` cell must contain, what `before` compares, …)
// live in the engines (T2); here `config` is validated structurally and cell
// values are accepted as opaque JSON.
// ─────────────────────────────────────────────────────────────

const id = z.string().uuid();
const name = z.string().trim().min(1).max(200);

/** A select/multi_select/status choice. */
export interface PropertyOption {
  id: string;
  name: string;
  color: string;
}

/** A status group bucket (todo / in_progress / complete) holding option ids. */
export interface StatusOptionGroup {
  id: string;
  name: string;
  /** Which of the three canonical status groups this bucket belongs to. */
  group: (typeof STATUS_GROUPS)[number];
  optionIds: string[];
}

// ── Per-type property `config` shapes ─────────────────────────

export interface SelectConfig {
  options: PropertyOption[];
}
export interface MultiSelectConfig {
  options: PropertyOption[];
}
export interface StatusConfig {
  options: PropertyOption[];
  groups: StatusOptionGroup[];
}
export interface NumberConfig {
  format?: (typeof NUMBER_FORMATS)[number];
  /** Decimal places to display. */
  precision?: number;
}
export interface DateConfig {
  includeTime?: boolean;
  /** Allow a start/end range rather than a single date. */
  endDate?: boolean;
}
export interface RelationConfig {
  targetDatabaseId: string;
  /** The mirror property on the target database for a two-way relation. */
  pairedPropertyId?: string;
  /** Relations flagged as dependencies drive sub-item dependency lines. */
  isDependency?: boolean;
}
export interface RollupConfig {
  /** The `relation` property on this database to walk. */
  relationPropertyId: string;
  /** The property on the related database to aggregate. */
  targetPropertyId: string;
  aggregation: (typeof AGGREGATIONS)[number];
}
export interface FormulaConfig {
  /** Formula source; T2 parses/evaluates it server-side. */
  expression: string;
}

/** Loose union of all property configs (a property carries exactly one). */
export type PropertyConfig =
  | SelectConfig
  | MultiSelectConfig
  | StatusConfig
  | NumberConfig
  | DateConfig
  | RelationConfig
  | RollupConfig
  | FormulaConfig
  | Record<string, never>;

// ── Filters / sorts / views ───────────────────────────────────

export interface FilterCondition {
  propertyId: string;
  operator: string;
  /** Operand; meaning depends on operator/type. T2 validates per type. */
  value?: unknown;
}

export interface FilterNode {
  conjunction: (typeof FILTER_CONJUNCTIONS)[number];
  conditions: (FilterCondition | FilterNode)[];
}

export interface Sort {
  propertyId: string;
  direction: (typeof SORT_DIRECTIONS)[number];
}

export interface GalleryConfig {
  coverSource: (typeof GALLERY_COVER_SOURCES)[number];
  cardSize: (typeof GALLERY_CARD_SIZES)[number];
  /** When coverSource is files_property, which `files` property to use. */
  coverPropertyId?: string;
}

export interface ViewConfig {
  /** Ordered list of visible property ids (left → right). */
  visibleProperties?: string[];
  filters?: FilterNode;
  sorts?: Sort[];
  /** Board column / table grouping property. */
  groupBy?: string;
  /** Calendar date property. */
  dateProperty?: string;
  gallery?: GalleryConfig;
  pageSize?: number;
}

// ── Type guards ───────────────────────────────────────────────

export function isPropertyType(value: unknown): value is PropertyType {
  return (
    typeof value === "string" &&
    (PROPERTY_TYPES as readonly string[]).includes(value)
  );
}

export function isComputedPropertyType(value: unknown): value is ComputedPropertyType {
  return (
    typeof value === "string" &&
    (COMPUTED_PROPERTY_TYPES as readonly string[]).includes(value)
  );
}

/** Distinguishes a nested filter group from a leaf condition in the tree. */
export function isFilterNode(node: FilterCondition | FilterNode): node is FilterNode {
  return (node as FilterNode).conjunction !== undefined;
}

// ── Zod: shared building blocks ───────────────────────────────

export const propertyOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  color: z.enum(PROPERTY_OPTION_COLORS),
});

export const statusOptionGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  group: z.enum(STATUS_GROUPS),
  optionIds: z.array(z.string().min(1)).max(200),
});

/**
 * Structural validation of a property `config`, keyed by property type. Empty
 * for types that need no config. Per-type *value* rules belong to T2.
 */
export const propertyConfigSchemas = {
  text: z.object({}).strict(),
  number: z
    .object({
      format: z.enum(NUMBER_FORMATS).optional(),
      precision: z.number().int().min(0).max(10).optional(),
    })
    .strict(),
  select: z.object({ options: z.array(propertyOptionSchema).max(500) }).strict(),
  multi_select: z
    .object({ options: z.array(propertyOptionSchema).max(500) })
    .strict(),
  status: z
    .object({
      options: z.array(propertyOptionSchema).max(500),
      groups: z.array(statusOptionGroupSchema).max(50),
    })
    .strict(),
  date: z
    .object({
      includeTime: z.boolean().optional(),
      endDate: z.boolean().optional(),
    })
    .strict(),
  person: z.object({}).strict(),
  checkbox: z.object({}).strict(),
  url: z.object({}).strict(),
  email: z.object({}).strict(),
  phone: z.object({}).strict(),
  files: z.object({}).strict(),
  relation: z
    .object({
      targetDatabaseId: id,
      pairedPropertyId: id.optional(),
      isDependency: z.boolean().optional(),
    })
    .strict(),
  rollup: z
    .object({
      relationPropertyId: id,
      targetPropertyId: z.string().min(1),
      aggregation: z.enum(AGGREGATIONS),
    })
    .strict(),
  formula: z.object({ expression: z.string().max(10_000) }).strict(),
  created_time: z.object({}).strict(),
  created_by: z.object({}).strict(),
  last_edited_time: z.object({}).strict(),
  last_edited_by: z.object({}).strict(),
} as const satisfies Record<PropertyType, z.ZodTypeAny>;

/** Validate a `config` object against the schema for a given property type. */
export function parsePropertyConfig(type: PropertyType, config: unknown) {
  return propertyConfigSchemas[type].safeParse(config ?? {});
}

// ── Zod: filter tree (recursive) ──────────────────────────────

export const filterConditionSchema = z.object({
  propertyId: id,
  operator: z.enum(ALL_FILTER_OPERATORS as [string, ...string[]]),
  value: z.unknown().optional(),
});

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.object({
    conjunction: z.enum(FILTER_CONJUNCTIONS),
    conditions: z
      .array(z.union([filterConditionSchema, filterNodeSchema]))
      .max(100),
  }),
);

export const sortSchema = z.object({
  propertyId: id,
  direction: z.enum(SORT_DIRECTIONS),
});

export const gallerySchema = z.object({
  coverSource: z.enum(GALLERY_COVER_SOURCES),
  cardSize: z.enum(GALLERY_CARD_SIZES),
  coverPropertyId: id.optional(),
});

export const viewConfigSchema = z
  .object({
    visibleProperties: z.array(id).max(500).optional(),
    filters: filterNodeSchema.optional(),
    sorts: z.array(sortSchema).max(50).optional(),
    groupBy: id.optional(),
    dateProperty: id.optional(),
    gallery: gallerySchema.optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type ViewConfigInput = z.infer<typeof viewConfigSchema>;

// ── Zod: API inputs ───────────────────────────────────────────

export const createDatabaseSchema = z.object({
  /** Container page to attach the database to, or null to create a new one. */
  pageId: id.optional(),
  parentId: id.nullable().optional(),
  title: z.string().max(2000).optional(),
});
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;

export const updateDatabaseSchema = z
  .object({
    defaultViewId: id.nullable().optional(),
    subitemsEnabled: z.boolean().optional(),
    subitemsPropertyId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateDatabaseInput = z.infer<typeof updateDatabaseSchema>;

/**
 * Create a property. `config` is validated structurally against the chosen
 * `type` via a superRefine so the discriminant is the `type` field.
 */
export const createPropertySchema = z
  .object({
    name,
    type: z.enum(PROPERTY_TYPES),
    config: z.unknown().optional(),
    order: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    const result = parsePropertyConfig(val.type, val.config);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: `Invalid config for property type "${val.type}"`,
      });
    }
  });
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

/**
 * Update a property. `type` is optional; when both `type` and `config` are
 * present the config is checked against the new type. `config` alone cannot be
 * fully validated here (the engine resolves it against the stored type in T2/T3).
 */
export const updatePropertySchema = z
  .object({
    name: name.optional(),
    type: z.enum(PROPERTY_TYPES).optional(),
    config: z.unknown().optional(),
    order: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" })
  .superRefine((val, ctx) => {
    if (val.type !== undefined && val.config !== undefined) {
      const result = parsePropertyConfig(val.type, val.config);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["config"],
          message: `Invalid config for property type "${val.type}"`,
        });
      }
    }
  });
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

export const reorderPropertiesSchema = z.object({
  propertyIds: z.array(id).max(500),
});
export type ReorderPropertiesInput = z.infer<typeof reorderPropertiesSchema>;

export const createViewSchema = z.object({
  type: z.enum(VIEW_TYPES),
  name,
  order: z.number().int().optional(),
  config: viewConfigSchema.optional(),
});
export type CreateViewInput = z.infer<typeof createViewSchema>;

export const updateViewSchema = z
  .object({
    name: name.optional(),
    type: z.enum(VIEW_TYPES).optional(),
    order: z.number().int().optional(),
    config: viewConfigSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateViewInput = z.infer<typeof updateViewSchema>;

/**
 * Set a cell value. The value is accepted as opaque JSON here and normalized /
 * type-validated by the property-value engine (T2). Computed property types are
 * rejected up-front since they are never set directly.
 */
export const setCellSchema = z.object({
  propertyId: id,
  /** Null clears the cell. Any other JSON is validated per-type in T2. */
  value: z.unknown(),
});
export type SetCellInput = z.infer<typeof setCellSchema>;

export const createRowSchema = z.object({
  /** Parent row id for a sub-item; omitted/null creates a top-level row. */
  parentRowId: id.nullable().optional(),
  title: z.string().max(2000).optional(),
});
export type CreateRowInput = z.infer<typeof createRowSchema>;

/** Link or unlink two rows through a relation property. */
export const relationLinkSchema = z.object({
  propertyId: id,
  fromRowId: id,
  toRowId: id,
});
export type RelationLinkInput = z.infer<typeof relationLinkSchema>;

/** Query rows under a view, with cursor pagination. */
export const queryRowsSchema = z.object({
  viewId: id.optional(),
  /** Ad-hoc overrides when no saved view drives the query. */
  config: viewConfigSchema.optional(),
  cursor: id.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type QueryRowsInput = z.infer<typeof queryRowsSchema>;
