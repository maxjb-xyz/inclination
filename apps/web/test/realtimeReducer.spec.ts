import { describe, expect, it } from "vitest";
import { patchQueryResult, type DatabaseEvent } from "../src/databases/realtimeReducer";
import type { QueryRowsResult } from "../src/databases/dbTypes";

function baseResult(): QueryRowsResult {
  return {
    rows: [
      { pageId: "r1", cells: { p1: "a" }, computed: {} },
      { pageId: "r2", cells: { p1: "b" }, computed: {} },
    ],
    nextCursor: null,
  };
}

describe("patchQueryResult", () => {
  it("applies a cell.updated event to the matching row", () => {
    const event: DatabaseEvent = {
      databaseId: "db1",
      type: "cell.updated",
      payload: { rowPageId: "r1", propertyId: "p1", value: "z" },
      actorId: "other",
    };
    const next = patchQueryResult(baseResult(), event);
    expect(next).not.toBeNull();
    expect(next?.rows.find((r) => r.pageId === "r1")?.cells.p1).toBe("z");
    // Other rows untouched.
    expect(next?.rows.find((r) => r.pageId === "r2")?.cells.p1).toBe("b");
  });

  it("returns the same reference when the target row is absent", () => {
    const current = baseResult();
    const event: DatabaseEvent = {
      databaseId: "db1",
      type: "cell.updated",
      payload: { rowPageId: "missing", propertyId: "p1", value: "z" },
    };
    expect(patchQueryResult(current, event)).toBe(current);
  });

  it("signals a refetch (null) for row.created / structural events", () => {
    const current = baseResult();
    for (const type of ["row.created", "row.deleted", "property.created", "view.updated"] as const) {
      const event: DatabaseEvent = { databaseId: "db1", type, payload: {} };
      expect(patchQueryResult(current, event)).toBeNull();
    }
  });

  it("returns null when there is no cached result", () => {
    const event: DatabaseEvent = {
      databaseId: "db1",
      type: "cell.updated",
      payload: { rowPageId: "r1", propertyId: "p1", value: "z" },
    };
    expect(patchQueryResult(undefined, event)).toBeNull();
  });
});
