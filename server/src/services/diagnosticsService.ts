/**
 * Diagnostics Service
 * 
 * Handles document validation and diagnostic generation for NMTRAN files.
 * Separated from main server for better maintainability.
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
      const text = document.getText();
      const controlRecords = locateControlRecordsInText(text);
      const diagnostics: Diagnostic[] = [];

      for (const match of controlRecords) {
        const diagnostic = generateDiagnosticForControlRecord(match, document);
        if (diagnostic) {
          diagnostics.push(diagnostic);
        }
      }

      // Perform comprehensive parameter validation (single document scan)
      const parameters = ParameterScanner.scanDocument(document);
      
      // Validate sequential parameter numbering
      const parameterValidation = validateSequentialNumbering(parameters);
      if (!parameterValidation.isValid) {
        for (const error of parameterValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 }
            },
            message: error,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate parameter references using existing scanned parameters
      const referenceValidation = ParameterScanner.validateParameterReferencesWithParameters(document, parameters);
      if (!referenceValidation.isValid) {
        for (const error of referenceValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate BLOCK matrix syntax and structure
      const blockMatrixValidation = ParameterScanner.validateBlockMatrixSyntax(document);
      if (!blockMatrixValidation.isValid) {
        for (const error of blockMatrixValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate SAME keyword usage in BLOCK context
      const sameKeywordValidation = validateSameKeywordUsage(document);
      if (!sameKeywordValidation.isValid) {
        for (const error of sameKeywordValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate continuation marker usage
      const continuationValidation = validateContinuationMarkers(document);
      if (!continuationValidation.isValid) {
        for (const error of continuationValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate parameter bounds
      const parameterBoundsValidation = ParameterScanner.validateParameterBounds(document);
      if (!parameterBoundsValidation.isValid) {
        for (const error of parameterBoundsValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate COM(i) indices against COMRES+COMSAV declared in $ABBREV
      const comIndexValidation = validateComIndices(document);
      if (!comIndexValidation.isValid) {
        for (const error of comIndexValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      // Validate infinity token misuse in abbreviated code (ERROR 208 UNDEFINED VARIABLE)
      const infinityTokenValidation = validateInfinityTokenUsage(document);
      if (!infinityTokenValidation.isValid) {
        for (const error of infinityTokenValidation.errors) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: error.line, character: error.startChar },
              end: { line: error.line, character: error.endChar }
            },
            message: error.message,
            source: 'nmtran'
          };
          diagnostics.push(diagnostic);
        }
      }

      this.connection.sendDiagnostics({
        uri: document.uri, 
        diagnostics 
      });

    } catch (error) {
      this.connection.console.error(`❌ Error validating document: ${error}`);
      // Don't crash the server on validation errors
      this.connection.sendDiagnostics({ 
        uri: document.uri, 
        diagnostics: [] 
      });
    }
  }
}