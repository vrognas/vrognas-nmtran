/**
 * Tiny NMTRAN expression evaluator — strictly arithmetic over numeric
 * literals, identifiers, and parameter-array references like THETA(n) /
 * ETA(n) / EPS(n) / OMEGA(n,n) / SIGMA(n,n).
 *
 * Returns undefined for anything outside this subset (function calls
 * EXP/LOG/…, comparison operators .GT./.LT./…, IF/THEN, indexed LHS like
 * A(1), continuation lines). Callers should treat undefined as
 * "can't evaluate yet" — not as an error.
 */

export interface EvalContext {
  thetas: Map<number, number>;
  /** OMEGA diagonal values, indexed by 1-based parameter index. */
  omegas: Map<number, number>;
  /** SIGMA diagonal values, indexed by 1-based parameter index. */
  sigmas: Map<number, number>;
  /** Bindings from prior equations (LHS identifier → numeric value). */
  bindings: Map<string, number>;
}

export function evaluate(rhs: string, ctx: EvalContext): number | undefined {
  const parser = new Parser(rhs, ctx);
  try {
    const value = parser.parseExpression();
    if (parser.hasMore()) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

const NUMBER_RE = /^[0-9]+(?:\.[0-9]*)?(?:[eEdD][+-]?[0-9]+)?|^\.[0-9]+(?:[eEdD][+-]?[0-9]+)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Identifiers that, when followed by `(...)`, denote indexed-array access (not a function call). */
const INDEXED_ARRAYS = new Set(['THETA', 'ETA', 'EPS', 'ERR', 'OMEGA', 'SIGMA']);

class Parser {
  private pos = 0;
  constructor(
    private readonly src: string,
    private readonly ctx: EvalContext,
  ) {}

  hasMore(): boolean {
    this.skipWs();
    return this.pos < this.src.length;
  }

  parseExpression(): number {
    return this.parseAddSub();
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    while (true) {
      this.skipWs();
      const ch = this.peek();
      if (ch === '+') {
        this.pos++;
        left = left + this.parseMulDiv();
      } else if (ch === '-') {
        this.pos++;
        left = left - this.parseMulDiv();
      } else break;
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parsePower();
    while (true) {
      this.skipWs();
      const ch = this.peek();
      if (ch === '*' && this.peek(1) !== '*') {
        this.pos++;
        left = left * this.parsePower();
      } else if (ch === '/') {
        this.pos++;
        left = left / this.parsePower();
      } else break;
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    this.skipWs();
    if (this.peek() === '*' && this.peek(1) === '*') {
      this.pos += 2;
      return Math.pow(base, this.parsePower()); // right-associative
    }
    return base;
  }

  private parseUnary(): number {
    this.skipWs();
    if (this.peek() === '-') {
      this.pos++;
      return -this.parseUnary();
    }
    if (this.peek() === '+') {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWs();
    const ch = this.peek();
    if (ch === '(') {
      this.pos++;
      const v = this.parseExpression();
      this.skipWs();
      if (this.peek() !== ')') throw new Error('expected )');
      this.pos++;
      return v;
    }
    const num = this.tryReadNumber();
    if (num !== undefined) return num;
    return this.parseIdentifier();
  }

  private tryReadNumber(): number | undefined {
    const m = this.src.slice(this.pos).match(NUMBER_RE);
    if (!m) return undefined;
    this.pos += m[0].length;
    // NMTRAN accepts D-exponent (FORTRAN double-precision); JS only knows e/E.
    const normalised = m[0].replace(/[dD]/, 'e');
    return parseFloat(normalised);
  }

  private parseIdentifier(): number {
    const m = this.src.slice(this.pos).match(IDENT_RE);
    if (!m) throw new Error('expected identifier');
    const name = m[0].toUpperCase();
    this.pos += m[0].length;
    this.skipWs();
    if (this.peek() === '(') {
      this.pos++;
      const args = this.parseArgList();
      if (this.peek() !== ')') throw new Error('expected )');
      this.pos++;
      if (INDEXED_ARRAYS.has(name)) {
        return this.resolveIndexed(name, args);
      }
      return this.resolveFunctionCall(name, args);
    }
    return this.resolveBare(name);
  }

  private parseArgList(): number[] {
    const args: number[] = [];
    this.skipWs();
    if (this.peek() === ')') return args;
    args.push(this.parseExpression());
    while (true) {
      this.skipWs();
      if (this.peek() !== ',') break;
      this.pos++;
      args.push(this.parseExpression());
    }
    return args;
  }

  private resolveIndexed(name: string, args: number[]): number {
    const idx1 = Math.floor(args[0] ?? NaN);
    const idx2 = args.length > 1 ? Math.floor(args[1]!) : undefined;
    if (name === 'THETA') {
      const v = this.ctx.thetas.get(idx1);
      if (v === undefined) throw new Error(`THETA(${idx1}) undeclared`);
      return v;
    }
    if (name === 'ETA' || name === 'EPS' || name === 'ERR') {
      // Random effects evaluate to their mean (0) for the typical-individual view.
      return 0;
    }
    if (name === 'OMEGA' || name === 'SIGMA') {
      // Diagonals only for now; ParameterScanner doesn't yet emit off-diagonals.
      if (idx2 !== undefined && idx1 !== idx2) {
        throw new Error('off-diagonal not supported');
      }
      const map = name === 'OMEGA' ? this.ctx.omegas : this.ctx.sigmas;
      const v = map.get(idx1);
      if (v === undefined) throw new Error(`${name}(${idx1}) undeclared`);
      return v;
    }
    throw new Error(`indexed array not supported: ${name}`);
  }

  /**
   * Evaluate a NONMEM intrinsic function call. Covers the common
   * arithmetic/transcendental set; protective variants (P-prefixed) map
   * to the same behaviour because we don't simulate domain-violation
   * recovery — values that overflow or hit log(0) just become NaN.
   * Functions outside this set throw, which the outer evaluator catches
   * and surfaces as `value: undefined`.
   */
  private resolveFunctionCall(name: string, args: number[]): number {
    switch (name) {
      case 'LOG':
      case 'PLOG':
        return Math.log(args[0]!);
      case 'LOG10':
        return Math.log10(args[0]!);
      case 'EXP':
      case 'PEXP':
        return Math.exp(args[0]!);
      case 'SQRT':
      case 'PSQRT':
        return Math.sqrt(args[0]!);
      case 'ABS':
        return Math.abs(args[0]!);
      case 'SIN':
      case 'PSIN':
        return Math.sin(args[0]!);
      case 'COS':
      case 'PCOS':
        return Math.cos(args[0]!);
      case 'TAN':
      case 'PTAN':
        return Math.tan(args[0]!);
      case 'ASIN':
        return Math.asin(args[0]!);
      case 'ACOS':
        return Math.acos(args[0]!);
      case 'ATAN':
        return Math.atan(args[0]!);
      case 'MIN':
        return Math.min(...args);
      case 'MAX':
        return Math.max(...args);
      case 'MOD':
        return args[0]! % args[1]!;
      case 'INT':
        return Math.trunc(args[0]!);
      default:
        throw new Error(`function not supported: ${name}`);
    }
  }

  private resolveBare(name: string): number {
    const v = this.ctx.bindings.get(name);
    if (v === undefined) throw new Error(`undefined identifier: ${name}`);
    return v;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src.charAt(this.pos))) this.pos++;
  }

  private peek(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }
}
