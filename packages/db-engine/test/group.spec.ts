import { describe, it, expect } from "vitest";
import type { PropertyType } from "@inclination/shared";
import { groupRows, type GroupAccessors } from "../src/group";
import type { CellValue } from "../src/property-value";

interface Row {
  id: string;
  cells: Record<string, CellValue>;
}

function accOf(
  types: Record<string, PropertyType>,
  order?: Record<string, string[]>,
): GroupAccessors<Row> {
  return {
    getValue: (row, pid) => row.cells[pid] ?? null,
    getType: (pid) => types[pid]!,
    getGroupOrder: order ? (pid) => order[pid] : undefined,
  };
}

const summary = (groups: ReturnType<typeof groupRows<Row>>) =>
  groups.map((g) => ({ key: g.key, ids: g.rows.map((r) => r.id) }));

describe("group by select with option order + empty bucket last", () => {
  const rows: Row[] = [
    { id: "a", cells: { s: "todo" } },
    { id: "b", cells: { s: "done" } },
    { id: "c", cells: { s: null } },
    { id: "d", cells: { s: "todo" } },
  ];
  const acc = accOf({ s: "status" }, { s: ["todo", "in_prog", "done"] });
  it("orders groups by option order, empty last", () => {
    const g = groupRows(rows, "s", acc);
    expect(summary(g)).toEqual([
      { key: "todo", ids: ["a", "d"] },
      { key: "done", ids: ["b"] },
      { key: "", ids: ["c"] },
    ]);
    expect(g[g.length - 1]!.label).toBe("No value");
    expect(g[g.length - 1]!.isEmpty).toBe(true);
  });
  it("includeEmptyGroups seeds configured columns", () => {
    const g = groupRows(rows, "s", acc, { includeEmptyGroups: true });
    const keys = g.map((x) => x.key);
    expect(keys).toEqual(["todo", "in_prog", "done", ""]);
    expect(g.find((x) => x.key === "in_prog")!.rows).toEqual([]);
  });
});

describe("group by checkbox: checked then unchecked", () => {
  const rows: Row[] = [
    { id: "a", cells: { done: false } },
    { id: "b", cells: { done: true } },
    { id: "c", cells: { done: false } },
  ];
  const acc = accOf({ done: "checkbox" });
  it("checked first, labelled", () => {
    const g = groupRows(rows, "done", acc);
    expect(summary(g)).toEqual([
      { key: "true", ids: ["b"] },
      { key: "false", ids: ["a", "c"] },
    ]);
    expect(g[0]!.label).toBe("Checked");
    expect(g[1]!.label).toBe("Unchecked");
  });
});

describe("group by multi_select / person: a row appears in each group", () => {
  const rows: Row[] = [
    { id: "a", cells: { p: ["u1", "u2"] } },
    { id: "b", cells: { p: ["u2"] } },
    { id: "c", cells: { p: [] } },
  ];
  const acc = accOf({ p: "person" });
  it("multi-membership + empty group", () => {
    const g = groupRows(rows, "p", acc);
    const byKey = Object.fromEntries(g.map((x) => [x.key, x.rows.map((r) => r.id)]));
    expect(byKey["u1"]).toEqual(["a"]);
    expect(byKey["u2"]).toEqual(["a", "b"]);
    expect(byKey[""]).toEqual(["c"]);
  });
});

describe("group by text first-seen order", () => {
  const rows: Row[] = [
    { id: "a", cells: { t: "beta" } },
    { id: "b", cells: { t: "alpha" } },
    { id: "c", cells: { t: "beta" } },
  ];
  const acc = accOf({ t: "text" });
  it("keeps first-seen order when no configured order", () => {
    const g = groupRows(rows, "t", acc);
    expect(g.map((x) => x.key)).toEqual(["beta", "alpha"]);
  });
});
