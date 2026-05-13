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

export interface NmtranThetaDecl {
  index: number;
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

export interface NmtranParsedModel {
  dataFile: string | null;
  inputColumns: string[];
  thetas: NmtranThetaDecl[];
  omegas: NmtranOmegaSigmaDecl[];
  sigmas: NmtranOmegaSigmaDecl[];
  equations: NmtranEquation[];
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
