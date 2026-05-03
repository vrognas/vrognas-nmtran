/**
 * Wire-format types for the `nmtran/parsedModel` LSP request.
 *
 * Consumers (positron-nonmem's Variables-pane / Run Inspector) call this
 * to get a structured snapshot of a NMTRAN file's declarations without
 * re-implementing parsing. Privacy-safe: just declared values + ranges,
 * no host info or runtime state.
 */

export interface ThetaDecl {
  /** 1-based THETA index. */
  index: number;
  /** Initial estimate. For bound triples (low, init, up) this is the middle term. */
  init: number;
  /** Lower bound, when declared via parenthesised expression. */
  lower?: number;
  /** Upper bound, when declared via parenthesised expression. */
  upper?: number;
  /** True when a FIX/FIXED keyword applies to this declaration. */
  fix: boolean;
  /** 0-based line number of the declaration in the source. */
  line: number;
}

export interface OmegaSigmaDecl {
  /** 1-based parameter index (diagonal element only for 3D scope). */
  index: number;
  /** Initial estimate (variance). */
  value: number;
  /** True when a FIX/FIXED keyword applies. */
  fix: boolean;
  /** 0-based line number of the declaration in the source. */
  line: number;
}

/**
 * A top-level assignment captured from $PRED / $PK / $ERROR / $DES / $MIX
 * blocks. `name = rhs` lines only — IF/THEN/ELSE bodies, indexed LHS like
 * `A(1) = …`, and continuation lines are deferred.
 */
export interface Equation {
  /** LHS identifier, e.g. `Y`, `CL`, `DX`. */
  name: string;
  /** Right-hand-side text, comments stripped. */
  rhs: string;
  /** Owning abbreviated-code block, e.g. `$PRED`. */
  block: string;
  /** 0-based line number in the source. */
  line: number;
  /**
   * Pre-computed evaluation under the typical-individual convention:
   * THETA(n)→init, ETA(n)→0, EPS(n)→0, OMEGA/SIGMA→variance, prior bindings
   * resolved in source order. Undefined when the RHS uses unsupported
   * syntax (function calls, .GT./.LT./… comparisons, etc.).
   */
  value: number | undefined;
}

export interface ParsedModel {
  /** First-token argument of $DATA, or null when no $DATA record is present. */
  dataFile: string | null;
  /** Whitespace-separated $INPUT column names; empty when $INPUT absent. */
  inputColumns: string[];
  thetas: ThetaDecl[];
  omegas: OmegaSigmaDecl[];
  sigmas: OmegaSigmaDecl[];
  equations: Equation[];
}

/** LSP request method name; consumers should use this constant. */
export const PARSED_MODEL_REQUEST = 'nmtran/parsedModel';
