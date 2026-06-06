import { describe, it, expect } from "vitest";
import { computeRollup } from "../src/rollup";
import type { CellValue } from "../src/property-value";

describe("count family", () => {
  const vals: CellValue[] = [1, null, 3, null, 5];
  it("count = total rows", () => {
    expect(computeRollup("count", vals, "number")).toBe(5);
  });
  it("count_empty / count_not_empty", () => {
    expect(computeRollup("count_empty", vals, "number")).toBe(2);
    expect(computeRollup("count_not_empty", vals, "number")).toBe(3);
  });
  it("count_values counts array elements", () => {
    const multi: CellValue[] = [["a", "b"], ["c"], null];
    expect(computeRollup("count_values", multi, "multi_select")).toBe(3);
  });
  it("count_unique", () => {
    expect(computeRollup("count_unique", [1, 1, 2, null], "number")).toBe(2);
    expect(computeRollup("count_unique", [["a"], ["a", "b"]], "multi_select")).toBe(2);
  });
});

describe("numeric aggregations ignore non-numbers", () => {
  const vals: CellValue[] = [10, "skip" as unknown as CellValue, 20, null, 30];
  it("sum / avg / median", () => {
    expect(computeRollup("sum", vals, "number")).toBe(60);
    expect(computeRollup("avg", vals, "number")).toBe(20);
    expect(computeRollup("median", [3, 1, 2], "number")).toBe(2);
    expect(computeRollup("median", [4, 1, 3, 2], "number")).toBe(2.5);
  });
  it("min / max / range", () => {
    expect(computeRollup("min", vals, "number")).toBe(10);
    expect(computeRollup("max", vals, "number")).toBe(30);
    expect(computeRollup("range", vals, "number")).toBe(20);
  });
  it("empty inputs → null", () => {
    expect(computeRollup("avg", [null, null], "number")).toBeNull();
    expect(computeRollup("min", [], "number")).toBeNull();
    expect(computeRollup("median", [], "number")).toBeNull();
  });
});

describe("date aggregations", () => {
  const dv = (s: string) => ({ start: s }) as CellValue;
  const vals: CellValue[] = [dv("2026-03-01"), dv("2026-01-01"), dv("2026-02-01"), null];
  it("earliest / latest", () => {
    expect(computeRollup("earliest", vals, "date")).toBe(new Date("2026-01-01").toISOString());
    expect(computeRollup("latest", vals, "date")).toBe(new Date("2026-03-01").toISOString());
  });
  it("min / max on date type return ISO", () => {
    expect(computeRollup("min", vals, "date")).toBe(new Date("2026-01-01").toISOString());
    expect(computeRollup("max", vals, "date")).toBe(new Date("2026-03-01").toISOString());
  });
  it("range on dates → ms difference", () => {
    const ms = new Date("2026-03-01").getTime() - new Date("2026-01-01").getTime();
    expect(computeRollup("range", vals, "date")).toBe(ms);
  });
  it("empty dates → null", () => {
    expect(computeRollup("earliest", [null], "date")).toBeNull();
  });
});

describe("percent aggregations", () => {
  const checks: CellValue[] = [true, false, true, false];
  it("percent_checked / percent_unchecked", () => {
    expect(computeRollup("percent_checked", checks, "checkbox")).toBe(0.5);
    expect(computeRollup("percent_unchecked", checks, "checkbox")).toBe(0.5);
  });
  it("percent_empty / percent_not_empty", () => {
    const vals: CellValue[] = [1, null, 3, null];
    expect(computeRollup("percent_empty", vals, "number")).toBe(0.5);
    expect(computeRollup("percent_not_empty", vals, "number")).toBe(0.5);
  });
  it("zero rows → null", () => {
    expect(computeRollup("percent_checked", [], "checkbox")).toBeNull();
    expect(computeRollup("percent_empty", [], "number")).toBeNull();
  });
});

describe("show_original", () => {
  it("returns the values list verbatim", () => {
    const vals: CellValue[] = [1, "two", null];
    expect(computeRollup("show_original", vals, "text")).toEqual([1, "two", null]);
  });
});
