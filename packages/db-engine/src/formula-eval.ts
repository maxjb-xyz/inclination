/**
 * Formula evaluator — evaluate an {@link Ast} against a row context.
 *
 * Never throws to the caller: any failure (parse already done elsewhere,
 * divide-by-zero, unknown function, bad arity, unresolved property) is caught
 * and returned as a {@link FormulaErrorValue}. Time is injected via `ctx.now`
 * (no Date.now), keeping evaluation deterministic.
 *
 * Bounded function set (documented):
 *   if(cond, a, b)        – ternary
 *   not(x)                – logical negation
 *   empty(x)              – true when x is null/""/empty
 *   concat(...args)       – string concatenation
 *   length(s)             – string length
 *   upper(s) / lower(s)   – case
 *   contains(s, sub)      – substring test (boolean)
 *   abs/round/floor/ceil(x)
 *   min(...nums) / max(...nums)
 *   now()                 – injected current time, as an ISO string
 */

import { type Ast, FormulaEvalError } from "./formula-ast";

/** A formula value is a number, string, boolean, null, or an error sentinel. */
export type FormulaValue = number | string | boolean | null | FormulaErrorValue;

/** The sentinel returned (never thrown) when evaluation fails. */
export interface FormulaErrorValue {
  error: string;
}

export function isFormulaError(v: FormulaValue): v is FormulaErrorValue {
  return typeof v === "object" && v !== null && "error" in v;
}

/** Resolves property references and supplies the injected clock. */
export interface FormulaContext {
  /**
   * Resolve a property reference (by name) to a primitive. Return `undefined`
   * for an unknown property name (→ evaluation error) and `null` for a known
   * but empty cell.
   */
  resolve(name: string): number | string | boolean | null | undefined;
  /** Injected current time (ms epoch) for now(). */
  now: number;
}

// ── coercions ─────────────────────────────────────────────────

function toNumber(v: FormulaValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isNaN(n)) throw new FormulaEvalError(`cannot convert "${v}" to a number`);
    return n;
  }
  if (v === null) return 0;
  throw new FormulaEvalError("cannot convert error value to a number");
}

function toStr(v: FormulaValue): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToStr(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "";
  throw new FormulaEvalError("cannot convert error value to a string");
}

function numToStr(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (v === null) return false;
  throw new FormulaEvalError("cannot convert error value to a boolean");
}

function isEmptyVal(v: FormulaValue): boolean {
  return v === null || v === "" || (typeof v === "number" && Number.isNaN(v));
}

// ── operators ─────────────────────────────────────────────────

function applyBinary(op: string, l: FormulaValue, r: FormulaValue): FormulaValue {
  switch (op) {
    case "+":
      // string concat if either side is a string; else numeric add
      if (typeof l === "string" || typeof r === "string") return toStr(l) + toStr(r);
      return toNumber(l) + toNumber(r);
    case "-":
      return toNumber(l) - toNumber(r);
    case "*":
      return toNumber(l) * toNumber(r);
    case "/": {
      const d = toNumber(r);
      if (d === 0) throw new FormulaEvalError("division by zero");
      return toNumber(l) / d;
    }
    case "%": {
      const d = toNumber(r);
      if (d === 0) throw new FormulaEvalError("modulo by zero");
      return toNumber(l) % d;
    }
    case "==":
      return looseEq(l, r);
    case "!=":
      return !looseEq(l, r);
    case "<":
      return compare(l, r) < 0;
    case "<=":
      return compare(l, r) <= 0;
    case ">":
      return compare(l, r) > 0;
    case ">=":
      return compare(l, r) >= 0;
    case "and":
      return toBool(l) && toBool(r);
    case "or":
      return toBool(l) || toBool(r);
    default:
      throw new FormulaEvalError(`unknown operator "${op}"`);
  }
}

function looseEq(l: FormulaValue, r: FormulaValue): boolean {
  if (typeof l === "string" || typeof r === "string") {
    if ((l === null && r === "") || (r === null && l === "")) return true;
    return toStr(l) === toStr(r);
  }
  if (typeof l === "boolean" || typeof r === "boolean") return toBool(l) === toBool(r);
  return toNumber(l) === toNumber(r);
}

function compare(l: FormulaValue, r: FormulaValue): number {
  if (typeof l === "string" || typeof r === "string") {
    const a = toStr(l);
    const b = toStr(r);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = toNumber(l);
  const b = toNumber(r);
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── functions ─────────────────────────────────────────────────

type FnImpl = (args: FormulaValue[], ctx: FormulaContext) => FormulaValue;

function expectArity(name: string, args: FormulaValue[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const range = min === max ? `${min}` : `${min}–${max}`;
    throw new FormulaEvalError(`${name}() expects ${range} argument(s), got ${args.length}`);
  }
}

export const FUNCTIONS: Record<string, FnImpl> = {
  if: (a) => {
    expectArity("if", a, 3);
    return toBool(a[0]!) ? a[1]! : a[2]!;
  },
  not: (a) => {
    expectArity("not", a, 1);
    return !toBool(a[0]!);
  },
  empty: (a) => {
    expectArity("empty", a, 1);
    return isEmptyVal(a[0]!);
  },
  concat: (a) => a.map((v) => toStr(v)).join(""),
  length: (a) => {
    expectArity("length", a, 1);
    return toStr(a[0]!).length;
  },
  upper: (a) => {
    expectArity("upper", a, 1);
    return toStr(a[0]!).toUpperCase();
  },
  lower: (a) => {
    expectArity("lower", a, 1);
    return toStr(a[0]!).toLowerCase();
  },
  contains: (a) => {
    expectArity("contains", a, 2);
    return toStr(a[0]!).includes(toStr(a[1]!));
  },
  abs: (a) => {
    expectArity("abs", a, 1);
    return Math.abs(toNumber(a[0]!));
  },
  round: (a) => {
    expectArity("round", a, 1, 2);
    const n = toNumber(a[0]!);
    const places = a.length === 2 ? toNumber(a[1]!) : 0;
    const f = 10 ** places;
    return Math.round(n * f) / f;
  },
  floor: (a) => {
    expectArity("floor", a, 1);
    return Math.floor(toNumber(a[0]!));
  },
  ceil: (a) => {
    expectArity("ceil", a, 1);
    return Math.ceil(toNumber(a[0]!));
  },
  min: (a) => {
    if (a.length === 0) throw new FormulaEvalError("min() expects at least 1 argument");
    return Math.min(...a.map((v) => toNumber(v)));
  },
  max: (a) => {
    if (a.length === 0) throw new FormulaEvalError("max() expects at least 1 argument");
    return Math.max(...a.map((v) => toNumber(v)));
  },
  now: (a, ctx) => {
    expectArity("now", a, 0);
    return new Date(ctx.now).toISOString();
  },
};

// ── evaluation ────────────────────────────────────────────────

function evalNode(node: Ast, ctx: FormulaContext): FormulaValue {
  switch (node.kind) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "prop": {
      const v = ctx.resolve(node.name);
      if (v === undefined) throw new FormulaEvalError(`unknown property "${node.name}"`);
      return v;
    }
    case "unary": {
      const operand = evalNode(node.operand, ctx);
      if (node.op === "-") return -toNumber(operand);
      return !toBool(operand);
    }
    case "binary": {
      // short-circuit logicals
      if (node.op === "and") {
        return toBool(evalNode(node.left, ctx)) ? toBool(evalNode(node.right, ctx)) : false;
      }
      if (node.op === "or") {
        return toBool(evalNode(node.left, ctx)) ? true : toBool(evalNode(node.right, ctx));
      }
      return applyBinary(node.op, evalNode(node.left, ctx), evalNode(node.right, ctx));
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaEvalError(`unknown function "${node.name}"`);
      // `if` is evaluated eagerly here (both branches), which is fine for pure
      // values; division-by-zero etc. in an untaken branch would still error.
      // To match spreadsheet semantics we evaluate args lazily for `if`.
      if (node.name === "if") {
        const cond = evalNode(node.args[0]!, ctx);
        if (node.args.length !== 3) throw new FormulaEvalError("if() expects 3 arguments");
        return toBool(cond) ? evalNode(node.args[1]!, ctx) : evalNode(node.args[2]!, ctx);
      }
      const args = node.args.map((a) => evalNode(a, ctx));
      return fn(args, ctx);
    }
    default:
      throw new FormulaEvalError("unknown AST node");
  }
}

/**
 * Evaluate a formula AST against `ctx`. Returns a {@link FormulaValue}; on any
 * error returns a {@link FormulaErrorValue} (`{ error }`) rather than throwing.
 */
export function evaluateFormula(ast: Ast, ctx: FormulaContext): FormulaValue {
  try {
    return evalNode(ast, ctx);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
