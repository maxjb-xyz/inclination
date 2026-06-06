import { describe, it, expect } from "vitest";
import { parseFormula } from "../src/formula-parser";
import { FormulaParseError } from "../src/formula-ast";
import {
  evaluateFormula,
  isFormulaError,
  type FormulaContext,
  type FormulaValue,
} from "../src/formula-eval";

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function ctx(props: Record<string, number | string | boolean | null> = {}): FormulaContext {
  return {
    resolve: (name) => (name in props ? props[name] : undefined),
    now: NOW,
  };
}

function evalExpr(expr: string, props?: Record<string, number | string | boolean | null>): FormulaValue {
  return evaluateFormula(parseFormula(expr), ctx(props));
}

describe("parser", () => {
  it("parses literals", () => {
    expect(parseFormula("42")).toEqual({ kind: "number", value: 42 });
    expect(parseFormula("3.14")).toEqual({ kind: "number", value: 3.14 });
    expect(parseFormula('"hi"')).toEqual({ kind: "string", value: "hi" });
    expect(parseFormula("'hi'")).toEqual({ kind: "string", value: "hi" });
    expect(parseFormula("true")).toEqual({ kind: "boolean", value: true });
  });
  it("parses prop() and bare identifiers", () => {
    expect(parseFormula('prop("Score")')).toEqual({ kind: "prop", name: "Score" });
    expect(parseFormula("Score")).toEqual({ kind: "prop", name: "Score" });
  });
  it("respects precedence: 1 + 2 * 3", () => {
    const ast = parseFormula("1 + 2 * 3");
    expect(ast).toMatchObject({ kind: "binary", op: "+", left: { value: 1 } });
  });
  it("parentheses override precedence", () => {
    expect(evalExpr("(1 + 2) * 3")).toBe(9);
  });
  it("rejects unterminated string", () => {
    expect(() => parseFormula('"oops')).toThrow(FormulaParseError);
  });
  it("rejects trailing junk and bad prop()", () => {
    expect(() => parseFormula("1 2")).toThrow(FormulaParseError);
    expect(() => parseFormula("prop(1)")).toThrow(FormulaParseError);
  });
});

describe("arithmetic", () => {
  it("+ - * / %", () => {
    expect(evalExpr("2 + 3")).toBe(5);
    expect(evalExpr("10 - 4")).toBe(6);
    expect(evalExpr("6 * 7")).toBe(42);
    expect(evalExpr("9 / 2")).toBe(4.5);
    expect(evalExpr("10 % 3")).toBe(1);
  });
  it("unary minus", () => {
    expect(evalExpr("-5 + 2")).toBe(-3);
    expect(evalExpr("-(3 * 2)")).toBe(-6);
  });
  it("division/modulo by zero → error value", () => {
    const e = evalExpr("1 / 0");
    expect(isFormulaError(e)).toBe(true);
    expect((e as { error: string }).error).toMatch(/division by zero/);
    expect(isFormulaError(evalExpr("1 % 0"))).toBe(true);
  });
});

describe("comparisons & logic", () => {
  it("numeric comparisons", () => {
    expect(evalExpr("3 < 5")).toBe(true);
    expect(evalExpr("5 <= 5")).toBe(true);
    expect(evalExpr("5 > 6")).toBe(false);
    expect(evalExpr("2 == 2")).toBe(true);
    expect(evalExpr("2 != 3")).toBe(true);
  });
  it("and / or / not (keywords and symbols)", () => {
    expect(evalExpr("true and false")).toBe(false);
    expect(evalExpr("true && true")).toBe(true);
    expect(evalExpr("false or true")).toBe(true);
    expect(evalExpr("false || false")).toBe(false);
    expect(evalExpr("not false")).toBe(true);
  });
  it("short-circuits (no error in untaken and-branch)", () => {
    expect(evalExpr("false and (1 / 0 == 0)")).toBe(false);
    expect(evalExpr("true or (1 / 0 == 0)")).toBe(true);
  });
});

describe("string concat", () => {
  it("+ concatenates when a side is a string", () => {
    expect(evalExpr('"a" + "b"')).toBe("ab");
    expect(evalExpr('"n=" + 5')).toBe("n=5");
  });
  it("concat() function", () => {
    expect(evalExpr('concat("a", "b", 3)')).toBe("ab3");
  });
});

describe("function set", () => {
  it("if()", () => {
    expect(evalExpr('if(1 < 2, "yes", "no")')).toBe("yes");
    expect(evalExpr('if(1 > 2, "yes", "no")')).toBe("no");
  });
  it("if() lazily evaluates branches (untaken error branch is safe)", () => {
    expect(evalExpr("if(true, 1, 1 / 0)")).toBe(1);
  });
  it("length/upper/lower/contains", () => {
    expect(evalExpr('length("hello")')).toBe(5);
    expect(evalExpr('upper("abc")')).toBe("ABC");
    expect(evalExpr('lower("ABC")')).toBe("abc");
    expect(evalExpr('contains("hello", "ell")')).toBe(true);
  });
  it("abs/round/floor/ceil/min/max", () => {
    expect(evalExpr("abs(-7)")).toBe(7);
    expect(evalExpr("round(3.14159, 2)")).toBe(3.14);
    expect(evalExpr("round(3.7)")).toBe(4);
    expect(evalExpr("floor(3.9)")).toBe(3);
    expect(evalExpr("ceil(3.1)")).toBe(4);
    expect(evalExpr("min(3, 1, 2)")).toBe(1);
    expect(evalExpr("max(3, 1, 2)")).toBe(3);
  });
  it("not() / empty()", () => {
    expect(evalExpr("not(true)")).toBe(false);
    expect(evalExpr('empty("")')).toBe(true);
    expect(evalExpr("empty(0)")).toBe(false);
  });
  it("now() returns injected time as ISO", () => {
    expect(evalExpr("now()")).toBe(new Date(NOW).toISOString());
  });
  it("unknown function → error value", () => {
    expect(isFormulaError(evalExpr("bogus(1)"))).toBe(true);
  });
  it("bad arity → error value", () => {
    expect(isFormulaError(evalExpr("length(1, 2)"))).toBe(true);
    expect(isFormulaError(evalExpr("abs()"))).toBe(true);
  });
});

describe("property references", () => {
  it("resolves prop() and bare names", () => {
    expect(evalExpr('prop("Score") * 2', { Score: 21 })).toBe(42);
    expect(evalExpr("Score + 1", { Score: 9 })).toBe(10);
  });
  it("null property coerces (0 in arithmetic, '' in concat)", () => {
    expect(evalExpr("Score + 1", { Score: null })).toBe(1);
    expect(evalExpr('Name + "!"', { Name: null })).toBe("!");
  });
  it("unknown property → error value", () => {
    expect(isFormulaError(evalExpr("Missing + 1", {}))).toBe(true);
  });
});

describe("end-to-end formulas (the gate's working formula)", () => {
  it("if(prop is done) labels complete", () => {
    const expr = 'if(prop("Done"), "✓ " + prop("Title"), prop("Title"))';
    expect(evalExpr(expr, { Done: true, Title: "Task A" })).toBe("✓ Task A");
    expect(evalExpr(expr, { Done: false, Title: "Task A" })).toBe("Task A");
  });
  it("never throws to caller — returns {error}", () => {
    const r = evalExpr('prop("X") / 0', { X: 5 });
    expect(isFormulaError(r)).toBe(true);
  });
});
