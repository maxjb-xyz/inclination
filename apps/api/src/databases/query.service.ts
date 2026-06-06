import { BadRequestException, Injectable } from "@nestjs/common";
import {
  evaluateFilter,
  groupRows,
  sortRows,
  type CellValue,
  type FilterContext,
  type GroupAccessors,
  type RowGroup,
  type SortAccessors,
} from "@inclination/db-engine";
import type {
  PropertyOption,
  PropertyType,
  ViewConfig,
} from "@inclination/shared";
import type { Property } from "@inclination/db";
import { PrismaService } from "../prisma/prisma.service";
import { DatabaseAccessService } from "./database-access.service";
import {
  RowComputer,
  type ComputedValues,
  type ResolverProperty,
  type ResolverRow,
  type TargetRowLookup,
} from "./computed";
import { paginate } from "./cursor";

const DEFAULT_LIMIT = 50;

/** A row in the query result. */
export interface QueryResultRow {
  pageId: string;
  /** Settable cell values keyed by propertyId (null = empty). */
  cells: Record<string, CellValue>;
  /** Computed values: relation, rollup, formula, created/last_edited fields. */
  computed: ComputedValues;
}

export interface QueryRowsResult {
  rows: QueryResultRow[];
  groups?: { key: string; label: string; isEmpty: boolean; pageIds: string[] }[];
  nextCursor: string | null;
}

export interface QueryRowsParams {
  viewId?: string;
  config?: ViewConfig;
  cursor?: string;
  limit?: number;
}

/** An in-memory loaded row (page metadata + cells + outgoing relations). */
interface LoadedRow {
  pageId: string;
  cells: Record<string, CellValue>;
  relations: Record<string, string[]>;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  editedById: string | null;
}

/**
 * The rows-query pipeline (spec §6): load → compute (formula/rollup/relation) →
 * filter → sort → group → cursor-paginate. Computed values are evaluated once
 * per row per request and reused across filter/sort/group so a view can filter
 * or sort on a formula or rollup.
 */
@Injectable()
export class QueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DatabaseAccessService,
  ) {}

  async query(
    userId: string,
    databaseId: string,
    params: QueryRowsParams,
  ): Promise<QueryRowsResult> {
    await this.access.requireDatabase(userId, databaseId);

    // Resolve the effective view config (saved view or inline override).
    let config: ViewConfig = params.config ?? {};
    if (params.viewId) {
      const view = await this.prisma.view.findUnique({ where: { id: params.viewId } });
      if (!view || view.databaseId !== databaseId) {
        throw new BadRequestException("viewId is not a view of this database");
      }
      config = { ...(view.config as ViewConfig), ...(params.config ?? {}) };
    }

    const properties = (await this.prisma.property.findMany({
      where: { databaseId },
      orderBy: { order: "asc" },
    })) as Property[];
    const propById = new Map(properties.map((p) => [p.id, p]));

    const loaded = await this.loadRows(databaseId, properties);
    const now = Date.now();

    // Build the cross-database target lookup for rollups: gather every related
    // database referenced by a relation property, load their properties + cell
    // values so a rollup can read a related row's target property.
    const targets = await this.buildTargetLookup(properties);

    // Compute computed values for each loaded row.
    const resolverProps: ResolverProperty[] = properties.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      config: p.config,
    }));
    const computer = new RowComputer(resolverProps, now);
    const computedByRow = new Map<string, ComputedValues>();
    for (const row of loaded) {
      computedByRow.set(row.pageId, computer.compute(toResolverRow(row), targets));
    }

    // Accessor helpers shared by filter/sort/group — resolve a property's value
    // for a row, preferring computed values for computed/relation types.
    const valueFor = (row: LoadedRow, propertyId: string): CellValue => {
      const prop = propById.get(propertyId);
      if (!prop) return null;
      const type = prop.type as PropertyType;
      if (isComputedOrRelation(type)) {
        const c = computedByRow.get(row.pageId)?.[propertyId];
        return computedToCellValue(c);
      }
      return row.cells[propertyId] ?? null;
    };
    const typeFor = (propertyId: string): PropertyType =>
      (propById.get(propertyId)?.type as PropertyType) ?? "text";

    // ── Filter ──
    let working = loaded;
    if (config.filters) {
      working = working.filter((row) => {
        const ctx: FilterContext = {
          now,
          getValue: (pid) => valueFor(row, pid),
          getType: typeFor,
        };
        return evaluateFilter(config.filters!, ctx);
      });
    }

    // ── Sort ──
    if (config.sorts && config.sorts.length > 0) {
      const sortAcc: SortAccessors<LoadedRow> = {
        getValue: (row, pid) => valueFor(row, pid),
        getType: typeFor,
        getOptionOrder: (pid, optionId) => optionOrder(propById.get(pid), optionId),
      };
      working = sortRows(working, config.sorts, sortAcc);
    }

    // ── Group (optional) ──
    let groups: QueryRowsResult["groups"];
    if (config.groupBy) {
      const groupAcc: GroupAccessors<LoadedRow> = {
        getValue: (row, pid) => valueFor(row, pid),
        getType: typeFor,
        getGroupOrder: (pid) => optionOrderList(propById.get(pid)),
      };
      const grouped: RowGroup<LoadedRow>[] = groupRows(working, config.groupBy, groupAcc, {
        includeEmptyGroups: true,
      });
      groups = grouped.map((g) => ({
        key: g.key,
        label: g.label,
        isEmpty: g.isEmpty,
        pageIds: g.rows.map((r) => r.pageId),
      }));
    }

    // ── Paginate the flat ordered list ──
    const limit = params.limit ?? config.pageSize ?? DEFAULT_LIMIT;
    const page = paginate(working, (r) => r.pageId, limit, params.cursor);

    const rows: QueryResultRow[] = page.items.map((row) => ({
      pageId: row.pageId,
      cells: row.cells,
      computed: computedByRow.get(row.pageId) ?? {},
    }));

    return { rows, groups, nextCursor: page.nextCursor };
  }

  /** Load every (non-archived) row of a database with its cells + relations. */
  private async loadRows(
    databaseId: string,
    properties: Property[],
  ): Promise<LoadedRow[]> {
    // All rows in the database's row subtree (top-level + sub-items).
    const rowPages: { id: string; createdAt: Date; updatedAt: Date; createdById: string; editedById: string | null }[] = [];
    let frontier = [databaseId];
    const seen = new Set<string>();
    while (frontier.length > 0) {
      const children = await this.prisma.page.findMany({
        where: { parentId: { in: frontier }, type: "row", archivedAt: null },
        select: { id: true, createdAt: true, updatedAt: true, createdById: true, editedById: true },
      });
      const next: string[] = [];
      for (const c of children) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        rowPages.push(c);
        next.push(c.id);
      }
      frontier = next;
    }

    const rowIds = rowPages.map((r) => r.id);
    if (rowIds.length === 0) return [];

    const relationPropIds = properties.filter((p) => p.type === "relation").map((p) => p.id);
    const [cells, links] = await Promise.all([
      this.prisma.cell.findMany({ where: { rowPageId: { in: rowIds } } }),
      relationPropIds.length
        ? this.prisma.relationLink.findMany({
            where: { propertyId: { in: relationPropIds }, fromRowId: { in: rowIds } },
          })
        : Promise.resolve([]),
    ]);

    const cellsByRow = new Map<string, Record<string, CellValue>>();
    for (const c of cells) {
      const map = cellsByRow.get(c.rowPageId) ?? {};
      map[c.propertyId] = c.value as CellValue;
      cellsByRow.set(c.rowPageId, map);
    }
    const relByRow = new Map<string, Record<string, string[]>>();
    for (const l of links) {
      const map = relByRow.get(l.fromRowId) ?? {};
      (map[l.propertyId] ??= []).push(l.toRowId);
      relByRow.set(l.fromRowId, map);
    }

    return rowPages.map((r) => ({
      pageId: r.id,
      cells: cellsByRow.get(r.id) ?? {},
      relations: relByRow.get(r.id) ?? {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdById: r.createdById,
      editedById: r.editedById,
    }));
  }

  /**
   * Build a lookup that resolves, for any related row id, the normalized value of
   * a target property — so rollups can aggregate over linked rows in another
   * database. Loads the union of target-database properties + all their cells.
   */
  private async buildTargetLookup(properties: Property[]): Promise<TargetRowLookup> {
    const rollupTargetPropIds = new Set<string>();
    for (const p of properties) {
      if (p.type === "rollup") {
        const tid = (p.config as { targetPropertyId?: string }).targetPropertyId;
        if (tid) rollupTargetPropIds.add(tid);
      }
    }
    if (rollupTargetPropIds.size === 0) {
      return { property: () => undefined, getValue: () => null };
    }

    const targetProps = await this.prisma.property.findMany({
      where: { id: { in: [...rollupTargetPropIds] } },
    });
    const targetPropById = new Map(targetProps.map((p) => [p.id, p]));
    const cells = await this.prisma.cell.findMany({
      where: { propertyId: { in: [...rollupTargetPropIds] } },
    });
    // keyed `${rowPageId}:${propertyId}`
    const valueByKey = new Map<string, CellValue>();
    for (const c of cells) {
      valueByKey.set(`${c.rowPageId}:${c.propertyId}`, c.value as CellValue);
    }

    return {
      property: (propertyId: string) => {
        const p = targetPropById.get(propertyId);
        return p
          ? { id: p.id, name: p.name, type: p.type as PropertyType, config: p.config }
          : undefined;
      },
      getValue: (rowPageId: string, propertyId: string) =>
        valueByKey.get(`${rowPageId}:${propertyId}`) ?? null,
    };
  }
}

function toResolverRow(row: LoadedRow): ResolverRow {
  return {
    pageId: row.pageId,
    cells: row.cells,
    relations: row.relations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    editedById: row.editedById,
  };
}

function isComputedOrRelation(type: PropertyType): boolean {
  return (
    type === "relation" ||
    type === "rollup" ||
    type === "formula" ||
    type === "created_time" ||
    type === "created_by" ||
    type === "last_edited_time" ||
    type === "last_edited_by"
  );
}

/** Coerce a computed value to a CellValue the filter/sort/group engines accept. */
function computedToCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "object" && "error" in (v as object)) return null; // formula error → empty
  return null;
}

function optionOrder(prop: Property | undefined, optionId: string): number | undefined {
  const opts = options(prop);
  if (!opts) return undefined;
  const idx = opts.findIndex((o) => o.id === optionId);
  return idx === -1 ? undefined : idx;
}

function optionOrderList(prop: Property | undefined): string[] | undefined {
  const opts = options(prop);
  return opts?.map((o) => o.id);
}

function options(prop: Property | undefined): PropertyOption[] | undefined {
  if (!prop) return undefined;
  const cfg = prop.config as { options?: PropertyOption[] } | null;
  return cfg?.options;
}
