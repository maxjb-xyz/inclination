/**
 * Formula tokenizer + Pratt/recursive-descent parser → {@link Ast}.
 *
 * Precedence (low → high):
 *   or  →  and  →  comparison (== != < <= > >=)  →  additive (+ -)  →
 *   multiplicative (* / %)  →  unary (- not)  →  primary (literal, prop,
 *   call, parenthesised expression).
 */

import { type Ast, type BinaryOperator, FormulaParseError } from "./formula-ast";

type TokenType =
  | "number"
  | "string"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const KEYWORDS = new Set(["true", "false", "and", "or", "not"]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const push = (type: TokenType, value: string, pos: number) => tokens.push({ type, value, pos });

  while (i < n) {
    const c = src[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    // numbers (with optional decimal)
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      let seenDot = false;
      while (j < n) {
        const d = src[j]!;
        if (d >= "0" && d <= "9") j++;
        else if (d === "." && !seenDot) {
          seenDot = true;
          j++;
        } else break;
      }
      push("number", src.slice(i, j), i);
      i = j;
      continue;
    }
    // leading-dot decimals: .5
    if (c === "." && i + 1 < n && src[i + 1]! >= "0" && src[i + 1]! <= "9") {
      let j = i + 1;
      while (j < n && src[j]! >= "0" && src[j]! <= "9") j++;
      push("number", src.slice(i, j), i);
      i = j;
      continue;
    }

    // strings
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          const esc = src[j + 1]!;
          str += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
          j += 2;
        } else {
          str += src[j];
          j++;
        }
      }
      if (j >= n) throw new FormulaParseError(`unterminated string starting at ${i}`);
      push("string", str, i);
      i = j + 1;
      continue;
    }

    // identifiers / keywords
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      push("ident", src.slice(i, j), i);
      i = j;
      continue;
    }

    // multi-char operators
    const two = src.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") {
      push("op", two, i);
      i += 2;
      continue;
    }

    // single-char tokens
    if (c === "(") {
      push("lparen", c, i);
      i++;
      continue;
    }
    if (c === ")") {
      push("rparen", c, i);
      i++;
      continue;
    }
    if (c === ",") {
      push("comma", c, i);
      i++;
      continue;
    }
    if ("+-*/%<>".includes(c)) {
      push("op", c, i);
      i++;
      continue;
    }

    throw new FormulaParseError(`unexpected character "${c}" at ${i}`);
  }

  push("eof", "", n);
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) throw new FormulaParseError(`expected ${type} but found "${t.value || t.type}" at ${t.pos}`);
    return this.next();
  }

  parse(): Ast {
    const expr = this.parseOr();
    if (this.peek().type !== "eof") {
      const t = this.peek();
      throw new FormulaParseError(`unexpected token "${t.value}" at ${t.pos}`);
    }
    return expr;
  }

  private matchKeyword(kw: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.value.toLowerCase() === kw;
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.matchKeyword("or") || (this.peek().type === "op" && this.peek().value === "||")) {
      this.next();
      const right = this.parseAnd();
      left = { kind: "binary", op: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseComparison();
    while (this.matchKeyword("and") || (this.peek().type === "op" && this.peek().value === "&&")) {
      this.next();
      const right = this.parseComparison();
      left = { kind: "binary", op: "and", left, right };
    }
    return left;
  }

  private parseComparison(): Ast {
    let left = this.parseAdditive();
    while (this.peek().type === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.next().value as BinaryOperator;
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): Ast {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value as BinaryOperator;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Ast {
    let left = this.parseUnary();
    while (this.peek().type === "op" && ["*", "/", "%"].includes(this.peek().value)) {
      const op = this.next().value as BinaryOperator;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Ast {
    if (this.peek().type === "op" && this.peek().value === "-") {
      this.next();
      return { kind: "unary", op: "-", operand: this.parseUnary() };
    }
    if (this.matchKeyword("not")) {
      this.next();
      return { kind: "unary", op: "not", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    const t = this.peek();

    if (t.type === "lparen") {
      this.next();
      const expr = this.parseOr();
      this.expect("rparen");
      return expr;
    }

    if (t.type === "number") {
      this.next();
      return { kind: "number", value: Number(t.value) };
    }

    if (t.type === "string") {
      this.next();
      return { kind: "string", value: t.value };
    }

    if (t.type === "ident") {
      const name = t.value;
      const lower = name.toLowerCase();

      if (lower === "true" || lower === "false") {
        this.next();
        return { kind: "boolean", value: lower === "true" };
      }

      // `prop` / `prop(...)` and generic function calls
      this.next();
      if (this.peek().type === "lparen") {
        this.next();
        const args: Ast[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseOr());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.expect("rparen");

        if (lower === "prop") {
          if (args.length !== 1 || args[0]!.kind !== "string") {
            throw new FormulaParseError(`prop() expects a single string literal argument`);
          }
          return { kind: "prop", name: args[0]!.value };
        }
        return { kind: "call", name: lower, args };
      }

      // bare identifier → property reference by name
      return { kind: "prop", name };
    }

    throw new FormulaParseError(`unexpected token "${t.value || t.type}" at ${t.pos}`);
  }
}

/** Parse a formula expression into an {@link Ast}. Throws {@link FormulaParseError}. */
export function parseFormula(expr: string): Ast {
  const tokens = tokenize(expr);
  return new Parser(tokens).parse();
}
