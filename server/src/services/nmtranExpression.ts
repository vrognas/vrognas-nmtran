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
      const idx1 = Math.floor(this.parseExpression());
      this.skipWs();
      let idx2: number | undefined;
      if (this.peek() === ',') {
        this.pos++;
        idx2 = Math.floor(this.parseExpression());
        this.skipWs();
      }
      if (this.peek() !== ')') throw new Error('expected )');
      this.pos++;
      return this.resolveIndexed(name, idx1, idx2);
    }
    return this.resolveBare(name);
  }

  private resolveIndexed(name: string, idx1: number, idx2: number | undefined): number {
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
    // Anything else with parens is a function call (LOG, EXP, ...) — not supported.
    throw new Error(`function not supported: ${name}`);
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
