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
}

export interface OmegaSigmaDecl {
  /** 1-based parameter index (diagonal element only for 3D scope). */
  index: number;
  /** Initial estimate (variance). */
  value: number;
  /** True when a FIX/FIXED keyword applies. */
  fix: boolean;
}

export interface ParsedModel {
  /** First-token argument of $DATA, or null when no $DATA record is present. */
  dataFile: string | null;
  /** Whitespace-separated $INPUT column names; empty when $INPUT absent. */
  inputColumns: string[];
  thetas: ThetaDecl[];
  omegas: OmegaSigmaDecl[];
  sigmas: OmegaSigmaDecl[];
}

/** LSP request method name; consumers should use this constant. */
export const PARSED_MODEL_REQUEST = 'nmtran/parsedModel';
