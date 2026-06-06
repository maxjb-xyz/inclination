import { describe, expect, it } from "vitest";
import { computeSortKey, type SortableSibling } from "../src/pages/sort-key";

const siblingsFromKeys = (keys: string[]): SortableSibling[] =>
  keys.map((sortKey, i) => ({ id: `id${i}`, sortKey }));

describe("computeSortKey", () => {
  it("returns a key for the first page in an empty list", () => {
    const k = computeSortKey([]);
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
  });

  it("appends after the last sibling when no anchors are given", () => {
    const sibs = siblingsFromKeys(["a0", "a1"]);
    const k = computeSortKey(sibs);
    expect(k > "a1").toBe(true);
  });

  it("places a page after `beforeId` and before the next sibling", () => {
    const sibs = [
      { id: "x", sortKey: "a0" },
      { id: "y", sortKey: "a2" },
    ];
    const k = computeSortKey(sibs, "x", null);
    expect(k > "a0").toBe(true);
    expect(k < "a2").toBe(true);
  });

  it("places a page before `afterId` and after the previous sibling", () => {
    const sibs = [
      { id: "x", sortKey: "a0" },
      { id: "y", sortKey: "a2" },
    ];
    const k = computeSortKey(sibs, null, "y");
    expect(k > "a0").toBe(true);
    expect(k < "a2").toBe(true);
  });

  it("places a page at the very front when afterId is the first sibling", () => {
    const sibs = [
      { id: "x", sortKey: "a1" },
      { id: "y", sortKey: "a2" },
    ];
    const k = computeSortKey(sibs, null, "x");
    expect(k < "a1").toBe(true);
  });

  it("sorts the input defensively before computing bounds", () => {
    const sibs = [
      { id: "y", sortKey: "a2" },
      { id: "x", sortKey: "a0" },
    ];
    const k = computeSortKey(sibs, "x", null);
    expect(k > "a0").toBe(true);
    expect(k < "a2").toBe(true);
  });

  it("throws when an anchor is not in the sibling list", () => {
    expect(() => computeSortKey(siblingsFromKeys(["a0"]), "missing", null)).toThrow();
    expect(() => computeSortKey(siblingsFromKeys(["a0"]), null, "missing")).toThrow();
  });

  it("produces strictly increasing keys for repeated appends", () => {
    let sibs: SortableSibling[] = [];
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      const k = computeSortKey(sibs);
      keys.push(k);
      sibs = [...sibs, { id: `id${i}`, sortKey: k }];
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
