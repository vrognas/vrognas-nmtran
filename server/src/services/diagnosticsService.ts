/**
 * Diagnostics Service
 *
 * Orchestrates per-validator runs and translates each validator's
 * positional `ValidationError` (or file-level error string from
 * `validateSequentialNumbering`) into an LSP `Diagnostic`. The
 * mapping between `ValidationError → Diagnostic` is uniform and
 * lives in two small helpers below.
 */

import { Connection, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  locateControlRecordsInText,
  generateDiagnosticForControlRecord,
} from '../utils/validateControlRecords';
import { ParameterScanner } from './ParameterScanner';
import { validateSequentialNumbering } from '../validators/sequentialNumbering';
import { validateSameKeywordUsage } from '../validators/sameKeywordUsage';
import { validateComIndices } from '../validators/comIndices';
import { validateInfinityTokenUsage } from '../validators/infinityTokens';
import { validateParameterReferencesWithParameters } from '../validators/parameterReferences';
import { validateBlockMatrixSyntax } from '../validators/blockMatrixSyntax';
import { validateParameterBounds } from '../validators/parameterBounds';
import { validateContinuationMarkers } from '../validators/continuationMarkers';
import { ValidationError, ValidationResult } from '../validators/types';

/** Convert a positional `ValidationError` to an LSP `Diagnostic`. */
function toPositionalDiagnostic(
  error: ValidationError,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
): Diagnostic {
  return {
    severity,
    range: {
      start: { line: error.line, character: error.startChar },
      end: { line: error.line, character: error.endChar },
    },
    message: error.message,
    source: 'nmtran',
  };
}

/** Convert a file-level message (no position) to an LSP `Diagnostic` anchored at (0,0). */
function toFileDiagnostic(
  message: string,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
): Diagnostic {
  return {
    severity,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    message,
    source: 'nmtran',
  };
}

/** Append a `ValidationResult`'s errors as positional diagnostics. */
function pushPositional(
  diagnostics: Diagnostic[],
  result: ValidationResult,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
): void {
  for (const error of result.errors) diagnostics.push(toPositionalDiagnostic(error, severity));
}

/**
 * Diagnostics (user-visible squiggles / "Did you mean…" hints) only
 * fire on actual NMTRAN source: `.mod` and `.ctl`. The `nmtran`
 * language is registered for many other NONMEM-related extensions
 * (`.lst`, `.modt`, `.ctl_dde`, `.dde`, `.scm`, `.res`, `.ext`,
 * `.cov`, `.cor`, `.phi`, `.cnv`, `.grd`, `.shk`, `.shm`, `.smt`,
 * `.rmt`, `.phm`, `.coi`) so they get syntax highlighting / hover /
 * definition / completion / folding, but they're either output files
 * or auxiliary formats where validation would produce false
 * positives.
 *
 * IMPORTANT: this gate is ONLY for diagnostics. Other LSP features —
 * including the public `nmtran/parsedModel` and `nmtran/parseModelText`
 * requests that consumer extensions like positron-nonmem use — keep
 * working on every registered extension. Parsing a `.lst` via the API
 * is supported and intentional.
 */
function isDiagnosableSourceFile(uri: string): boolean {
  return /\.(mod|ctl)$/i.test(uri);
}

export class DiagnosticsService {
  private connection: Connection;
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private static readonly DEBOUNCE_MS = 500;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Debounced re-validation. Rapid edits within DEBOUNCE_MS coalesce
   * to a single validation pass. The previously-pending timeout (if any)
   * is cleared and replaced.
   */
  scheduleValidation(document: TextDocument): void {
    const uri = document.uri;
    const existing = this.timeouts.get(uri);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.timeouts.delete(uri);
      void this.validateDocument(document);
    }, DiagnosticsService.DEBOUNCE_MS);

    this.timeouts.set(uri, timeout);
  }

  /** Clear pending validation for one URI (document closed). */
  dispose(uri: string): void {
    const timeout = this.timeouts.get(uri);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(uri);
    }
  }

  /** Clear all pending validations (server shutdown). */
  disposeAll(): void {
    for (const timeout of this.timeouts.values()) clearTimeout(timeout);
    this.timeouts.clear();
  }

  /**
   * Validates an NMTRAN document and sends diagnostics
   */
  async validateDocument(document: TextDocument): Promise<void> {
    try {
      if (!isDiagnosableSourceFile(document.uri)) {
        // Clear any stale diagnostics (e.g. file was renamed from .mod) and bail.
        this.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
        return;
      }

      const text = document.getText();
      const diagnostics: Diagnostic[] = [];

      for (const match of locateControlRecordsInText(text)) {
        const diagnostic = generateDiagnosticForControlRecord(match, document);
        if (diagnostic) diagnostics.push(diagnostic);
      }

      // Single document scan, shared across the parameter validators that need it.
      const parameters = ParameterScanner.scanDocument(document);

      // File-level (no line/column info): missing-index gaps.
      for (const msg of validateSequentialNumbering(parameters).errors) {
        diagnostics.push(toFileDiagnostic(msg));
      }

      // Positional validators — uniform Error severity unless noted.
      pushPositional(diagnostics, validateParameterReferencesWithParameters(document, parameters));
      pushPositional(diagnostics, validateBlockMatrixSyntax(document));
      pushPositional(diagnostics, validateSameKeywordUsage(document), DiagnosticSeverity.Warning);
      pushPositional(diagnostics, validateContinuationMarkers(document));
      pushPositional(diagnostics, validateParameterBounds(document));
      pushPositional(diagnostics, validateComIndices(document));
      pushPositional(diagnostics, validateInfinityTokenUsage(document));

      this.connection.sendDiagnostics({ uri: document.uri, diagnostics });
    } catch (error) {
      this.connection.console.error(`❌ Error validating document: ${error}`);
      // Don't crash the server on validation errors.
      this.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    }
  }
}
