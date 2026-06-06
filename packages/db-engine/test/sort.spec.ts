import { describe, it, expect } from "vitest";
import type { PropertyType, Sort } from "@inclination/shared";
import { sortRows, type SortAccessors } from "../src/sort";
import type { CellValue } from "../src/property-value";

interface Row {
  id: string;
  cells: Record<string, CellValue>;
}

function accOf(
  types: Record<string, PropertyType>,
  optionOrder?: Record<string, string[]>,
): SortAccessors<Row> {
  return {
    getValue: (row, pid) => row.cells[pid] ?? null,
    getType: (pid) => types[pid]!,
    getOptionOrder: optionOrder
      ? (pid, oid) => {
          const idx = optionOrder[pid]?.indexOf(oid);
          return idx === undefined || idx < 0 ? undefined : idx;
        }
      : undefined,
  };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("number sort", () => {
  const rows: Row[] = [
    { id: "a", cells: { n: 3 } },
    { id: "b", cells: { n: 1 } },
    { id: "c", cells: { n: 2 } },
  ];
  const acc = accOf({ n: "number" });
  it("ascending numeric", () => {
    expect(ids(sortRows(rows, [{ propertyId: "n", direction: "asc" }], acc))).toEqual(["b", "c", "a"]);
  });
  it("descending numeric", () => {
    expect(ids(sortRows(rows, [{ propertyId: "n", direction: "desc" }], acc))).toEqual(["a", "c", "b"]);
  });
  it("does not mutate input", () => {
    const copy = [...rows];
    sortRows(rows, [{ propertyId: "n", direction: "asc" }], acc);
    expect(rows).toEqual(copy);
  });
});

describe("empty values sink last in both directions", () => {
  const rows: Row[] = [
    { id: "a", cells: { n: 5 } },
    { id: "b", cells: { n: null } },
    { id: "c", cells: { n: 2 } },
  ];
  const acc = accOf({ n: "number" });
  it("asc", () => {
    expect(ids(sortRows(rows, [{ propertyId: "n", direction: "asc" }], acc))).toEqual(["c", "a", "b"]);
  });
  it("desc", () => {
    expect(ids(sortRows(rows, [{ propertyId: "n", direction: "desc" }], acc))).toEqual(["a", "c", "b"]);
  });
});

describe("text sort uses locale + numeric collation", () => {
  const rows: Row[] = [
    { id: "a", cells: { t: "item10" } },
    { id: "b", cells: { t: "item2" } },
    { id: "c", cells: { t: "Item1" } },
  ];
  const acc = accOf({ t: "text" });
  it("natural order", () => {
    expect(ids(sortRows(rows, [{ propertyId: "t", direction: "asc" }], acc))).toEqual(["c", "b", "a"]);
  });
});

describe("date sort chronological", () => {
  const dv = (s: string) => ({ start: s }) as CellValue;
  const rows: Row[] = [
    { id: "a", cells: { d: dv("2026-03-01") } },
    { id: "b", cells: { d: dv("2026-01-01") } },
    { id: "c", cells: { d: dv("2026-02-01") } },
  ];
  const acc = accOf({ d: "date" });
  it("asc", () => {
    expect(ids(sortRows(rows, [{ propertyId: "d", direction: "asc" }], acc))).toEqual(["b", "c", "a"]);
  });
});

describe("checkbox sort: unchecked before checked", () => {
  const rows: Row[] = [
    { id: "a", cells: { c: true } },
    { id: "b", cells: { c: false } },
  ];
  const acc = accOf({ c: "checkbox" });
  it("asc", () => {
    expect(ids(sortRows(rows, [{ propertyId: "c", direction: "asc" }], acc))).toEqual(["b", "a"]);
  });
});

describe("select sort by option order, fallback to name", () => {
  const rows: Row[] = [
    { id: "a", cells: { s: "low" } },
    { id: "b", cells: { s: "high" } },
    { id: "c", cells: { s: "mid" } },
  ];
  const acc = accOf({ s: "select" }, { s: ["high", "mid", "low"] });
  it("uses configured option order", () => {
    expect(ids(sortRows(rows, [{ propertyId: "s", direction: "asc" }], acc))).toEqual(["b", "c", "a"]);
  });
  it("falls back to alphabetical option id when no order provided", () => {
    const acc2 = accOf({ s: "select" });
    // "high" < "low" < "mid" alphabetically → b, a, c
    expect(ids(sortRows(rows, [{ propertyId: "s", direction: "asc" }], acc2))).toEqual(["b", "a", "c"]);
  });
});

describe("multi-key stable sort", () => {
  const rows: Row[] = [
    { id: "a", cells: { grp: 1, n: 2 } },
    { id: "b", cells: { grp: 1, n: 1 } },
    { id: "c", cells: { grp: 2, n: 1 } },
    { id: "d", cells: { grp: 1, n: 1 } },
  ];
  const acc = accOf({ grp: "number", n: "number" });
  const sorts: Sort[] = [
    { propertyId: "grp", direction: "asc" },
    { propertyId: "n", direction: "asc" },
  ];
  it("sorts by grp then n, stable on ties", () => {
    expect(ids(sortRows(rows, sorts, acc))).toEqual(["b", "d", "a", "c"]);
  });
});
