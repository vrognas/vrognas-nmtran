/**
 * `ERR(n)` binding resolution per NONMEM Help Ch.8 (\$ERROR record).
 *
 * NMTRAN's `ERR(n)` is a synonym for either `EPS(n)` (population fits,
 * `$SIGMA` present) or `ETA(n)` (individual / Bayesian fits, no
 * `$SIGMA`). The choice depends on which random-effect record exists
 * in the document, so this is a static heuristic — not perfect but
 * matches the way NONMEM itself resolves the alias.
 *
 * Used by `parameterReferences` validator + `hoverService` +
 * `definitionService`; lives in `utils/` rather than `validators/`
 * because it is a cross-cutting helper, not a validator itself.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { RECORD_PATTERNS } from './patterns';

export interface ErrBindingResult {
  binding: 'ETA' | 'EPS';
  hasOmega: boolean;
  hasSigma: boolean;
}

export function resolveErrBinding(document: TextDocument): ErrBindingResult {
  const lines = document.getText().split('\n');
  const hasSigma = hasControlRecord(lines, RECORD_PATTERNS.SIGMA);
  const hasOmega = hasControlRecord(lines, RECORD_PATTERNS.OMEGA);
  return { binding: hasSigma ? 'EPS' : 'ETA', hasOmega, hasSigma };
}

function hasControlRecord(lines: string[], pattern: RegExp): boolean {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    if (pattern.test(trimmed)) return true;
  }
  return false;
}
