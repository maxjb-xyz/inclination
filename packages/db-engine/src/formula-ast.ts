/**
 * Formula AST node definitions.
 *
 * The grammar (recursive descent / Pratt) supports:
 *   - literals: number, string ("..." or '...'), boolean (true/false)
 *   - property references: prop("Name") or a bare/quoted identifier
 *   - unary: -x, not x
 *   - binary arithmetic: + - * / %
 *   - comparisons: == != < <= > >=
 *   - logical: and, or, &&, ||
 *   - parentheses for grouping
 *   - function calls (bounded set — see FUNCTIONS in formula-eval)
 */

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or";

export type UnaryOperator = "-" | "not";

export type Ast =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "prop"; name: string }
  | { kind: "unary"; op: UnaryOperator; operand: Ast }
  | { kind: "binary"; op: BinaryOperator; left: Ast; right: Ast }
  | { kind: "call"; name: string; args: Ast[] };

/** A parse error raised by the formula tokenizer/parser. */
export class FormulaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaParseError";
  }
}

/** Raised when an AST cannot be evaluated (bad arity, unknown fn, divide by 0). */
export class FormulaEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaEvalError";
  }
}
