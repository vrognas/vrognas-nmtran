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
  /**
   * Inline `;<comment>` text following the decl on its source line, trimmed.
   * Pirana-style label convention: `$THETA 1 ;CL` → comment="CL". Multi-decl
   * lines: by NMTRAN spec a `;` runs to EOL, so only the LAST decl on a
   * shared line will resolve a non-empty comment; earlier decls return
   * undefined (their region between values has no `;`). Undefined when the
   * line has no `;` after the value.
   */
  comment?: string;
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
  /** See `ThetaDecl.comment`. */
  comment?: string;
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

/**
 * Prior-record entry (`$THETAP` / `$THETAPV` / `$OMEGAP` / `$OMEGAPD`
 * / `$SIGMAP` / `$SIGMAPD`). Indexed per-kind 1-based to align with the
 * matching `$THETA(i)` / `$OMEGA(i,i)` / `$SIGMA(i,i)` declarations.
 * Surfaced by the consumer (positron-nonmem Fit Inspector) as P / PV /
 * PD columns alongside the parameter tables.
 *
 * Available from vscode-nmtran ≥ 0.4.23.
 */
export interface PriorDecl {
  /** 1-based parameter index this prior applies to. */
  index: number;
  /** Numeric value: mean (`*P`), variance (`*PV`), or degrees of freedom (`*PD`). */
  value: number;
  /** True when `FIX`/`FIXED` keyword applies. Per NM 7 docs `FIX` should be used for priors. */
  fix: boolean;
  /** 0-based line number of the declaration in the source. */
  line: number;
  /** Inline `;<comment>` text. */
  comment?: string;
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
  /** $THETAP — prior MEANS for THETA (NWPRI normal prior). Empty when record absent. Available ≥ 0.4.23. */
  thetaPriors: PriorDecl[];
  /** $THETAPV — diagonal of the prior variance for $THETAP. Off-diagonals of BLOCK form are not surfaced. Empty when record absent. Available ≥ 0.4.23. */
  thetaPriorVariances: PriorDecl[];
  /** $OMEGAP — prior MODE for OMEGA (inverse-Wishart prior). Mirrors $OMEGA structure (scalar + BLOCK + SAME). Diagonals only. Available ≥ 0.4.23. */
  omegaPriors: PriorDecl[];
  /** $OMEGAPD — degrees of freedom for OMEGA prior, expanded per-parameter from the source's per-block scalars. Available ≥ 0.4.23. */
  omegaPriorDfs: PriorDecl[];
  /** $SIGMAP — analogous to $OMEGAP. Available ≥ 0.4.23. */
  sigmaPriors: PriorDecl[];
  /** $SIGMAPD — degrees of freedom for SIGMA prior. Available ≥ 0.4.23. */
  sigmaPriorDfs: PriorDecl[];
}

/** LSP request method name; consumers should use this constant. */
export const PARSED_MODEL_REQUEST = 'nmtran/parsedModel';

/**
 * LSP request method name for the text-based variant (parse a control-stream
 * string directly without a workspace document). Available ≥ 0.4.21.
 */
export const PARSE_MODEL_TEXT_REQUEST = 'nmtran/parseModelText';
