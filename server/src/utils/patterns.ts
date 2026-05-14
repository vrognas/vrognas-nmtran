/**
 * Shared NMTRAN regex patterns. Both `ParameterScanner` and `definitionService`
 * spread these into their file-local `PARAMETER_PATTERNS` objects, so existing
 * `PARAMETER_PATTERNS.THETA` call sites work unchanged while the source of
 * truth lives in one place.
 *
 * File-specific patterns (FIXED variants, NUMERIC, WHITESPACE, …) stay local
 * to the file that needs them.
 */

/** `$RECORD` headers — anchored, case-insensitive, must be followed by whitespace or EOL. */
export const RECORD_PATTERNS = {
  THETA: /^\$THETA(\s|$)/i,
  OMEGA: /^\$OMEGA(\s|$)/i,
  SIGMA: /^\$SIGMA(\s|$)/i,
} as const;

/** `BLOCK(n)` keyword — captures the block size. */
export const BLOCK_RE = /BLOCK\((\d+)\)/i;

/**
 * `$RECORD` token (uppercase A-Z only). Caller must use `/g` for iteration;
 * the factory exists so each caller mints its own instance and avoids
 * `lastIndex` contamination from prior runs.
 */
export function createControlRecordRegex(): RegExp {
  return /\$[A-Z]+\b/g;
}

/** `SAME` keyword — word-boundary, case-insensitive. */
export const SAME_RE = /\bSAME\b/i;

/**
 * Parameter reference (`THETA(n)` / `ETA(n)` / `EPS(n)` / `ERR(n)`). Exposed
 * as a source string + factory so callers that iterate with `/g` can mint
 * fresh `RegExp` instances to avoid `lastIndex` contamination.
 */
export const PARAMETER_REFERENCE_SOURCE = '\\b(THETA|ETA|EPS|ERR)\\((\\d+)\\)';

export function createParameterReferenceRegex(): RegExp {
  return new RegExp(PARAMETER_REFERENCE_SOURCE, 'gi');
}
