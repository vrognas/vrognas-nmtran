/**
 * Shared shape for positional NMTRAN diagnostics. Each validator under
 * `validators/` returns a `ValidationResult`; the diagnostics service
 * walks the errors and converts them to LSP `Diagnostic` objects.
 *
 * `validateSequentialNumbering` returns a non-positional variant
 * (`{ errors: string[] }`) because gap diagnostics are file-level, not
 * tied to a specific line — it keeps its own local shape.
 */

export interface ValidationError {
  message: string;
  /** 0-based line. */
  line: number;
  /** 0-based start column. */
  startChar: number;
  /** 0-based exclusive end column. */
  endChar: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}
