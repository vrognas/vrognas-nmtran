/**
 * Public API surface returned from this extension's `activate()`.
 *
 * Consumers (e.g. positron-nonmem) reach it via:
 *   const ext = vscode.extensions.getExtension('vrognas.nmtran');
 *   const api = await ext?.activate() as NmtranApi | undefined;
 *   const model = await api?.getParsedModel(uri);
 *
 * Stable shape; we keep this surface minimal so internal LSP changes
 * don't cascade into consumer extensions. ParsedModel matches the
 * server-side type but is duplicated here so consumers don't need to
 * reach into `server/`. Eventually both ends move to a shared package.
 */

import * as vscode from 'vscode';

/**
 * LSP request method names. Mirrors the server-side constants in
 * `server/src/parsedModel.ts`; duplicated here (along with the wire-
 * format types below) so consumers don't need to reach into `server/`.
 * The two definitions must stay in sync until both ends move to a
 * shared package.
 */
export const PARSED_MODEL_REQUEST = 'nmtran/parsedModel';
export const PARSE_MODEL_TEXT_REQUEST = 'nmtran/parseModelText';

export interface NmtranThetaDecl {
  index: number;
  /**
   * Initial estimate. For bound triples `(low, init, up)` this is the middle term.
   *
   * Edge case: NMTRAN permits an omitted init in a triple, e.g. `$THETA (0,,10)`
   * (lower=0, upper=10, init unspecified). In that single case `init` is `NaN`,
   * which JSON-serialises as `null` over the LSP wire. Consumers that compute
   * with `init` should guard with `Number.isFinite(init)` before use.
   */
  init: number;
  lower?: number;
  upper?: number;
  fix: boolean;
  /** 0-based line number of the declaration in the source. */
  line: number;
  /** Inline `;<comment>` after the decl (Pirana-style label). Available from 0.4.20. */
  comment?: string;
}

export interface NmtranOmegaSigmaDecl {
  index: number;
  value: number;
  fix: boolean;
  /** 0-based line number of the declaration in the source. */
  line: number;
  /** See `NmtranThetaDecl.comment`. */
  comment?: string;
}

export interface NmtranEquation {
  name: string;
  rhs: string;
  block: string;
  line: number;
  /** Pre-computed value under the typical-individual convention; undefined when not evaluable. */
  value: number | undefined;
}

/**
 * `$PRIOR` record entry (`$THETAP` / `$THETAPV` / `$OMEGAP` / `$OMEGAPD`
 * / `$SIGMAP` / `$SIGMAPD`). Indexed per-kind 1-based to align with the
 * matching `$THETA(i)` / `$OMEGA(i,i)` / `$SIGMA(i,i)` declarations.
 * Available from 0.4.23.
 */
export interface NmtranPriorDecl {
  index: number;
  /** Numeric value: mean (`*P`), variance (`*PV`), or degrees of freedom (`*PD`). */
  value: number;
  fix: boolean;
  /** 0-based line number of the declaration in the source. */
  line: number;
  /** Inline `;<comment>` text. */
  comment?: string;
}

export interface NmtranParsedModel {
  dataFile: string | null;
  inputColumns: string[];
  thetas: NmtranThetaDecl[];
  omegas: NmtranOmegaSigmaDecl[];
  sigmas: NmtranOmegaSigmaDecl[];
  equations: NmtranEquation[];
  /** $THETAP — prior MEANS for THETA (NWPRI normal prior). Empty when absent. Available ≥ 0.4.23. */
  thetaPriors: NmtranPriorDecl[];
  /** $THETAPV — diagonal of the prior variance for $THETAP. Available ≥ 0.4.23. */
  thetaPriorVariances: NmtranPriorDecl[];
  /** $OMEGAP — prior MODE for OMEGA (inverse-Wishart prior). Diagonals only. Available ≥ 0.4.23. */
  omegaPriors: NmtranPriorDecl[];
  /** $OMEGAPD — degrees of freedom for OMEGA prior, expanded per-parameter. Available ≥ 0.4.23. */
  omegaPriorDfs: NmtranPriorDecl[];
  /** $SIGMAP — analogous to $OMEGAP. Available ≥ 0.4.23. */
  sigmaPriors: NmtranPriorDecl[];
  /** $SIGMAPD — degrees of freedom for SIGMA prior. Available ≥ 0.4.23. */
  sigmaPriorDfs: NmtranPriorDecl[];
}

export interface NmtranApi {
  /** Returns the structured snapshot for an open NMTRAN file, or null if the server isn't ready or the file is unknown. */
  getParsedModel(uri: vscode.Uri): Promise<NmtranParsedModel | null>;
  /**
   * Parse a control-stream string directly without involving a workspace
   * document. Used by positron-nonmem to parse the embedded control
   * stream from a `.lst` (so the Fit Inspector reflects the model AS
   * RUN, not the current sibling .mod). Available from 0.4.21. Returns
   * null when the LSP server isn't running or when the server-side parse
   * throws; the parser otherwise tolerates malformed input and returns an
   * (empty) snapshot.
   */
  parseModelFromText(text: string): Promise<NmtranParsedModel | null>;
}
