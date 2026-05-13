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
  validateContinuationMarkers
} from '../utils/validateControlRecords';
import { ParameterScanner } from './ParameterScanner';
import { validateSequentialNumbering } from '../validators/sequentialNumbering';
import { validateSameKeywordUsage } from '../validators/sameKeywordUsage';
import { validateComIndices } from '../validators/comIndices';
import { validateInfinityTokenUsage } from '../validators/infinityTokens';
import { validateParameterReferencesWithParameters } from '../validators/parameterReferences';
import { validateBlockMatrixSyntax } from '../validators/blockMatrixSyntax';
import { validateParameterBounds } from '../validators/parameterBounds';
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
 * `.lst` (and other NONMEM-generated listing files) are registered as
 * `nmtran` for syntax highlighting but contain narrative output, not
 * source — running diagnostics on them produces noise like
 * `Did you mean $ABBREVIATED?` against output prose. Skip diagnostics
 * for these read-only file types.
 */
function isReadOnlyOutputFile(uri: string): boolean {
  return /\.lst$/i.test(uri);
}

export class DiagnosticsService {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Validates an NMTRAN document and sends diagnostics
   */
  async validateDocument(document: TextDocument): Promise<void> {
    try {
      if (isReadOnlyOutputFile(document.uri)) {
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
