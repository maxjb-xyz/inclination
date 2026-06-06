import { describe, it, expect } from "vitest";
import {
  validateCellValue,
  isComputed,
  CellValidationError,
} from "../src/property-value";

const selectCfg = {
  options: [
    { id: "o1", name: "A", color: "red" },
    { id: "o2", name: "B", color: "blue" },
  ],
};

describe("isComputed", () => {
  it("flags computed types", () => {
    for (const t of ["formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by"] as const) {
      expect(isComputed(t)).toBe(true);
    }
  });
  it("does not flag settable types", () => {
    for (const t of ["text", "number", "select", "date", "checkbox", "files"] as const) {
      expect(isComputed(t)).toBe(false);
    }
  });
});

describe("validateCellValue — computed types throw", () => {
  it("rejects formula/rollup/created_* directly", () => {
    expect(() => validateCellValue("formula", {}, 1)).toThrow(CellValidationError);
    expect(() => validateCellValue("rollup", {}, 1)).toThrow(CellValidationError);
    expect(() => validateCellValue("created_time", {}, "x")).toThrow(CellValidationError);
  });
});

describe("text/url/email/phone", () => {
  it("passes strings through", () => {
    expect(validateCellValue("text", {}, "hi")).toBe("hi");
    expect(validateCellValue("url", {}, "https://x")).toBe("https://x");
  });
  it("empty string and null → null", () => {
    expect(validateCellValue("text", {}, "")).toBeNull();
    expect(validateCellValue("text", {}, null)).toBeNull();
    expect(validateCellValue("text", {}, undefined)).toBeNull();
  });
  it("rejects non-strings", () => {
    expect(() => validateCellValue("text", {}, 5)).toThrow(/string/);
  });
});

describe("number", () => {
  it("accepts numbers and numeric strings", () => {
    expect(validateCellValue("number", {}, 3.14)).toBe(3.14);
    expect(validateCellValue("number", {}, "42")).toBe(42);
  });
  it("applies precision", () => {
    expect(validateCellValue("number", { precision: 2 }, 3.14159)).toBe(3.14);
    expect(validateCellValue("number", { precision: 0 }, 3.7)).toBe(4);
  });
  it("null → null", () => {
    expect(validateCellValue("number", {}, null)).toBeNull();
  });
  it("rejects NaN/Infinity/non-numeric", () => {
    expect(() => validateCellValue("number", {}, "abc")).toThrow();
    expect(() => validateCellValue("number", {}, Infinity)).toThrow(/finite/);
    expect(() => validateCellValue("number", {}, true)).toThrow();
  });
});

describe("checkbox", () => {
  it("normalizes booleans; empty → false", () => {
    expect(validateCellValue("checkbox", {}, true)).toBe(true);
    expect(validateCellValue("checkbox", {}, false)).toBe(false);
    expect(validateCellValue("checkbox", {}, null)).toBe(false);
  });
  it("rejects non-booleans", () => {
    expect(() => validateCellValue("checkbox", {}, "yes")).toThrow();
  });
});

describe("select / status", () => {
  it("accepts a known option id", () => {
    expect(validateCellValue("select", selectCfg, "o1")).toBe("o1");
  });
  it("rejects unknown option id", () => {
    expect(() => validateCellValue("select", selectCfg, "zzz")).toThrow(/unknown option/);
  });
  it("empty → null", () => {
    expect(validateCellValue("select", selectCfg, null)).toBeNull();
    expect(validateCellValue("select", selectCfg, "")).toBeNull();
  });
});

describe("multi_select", () => {
  it("accepts array of known ids, dedupes", () => {
    expect(validateCellValue("multi_select", selectCfg, ["o1", "o2", "o1"])).toEqual(["o1", "o2"]);
  });
  it("empty array → null", () => {
    expect(validateCellValue("multi_select", selectCfg, [])).toBeNull();
  });
  it("rejects unknown id and non-array", () => {
    expect(() => validateCellValue("multi_select", selectCfg, ["o1", "x"])).toThrow(/unknown/);
    expect(() => validateCellValue("multi_select", selectCfg, "o1")).toThrow(/array/);
  });
});

describe("person", () => {
  it("accepts user ids, dedupes", () => {
    expect(validateCellValue("person", {}, ["u1", "u1", "u2"])).toEqual(["u1", "u2"]);
  });
  it("empty array → null; rejects non-array", () => {
    expect(validateCellValue("person", {}, [])).toBeNull();
    expect(() => validateCellValue("person", {}, "u1")).toThrow();
  });
});

describe("date", () => {
  it("accepts a bare ISO string → {start}", () => {
    expect(validateCellValue("date", {}, "2026-01-15")).toEqual({ start: "2026-01-15" });
  });
  it("accepts {start, end, includeTime}", () => {
    const v = validateCellValue("date", { endDate: true }, {
      start: "2026-01-01",
      end: "2026-01-31",
      includeTime: false,
    });
    expect(v).toEqual({ start: "2026-01-01", end: "2026-01-31", includeTime: false });
  });
  it("accepts a numeric timestamp", () => {
    const ms = Date.UTC(2026, 0, 1);
    expect(validateCellValue("date", {}, ms)).toEqual({ start: new Date(ms).toISOString() });
  });
  it("rejects end before start", () => {
    expect(() =>
      validateCellValue("date", { endDate: true }, { start: "2026-02-01", end: "2026-01-01" }),
    ).toThrow(/end must not be before/);
  });
  it("rejects end when endDate disabled", () => {
    expect(() =>
      validateCellValue("date", { endDate: false }, { start: "2026-01-01", end: "2026-01-02" }),
    ).toThrow(/does not allow an end date/);
  });
  it("rejects invalid ISO", () => {
    expect(() => validateCellValue("date", {}, "not-a-date")).toThrow(/invalid ISO/);
  });
  it("null and {start:null} → null", () => {
    expect(validateCellValue("date", {}, null)).toBeNull();
    expect(validateCellValue("date", {}, { start: null })).toBeNull();
  });
});

describe("files", () => {
  it("accepts url strings and {url,name} objects", () => {
    expect(validateCellValue("files", {}, ["http://a", { url: "http://b", name: "b.png" }])).toEqual([
      { url: "http://a" },
      { url: "http://b", name: "b.png" },
    ]);
  });
  it("empty array → null", () => {
    expect(validateCellValue("files", {}, [])).toBeNull();
  });
  it("rejects empty url and non-array", () => {
    expect(() => validateCellValue("files", {}, [""])).toThrow();
    expect(() => validateCellValue("files", {}, { url: "x" })).toThrow(/array/);
  });
});

describe("relation", () => {
  it("is not set as a cell", () => {
    expect(() => validateCellValue("relation", {}, ["r1"])).toThrow(/relation links/);
  });
});
