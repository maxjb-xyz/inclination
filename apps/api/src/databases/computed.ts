/**
 * Per-request computed-value resolver for database rows.
 *
 * Given a database's properties, a working set of rows (each with its raw cell
 * values, relation links and page metadata), this resolves the *computed*
 * property types server-side:
 *
 *   - relation         → the list of linked row ids (surfaced as a string[])
 *   - rollup           → walk the relation links to the target rows, collect the
 *                        target property's values, then `computeRollup`
 *   - formula          → `evaluateFormula` over the row's property values keyed
 *                        by NAME (relation/rollup/scalar all resolvable)
 *   - created_time / created_by / last_edited_time / last_edited_by → from the
 *                        row Page metadata
 *
 * Pure-ish: no Prisma/HTTP. Time is injected via `now`. Formula ASTs are parsed
 * once per property (cache) and formula evaluation is memoised per (row,
 * property) within a request to bound work and break cyclic formula references
 * (a cycle resolves to a `{ error }` value rather than looping forever).
 */

import {
  computeRollup,
  evaluateFormula,
  isComputed,
  isFormulaError,
  parseFormula,
  type Ast,
  type CellValue,
  type FormulaContext,
  type FormulaValue,
  type RollupResult,
} from "@inclination/db-engine";
import type {
  FormulaConfig,
  PropertyType,
  RollupConfig,
} from "@inclination/shared";

/** A property as needed by the resolver (subset of the Prisma model). */
export interface ResolverProperty {
  id: string;
  name: string;
  type: PropertyType;
  config: unknown;
}

/** Row metadata + raw (settable) cell values + outgoing relation links. */
export interface ResolverRow {
  pageId: string;
  /** Normalized settable cell values keyed by propertyId (null = empty). */
  cells: Record<string, CellValue>;
  /** Relation property id → linked row page ids (outgoing edges). */
  relations: Record<string, string[]>;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  editedById: string | null;
}

/**
 * A read-only view of *all* rows reachable for rollup target resolution: the
 * resolver may need the cells of a related row in a *different* database. The
 * caller supplies a lookup from a row page id to its resolved property values.
 */
export interface TargetRowLookup {
  /** propertyId → property metadata for the target database(s). */
  property(propertyId: string): ResolverProperty | undefined;
  /** A linked row's raw value for a target property (already computed if needed). */
  getValue(rowPageId: string, propertyId: string): CellValue;
}

/** The computed values for a single row, keyed by propertyId. */
export type ComputedValues = Record<string, ComputedValue>;

/** A computed value is whatever the property type produces. */
export type ComputedValue =
  | string[] // relation → linked ids
  | RollupResult // rollup
  | FormulaValue // formula
  | string // created_by / last_edited_by (single user id) — surfaced as id
  | null;

const MAX_FORMULA_DEPTH = 32;

/**
 * Resolves the computed values for one row, given the full property list and the
 * row's data. `targets` supplies cross-database lookups for rollups. The result
 * caches formula evaluations to bound work and stop cyclic references.
 */
export class RowComputer {
  private readonly byId = new Map<string, ResolverProperty>();
  private readonly byName = new Map<string, ResolverProperty>();
  private readonly formulaAst = new Map<string, Ast | { error: string }>();

  constructor(
    private readonly properties: ResolverProperty[],
    private readonly now: number,
  ) {
    for (const p of properties) {
      this.byId.set(p.id, p);
      this.byName.set(p.name, p);
    }
  }

  /** Compute every computed property for a row. */
  compute(row: ResolverRow, targets: TargetRowLookup): ComputedValues {
    const out: ComputedValues = {};
    const inFlight = new Set<string>();
    for (const prop of this.properties) {
      if (!isComputed(prop.type) && prop.type !== "relation") continue;
      out[prop.id] = this.resolveProperty(prop, row, targets, inFlight, 0);
    }
    return out;
  }

  private resolveProperty(
    prop: ResolverProperty,
    row: ResolverRow,
    targets: TargetRowLookup,
    inFlight: Set<string>,
    depth: number,
  ): ComputedValue {
    switch (prop.type) {
      case "relation":
        return row.relations[prop.id] ?? [];
      case "created_by":
        return row.createdById;
      case "last_edited_by":
        return row.editedById ?? row.createdById;
      case "created_time":
        return row.createdAt.toISOString();
      case "last_edited_time":
        return row.updatedAt.toISOString();
      case "rollup":
        return this.resolveRollup(prop, row, targets);
      case "formula":
        return this.resolveFormula(prop, row, targets, inFlight, depth);
      default:
        return null;
    }
  }

  private resolveRollup(
    prop: ResolverProperty,
    row: ResolverRow,
    targets: TargetRowLookup,
  ): RollupResult {
    const cfg = prop.config as RollupConfig | undefined;
    if (!cfg?.relationPropertyId || !cfg.targetPropertyId) return null;
    const linked = row.relations[cfg.relationPropertyId] ?? [];
    const targetProp = targets.property(cfg.targetPropertyId);
    const targetType: PropertyType = targetProp?.type ?? "text";
    const values: CellValue[] = linked.map((id) =>
      targets.getValue(id, cfg.targetPropertyId),
    );
    return computeRollup(cfg.aggregation, values, targetType);
  }

  private formulaFor(prop: ResolverProperty): Ast | { error: string } {
    const cached = this.formulaAst.get(prop.id);
    if (cached) return cached;
    const cfg = prop.config as FormulaConfig | undefined;
    let parsed: Ast | { error: string };
    try {
      parsed = parseFormula(cfg?.expression ?? "");
    } catch (err) {
      parsed = { error: err instanceof Error ? err.message : String(err) };
    }
    this.formulaAst.set(prop.id, parsed);
    return parsed;
  }

  private resolveFormula(
    prop: ResolverProperty,
    row: ResolverRow,
    targets: TargetRowLookup,
    inFlight: Set<string>,
    depth: number,
  ): FormulaValue {
    if (depth > MAX_FORMULA_DEPTH) return { error: "formula recursion too deep" };
    if (inFlight.has(prop.id)) return { error: "cyclic formula reference" };
    const ast = this.formulaFor(prop);
    if ("error" in ast) return { error: ast.error };

    inFlight.add(prop.id);
    const ctx: FormulaContext = {
      now: this.now,
      resolve: (name: string) => this.resolveRef(name, row, targets, inFlight, depth),
    };
    const result = evaluateFormula(ast, ctx);
    inFlight.delete(prop.id);
    return result;
  }

  /**
   * Resolve a formula's property reference (by NAME) to a primitive. Settable
   * values pass through; computed refs recurse (formulas), rollups collapse to a
   * primitive, relations to their count. Unknown names → undefined (engine
   * raises an error value).
   */
  private resolveRef(
    name: string,
    row: ResolverRow,
    targets: TargetRowLookup,
    inFlight: Set<string>,
    depth: number,
  ): number | string | boolean | null | undefined {
    const prop = this.byName.get(name);
    if (!prop) return undefined;

    if (prop.type === "formula") {
      const v = this.resolveFormula(prop, row, targets, inFlight, depth + 1);
      // A nested formula error (e.g. a cyclic reference) propagates: returning
      // `undefined` makes the referencing formula evaluate to an error value too
      // rather than silently coercing the broken dependency to an empty value.
      if (isFormulaError(v)) return undefined;
      return toPrimitive(v);
    }
    if (prop.type === "rollup") {
      const v = this.resolveRollup(prop, row, targets);
      return rollupToPrimitive(v);
    }
    if (prop.type === "relation") {
      return (row.relations[prop.id] ?? []).length;
    }
    if (prop.type === "created_time") return row.createdAt.toISOString();
    if (prop.type === "last_edited_time") return row.updatedAt.toISOString();
    if (prop.type === "created_by") return row.createdById;
    if (prop.type === "last_edited_by") return row.editedById ?? row.createdById;

    return cellToPrimitive(row.cells[prop.id] ?? null);
  }
}

/** Reduce a normalized cell value to a formula-friendly primitive. */
function cellToPrimitive(v: CellValue): number | string | boolean | null {
  if (v === null) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.length; // multi-valued → count, usable in numeric formulas
  if (typeof v === "object" && "start" in v) return (v as { start: string }).start;
  return null;
}

function rollupToPrimitive(v: RollupResult): number | string | boolean | null {
  if (v === null) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.length;
  return null;
}

function toPrimitive(v: FormulaValue): number | string | boolean | null {
  if (v === null) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  // a nested formula error → null (the outer formula sees an empty value)
  return null;
}
