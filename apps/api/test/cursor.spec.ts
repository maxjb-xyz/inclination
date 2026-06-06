import { describe, expect, it } from "vitest";
import { paginate } from "../src/databases/cursor";

interface R {
  id: string;
}
const rows = (...ids: string[]): R[] => ids.map((id) => ({ id }));
const idOf = (r: R) => r.id;

describe("paginate (cursor pagination helper)", () => {
  it("returns the first page and a nextCursor when more remain", () => {
    const page = paginate(rows("a", "b", "c", "d", "e"), idOf, 2);
    expect(page.items.map(idOf)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });

  it("continues after the cursor", () => {
    const page = paginate(rows("a", "b", "c", "d", "e"), idOf, 2, "b");
    expect(page.items.map(idOf)).toEqual(["c", "d"]);
    expect(page.nextCursor).toBe("d");
  });

  it("returns the last partial page with a null cursor", () => {
    const page = paginate(rows("a", "b", "c", "d", "e"), idOf, 2, "d");
    expect(page.items.map(idOf)).toEqual(["e"]);
    expect(page.nextCursor).toBeNull();
  });

  it("yields a null cursor when the page exactly ends the list", () => {
    const page = paginate(rows("a", "b"), idOf, 2);
    expect(page.items.map(idOf)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBeNull();
  });

  it("restarts from the beginning when the cursor is not found", () => {
    const page = paginate(rows("a", "b", "c"), idOf, 2, "zzz");
    expect(page.items.map(idOf)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });

  it("handles an empty list", () => {
    const page = paginate(rows(), idOf, 10);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
