import { describe, expect, it } from "vitest";
import {
  RowComputer,
  type ResolverProperty,
  type ResolverRow,
  type TargetRowLookup,
} from "../src/databases/computed";
import { isFormulaError } from "@inclination/db-engine";

/**
 * Unit tests for the per-request computed-value resolver (T3). Uses fake data
 * (no Prisma): a fake property list, fake row + relation links, and a fake
 * target lookup standing in for related rows in another database.
 */
describe("RowComputer (computed values)", () => {
  const now = Date.parse("2026-06-06T00:00:00.000Z");

  const baseRow = (over: Partial<ResolverRow> = {}): ResolverRow => ({
    pageId: "row-1",
    cells: {},
    relations: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    createdById: "user-a",
    editedById: "user-b",
    ...over,
  });

  const emptyTargets: TargetRowLookup = {
    property: () => undefined,
    getValue: () => null,
  };

  it("surfaces a relation property as the list of linked row ids", () => {
    const props: ResolverProperty[] = [
      { id: "rel", name: "Projects", type: "relation", config: { targetDatabaseId: "db2" } },
    ];
    const computer = new RowComputer(props, now);
    const row = baseRow({ relations: { rel: ["a", "b", "c"] } });
    const out = computer.compute(row, emptyTargets);
    expect(out.rel).toEqual(["a", "b", "c"]);
  });

  it("resolves created_*/last_edited_* from the row page metadata", () => {
    const props: ResolverProperty[] = [
      { id: "ct", name: "Created", type: "created_time", config: {} },
      { id: "cb", name: "Creator", type: "created_by", config: {} },
      { id: "lt", name: "Edited", type: "last_edited_time", config: {} },
      { id: "lb", name: "Editor", type: "last_edited_by", config: {} },
    ];
    const out = new RowComputer(props, now).compute(baseRow(), emptyTargets);
    expect(out.ct).toBe("2026-01-01T00:00:00.000Z");
    expect(out.cb).toBe("user-a");
    expect(out.lt).toBe("2026-02-01T00:00:00.000Z");
    expect(out.lb).toBe("user-b");
  });

  it("computes a rollup (sum) over a fake link set of target rows", () => {
    const props: ResolverProperty[] = [
      { id: "rel", name: "Tasks", type: "relation", config: { targetDatabaseId: "db2" } },
      {
        id: "roll",
        name: "Total",
        type: "rollup",
        config: { relationPropertyId: "rel", targetPropertyId: "amount", aggregation: "sum" },
      },
    ];
    // Fake target lookup: two linked rows with `amount` 10 and 32.
    const targets: TargetRowLookup = {
      property: (id) => (id === "amount" ? { id: "amount", name: "Amount", type: "number", config: {} } : undefined),
      getValue: (rowId, propId) => {
        if (propId !== "amount") return null;
        return rowId === "t1" ? 10 : rowId === "t2" ? 32 : null;
      },
    };
    const row = baseRow({ relations: { rel: ["t1", "t2"] } });
    const out = new RowComputer(props, now).compute(row, targets);
    expect(out.roll).toBe(42);
  });

  it("computes a rollup (count) over the linked rows", () => {
    const props: ResolverProperty[] = [
      { id: "rel", name: "Tasks", type: "relation", config: { targetDatabaseId: "db2" } },
      {
        id: "roll",
        name: "How many",
        type: "rollup",
        config: { relationPropertyId: "rel", targetPropertyId: "amount", aggregation: "count" },
      },
    ];
    const row = baseRow({ relations: { rel: ["t1", "t2", "t3"] } });
    const out = new RowComputer(props, now).compute(row, emptyTargets);
    expect(out.roll).toBe(3);
  });

  it("evaluates a formula over a row's property values by name", () => {
    const props: ResolverProperty[] = [
      { id: "p", name: "Price", type: "number", config: {} },
      { id: "q", name: "Qty", type: "number", config: {} },
      { id: "f", name: "Total", type: "formula", config: { expression: "Price * Qty" } },
    ];
    const row = baseRow({ cells: { p: 7, q: 6 } });
    const out = new RowComputer(props, now).compute(row, emptyTargets);
    expect(out.f).toBe(42);
  });

  it("lets a formula reference a rollup value by name", () => {
    const props: ResolverProperty[] = [
      { id: "rel", name: "Tasks", type: "relation", config: { targetDatabaseId: "db2" } },
      {
        id: "roll",
        name: "Sum",
        type: "rollup",
        config: { relationPropertyId: "rel", targetPropertyId: "amount", aggregation: "sum" },
      },
      { id: "f", name: "Doubled", type: "formula", config: { expression: "Sum * 2" } },
    ];
    const targets: TargetRowLookup = {
      property: (id) => (id === "amount" ? { id: "amount", name: "Amount", type: "number", config: {} } : undefined),
      getValue: (rowId, propId) => (propId === "amount" && rowId === "t1" ? 5 : null),
    };
    const row = baseRow({ relations: { rel: ["t1"] } });
    const out = new RowComputer(props, now).compute(row, targets);
    expect(out.f).toBe(10);
  });

  it("returns an error value for a cyclic formula reference instead of looping", () => {
    const props: ResolverProperty[] = [
      { id: "a", name: "A", type: "formula", config: { expression: "B + 1" } },
      { id: "b", name: "B", type: "formula", config: { expression: "A + 1" } },
    ];
    const out = new RowComputer(props, now).compute(baseRow(), emptyTargets);
    expect(isFormulaError(out.a as never)).toBe(true);
  });

  it("returns now() from the injected clock, not Date.now", () => {
    const props: ResolverProperty[] = [
      { id: "f", name: "When", type: "formula", config: { expression: "now()" } },
    ];
    const out = new RowComputer(props, now).compute(baseRow(), emptyTargets);
    expect(out.f).toBe(new Date(now).toISOString());
  });
});
