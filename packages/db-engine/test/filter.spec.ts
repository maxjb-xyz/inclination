import { describe, it, expect } from "vitest";
import type { FilterNode, PropertyType } from "@inclination/shared";
import { evaluateFilter, FilterError, type FilterContext } from "../src/filter";
import type { CellValue } from "../src/property-value";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15 (a Monday)

function ctxOf(
  values: Record<string, CellValue>,
  types: Record<string, PropertyType>,
  now = NOW,
): FilterContext {
  return {
    getValue: (id) => values[id] ?? null,
    getType: (id) => types[id]!,
    now,
  };
}

function cond(propertyId: string, operator: string, value?: unknown): FilterNode {
  return { conjunction: "and", conditions: [{ propertyId, operator, value }] };
}

describe("text operators", () => {
  const types = { name: "text" as PropertyType };
  it("equals / not_equals (case-insensitive)", () => {
    expect(evaluateFilter(cond("name", "equals", "Hello"), ctxOf({ name: "hello" }, types))).toBe(true);
    expect(evaluateFilter(cond("name", "not_equals", "x"), ctxOf({ name: "hello" }, types))).toBe(true);
  });
  it("contains / not_contains / starts_with / ends_with", () => {
    const c = ctxOf({ name: "hello world" }, types);
    expect(evaluateFilter(cond("name", "contains", "lo wo"), c)).toBe(true);
    expect(evaluateFilter(cond("name", "not_contains", "zzz"), c)).toBe(true);
    expect(evaluateFilter(cond("name", "starts_with", "hell"), c)).toBe(true);
    expect(evaluateFilter(cond("name", "ends_with", "rld"), c)).toBe(true);
  });
  it("is_empty / is_not_empty", () => {
    expect(evaluateFilter(cond("name", "is_empty"), ctxOf({ name: "" }, types))).toBe(true);
    expect(evaluateFilter(cond("name", "is_empty"), ctxOf({ name: null }, types))).toBe(true);
    expect(evaluateFilter(cond("name", "is_not_empty"), ctxOf({ name: "x" }, types))).toBe(true);
  });
  it("throws on unsupported operator", () => {
    expect(() => evaluateFilter(cond("name", "bogus", "x"), ctxOf({ name: "y" }, types))).toThrow(FilterError);
  });
});

describe("number operators", () => {
  const types = { n: "number" as PropertyType };
  it("comparisons", () => {
    const c = ctxOf({ n: 10 }, types);
    expect(evaluateFilter(cond("n", "equals", 10), c)).toBe(true);
    expect(evaluateFilter(cond("n", "greater_than", 5), c)).toBe(true);
    expect(evaluateFilter(cond("n", "greater_than_or_equal", 10), c)).toBe(true);
    expect(evaluateFilter(cond("n", "less_than", 20), c)).toBe(true);
    expect(evaluateFilter(cond("n", "less_than_or_equal", 10), c)).toBe(true);
    expect(evaluateFilter(cond("n", "not_equals", 11), c)).toBe(true);
  });
  it("missing value never satisfies a comparison", () => {
    const c = ctxOf({ n: null }, types);
    expect(evaluateFilter(cond("n", "greater_than", 5), c)).toBe(false);
    expect(evaluateFilter(cond("n", "is_empty"), c)).toBe(true);
  });
});

describe("select / status", () => {
  const types = { s: "select" as PropertyType };
  it("equals / not_equals / is_any_of", () => {
    const c = ctxOf({ s: "o1" }, types);
    expect(evaluateFilter(cond("s", "equals", "o1"), c)).toBe(true);
    expect(evaluateFilter(cond("s", "not_equals", "o2"), c)).toBe(true);
    expect(evaluateFilter(cond("s", "is_any_of", ["o1", "o3"]), c)).toBe(true);
    expect(evaluateFilter(cond("s", "is_any_of", ["o2", "o3"]), c)).toBe(false);
  });
  it("empty", () => {
    expect(evaluateFilter(cond("s", "is_empty"), ctxOf({ s: null }, types))).toBe(true);
  });
});

describe("multi_select / person / relation membership", () => {
  const types = { tags: "multi_select" as PropertyType };
  it("contains / not_contains / is_any_of", () => {
    const c = ctxOf({ tags: ["a", "b"] }, types);
    expect(evaluateFilter(cond("tags", "contains", "a"), c)).toBe(true);
    expect(evaluateFilter(cond("tags", "not_contains", "z"), c)).toBe(true);
    expect(evaluateFilter(cond("tags", "is_any_of", ["z", "b"]), c)).toBe(true);
  });
  it("empty membership", () => {
    expect(evaluateFilter(cond("tags", "is_empty"), ctxOf({ tags: [] }, types))).toBe(true);
    expect(evaluateFilter(cond("tags", "is_not_empty"), ctxOf({ tags: ["a"] }, types))).toBe(true);
  });
});

describe("checkbox", () => {
  const types = { done: "checkbox" as PropertyType };
  it("equals / checked / unchecked", () => {
    expect(evaluateFilter(cond("done", "equals", true), ctxOf({ done: true }, types))).toBe(true);
    expect(evaluateFilter(cond("done", "checked"), ctxOf({ done: true }, types))).toBe(true);
    expect(evaluateFilter(cond("done", "unchecked"), ctxOf({ done: false }, types))).toBe(true);
    expect(evaluateFilter(cond("done", "unchecked"), ctxOf({ done: null }, types))).toBe(true);
  });
});

describe("date operators", () => {
  const types = { due: "date" as PropertyType };
  const dv = (iso: string) => ({ start: iso } as CellValue);
  it("before / after / on_or_before / on_or_after", () => {
    const c = ctxOf({ due: dv("2026-06-10T00:00:00Z") }, types);
    expect(evaluateFilter(cond("due", "before", "2026-06-11"), c)).toBe(true);
    expect(evaluateFilter(cond("due", "after", "2026-06-01"), c)).toBe(true);
    expect(evaluateFilter(cond("due", "on_or_before", "2026-06-10T00:00:00Z"), c)).toBe(true);
    expect(evaluateFilter(cond("due", "on_or_after", "2026-06-10T00:00:00Z"), c)).toBe(true);
  });
  it("relative: is_today / is_this_week / is_past / is_future", () => {
    const today = ctxOf({ due: dv("2026-06-15T08:00:00Z") }, types);
    expect(evaluateFilter(cond("due", "is_today"), today)).toBe(true);
    expect(evaluateFilter(cond("due", "is_this_week"), today)).toBe(true);
    const past = ctxOf({ due: dv("2026-01-01T00:00:00Z") }, types);
    expect(evaluateFilter(cond("due", "is_past"), past)).toBe(true);
    const future = ctxOf({ due: dv("2026-12-31T00:00:00Z") }, types);
    expect(evaluateFilter(cond("due", "is_future"), future)).toBe(true);
  });
  it("empty date", () => {
    expect(evaluateFilter(cond("due", "is_empty"), ctxOf({ due: null }, types))).toBe(true);
    expect(evaluateFilter(cond("due", "before", "2026-01-01"), ctxOf({ due: null }, types))).toBe(false);
  });
});

describe("AND / OR / nested trees", () => {
  const types = { n: "number" as PropertyType, s: "select" as PropertyType };
  const c = ctxOf({ n: 5, s: "o1" }, types);
  it("and requires all; or requires any", () => {
    const and: FilterNode = {
      conjunction: "and",
      conditions: [
        { propertyId: "n", operator: "greater_than", value: 1 },
        { propertyId: "s", operator: "equals", value: "o1" },
      ],
    };
    expect(evaluateFilter(and, c)).toBe(true);
    const or: FilterNode = {
      conjunction: "or",
      conditions: [
        { propertyId: "n", operator: "greater_than", value: 100 },
        { propertyId: "s", operator: "equals", value: "o1" },
      ],
    };
    expect(evaluateFilter(or, c)).toBe(true);
  });
  it("nested group", () => {
    const nested: FilterNode = {
      conjunction: "and",
      conditions: [
        { propertyId: "n", operator: "less_than", value: 10 },
        {
          conjunction: "or",
          conditions: [
            { propertyId: "s", operator: "equals", value: "nope" },
            { propertyId: "n", operator: "equals", value: 5 },
          ],
        },
      ],
    };
    expect(evaluateFilter(nested, c)).toBe(true);
  });
  it("empty and matches; empty or does not", () => {
    expect(evaluateFilter({ conjunction: "and", conditions: [] }, c)).toBe(true);
    expect(evaluateFilter({ conjunction: "or", conditions: [] }, c)).toBe(false);
  });
});

describe("computed (formula/rollup) dynamic dispatch", () => {
  it("dispatches by runtime value shape", () => {
    const types = { f: "formula" as PropertyType };
    expect(evaluateFilter(cond("f", "greater_than", 1), ctxOf({ f: 5 }, types))).toBe(true);
    expect(evaluateFilter(cond("f", "contains", "ell"), ctxOf({ f: "hello" }, types))).toBe(true);
    expect(evaluateFilter(cond("f", "checked"), ctxOf({ f: true }, types))).toBe(true);
  });
});
