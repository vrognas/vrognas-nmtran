import { Diagnostic, DiagnosticSeverity, DocumentSymbol, SymbolKind, TextDocument } from 'vscode-languageserver/node';
import { allowedControlRecords } from '../constants';
import type { ParameterLocation } from '../services/ParameterScanner';
import { stripComment } from './text';

/**
 * Finds the full allowed control record name if the given record is a recognized abbreviation.
 * 
 * Why:
 * We want to handle cases where a user abbreviates a control record. This function returns the
 * full allowed control record if an abbreviation is recognized, improving consistency.
 */
function getFullControlRecordName(record: string): string {
  for (const validRecord of allowedControlRecords) {
    if (validRecord.startsWith(record)) {
      return validRecord;
    }
  }
  return record;
}

/**
 * Checks the validity and abbreviation status of a control record.
 * 
 * Why:
 * Providing a single function to determine if a record is valid or abbreviated centralizes logic
 * and reduces confusion throughout the codebase.
 */
function evaluateControlRecord(record: string): { 
  isValid: boolean; 
  isAbbreviation: boolean; 
  closestMatch?: string 
} {
  let closestMatch: string | undefined;

  for (const validRecord of allowedControlRecords) {
    if (validRecord === record) {
      return { isValid: true, isAbbreviation: false };
    }

    if (validRecord.startsWith(record)) {
      return { isValid: true, isAbbreviation: true, closestMatch: validRecord };
    }

    if (!closestMatch && validRecord.startsWith(record.substring(0, 3))) {
      closestMatch = validRecord;
    }
  }

  return { 
    isValid: false, 
    isAbbreviation: false, 
    ...(closestMatch ? { closestMatch } : {})
  };
}

/**
 * Retrieves all control records from the given document text, ignoring commented lines.
 * 
 * Why:
 * We must find control records within the text while ignoring commented lines to ensure that
 * diagnostics are only produced for actual code lines.
 */
function locateControlRecordsInText(text: string): RegExpExecArray[] {
  const controlRecordRegex = /\$[A-Z]+\b/g;
  const findings: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  // Replace comments with whitespace so indexes remain correct.
  // Strips both full comment lines AND inline `; ...` tails.
  const sanitizedText = text
    .split('\n')
    .map(line => {
      if (line.trim().startsWith(';')) return ' '.repeat(line.length);
      const ci = line.indexOf(';');
      return ci === -1 ? line : line.substring(0, ci) + ' '.repeat(line.length - ci);
    })
    .join('\n');

  while ((match = controlRecordRegex.exec(sanitizedText)) !== null) {
    findings.push(match);
  }

  return findings;
}

/**
 * Creates a diagnostic for an invalid or abbreviated control record.
 * 
 * Why:
 * This encapsulates diagnostic creation logic, ensuring that all control record diagnostics are
 * constructed consistently and can be easily maintained.
 */
function generateDiagnosticForControlRecord(match: RegExpExecArray, textDocument: TextDocument): Diagnostic | null {
  const { isValid, isAbbreviation, closestMatch } = evaluateControlRecord(match[0]);

  if (isValid) {
    if (isAbbreviation && closestMatch) {
      return {
        severity: DiagnosticSeverity.Information,
        range: {
          start: textDocument.positionAt(match.index),
          end: textDocument.positionAt(match.index + match[0].length)
        },
        message: `Did you mean ${closestMatch}?`,
        code: "replace-abbreviation",
        source: 'NMTRAN Language Server'
      };
    }
    return null;
  } else {
    let message = `Invalid control record: ${match[0]}`;
    if (closestMatch) {
      message += `. Did you mean ${closestMatch}?`;
    }
    return {
      severity: DiagnosticSeverity.Error,
      range: {
        start: textDocument.positionAt(match.index),
        end: textDocument.positionAt(match.index + match[0].length)
      },
      message,
      source: 'NMTRAN Language Server'
    };
  }
}

/**
 * Validates continuation marker (&) usage in NMTRAN files.
 * 
 * Why:
 * NMTRAN uses FORTRAN-style continuation markers which have specific rules:
 * - & must appear at the end of lines (after content, before comments)
 * - Continuation lines should be properly structured
 * - No orphaned & markers
 */
function validateContinuationMarkers(document: TextDocument): { 
  isValid: boolean; 
  errors: Array<{ message: string; line: number; startChar: number; endChar: number }> 
} {
  const errors: Array<{ message: string; line: number; startChar: number; endChar: number }> = [];
  const lines = document.getText().split('\n');
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    // Find the position of the first semicolon (start of comment)
    // Any ampersand after this position should be ignored
    const commentStart = line.indexOf(';');

    // Skip lines that are entirely comments
    if (line.trim().startsWith(';')) continue;

    // Find all & characters in the line (before any comment)
    for (let charPos = 0; charPos < line.length; charPos++) {
      // Skip ampersands that appear within comments
      if (commentStart !== -1 && charPos >= commentStart) break;

      if (line.charAt(charPos) === '&') {
        // Check if & is at the end of the line (ignoring trailing whitespace and comments)
        const afterAmpersand = line.substring(charPos + 1);
        const isAtLineEnd = /^\s*(;.*)?$/.test(afterAmpersand);
        
        if (!isAtLineEnd) {
          // & is not at the end of line - this is invalid
          errors.push({
            message: 'Continuation marker (&) must appear at the end of the line',
            line: lineNum,
            startChar: charPos,
            endChar: charPos + 1
          });
        } else {
          // Valid & at end of line - check if there's a continuation line
          if (lineNum === lines.length - 1) {
            // & at end of last line - orphaned continuation marker
            errors.push({
              message: 'Orphaned continuation marker (&) at end of file',
              line: lineNum,
              startChar: charPos,
              endChar: charPos + 1
            });
          } else {
            // Check if next line exists and is not empty/comment-only
            const nextLine = lines[lineNum + 1];
            if (!nextLine || nextLine.trim() === '' || nextLine.trim().startsWith(';')) {
              errors.push({
                message: 'Continuation marker (&) not followed by continuation content',
                line: lineNum,
                startChar: charPos,
                endChar: charPos + 1
              });
            }
          }
        }
      }
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * Extracts a detail snippet from content after a control record keyword.
 * Strips trailing comments and truncates long content.
 */
function extractControlRecordDetail(restOfLine: string): string {
  let detail = stripComment(restOfLine).trim();
  // Truncate
  if (detail.length > 60) {
    detail = detail.substring(0, 57) + '...';
  }
  return detail;
}

const PARAM_TYPE_MAP: Record<string, ParameterLocation['type']> = {
  '$THETA': 'THETA',
  '$OMEGA': 'ETA',
  '$SIGMA': 'EPS',
};

/**
 * Builds DocumentSymbol array for the outline view.
 * Each control record becomes a symbol with full-block range and detail text.
 * When parameterLocations provided, nests parameter children under $THETA/$OMEGA/$SIGMA.
 */
function buildDocumentSymbols(doc: TextDocument, parameterLocations?: ParameterLocation[]): DocumentSymbol[] {
  const text = doc.getText();
  const matches = locateControlRecordsInText(text);
  const symbols: DocumentSymbol[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const fullName = getFullControlRecordName(match[0]);

    // selectionRange: just the $KEYWORD
    const selectionStart = doc.positionAt(match.index);
    const selectionEnd = doc.positionAt(match.index + match[0].length);

    // range: from $KEYWORD line to line before next $KEYWORD (or EOF)
    const rangeStart = { line: selectionStart.line, character: 0 };
    let rangeEnd;
    const nextMatch = matches[i + 1];
    if (nextMatch) {
      const nextLine = doc.positionAt(nextMatch.index).line;
      const endLine = Math.max(nextLine - 1, rangeStart.line);
      const endLineStart = doc.offsetAt({ line: endLine, character: 0 });
      const nextNewline = text.indexOf('\n', endLineStart);
      let endLineLength = nextNewline === -1
        ? text.length - endLineStart
        : nextNewline - endLineStart;
      if (endLineLength > 0 && text[endLineStart + endLineLength - 1] === '\r') {
        endLineLength--;
      }
      rangeEnd = { line: endLine, character: endLineLength };
    } else {
      rangeEnd = doc.positionAt(text.length);
    }

    // detail: rest of the keyword's line
    const lineEnd = text.indexOf('\n', match.index);
    const restOfLineRaw = lineEnd === -1
      ? text.slice(match.index + match[0].length)
      : text.slice(match.index + match[0].length, lineEnd);
    const restOfLine = restOfLineRaw.replace(/\r$/, '');
    const detail = extractControlRecordDetail(restOfLine);

    const symbol = DocumentSymbol.create(
      fullName,
      detail || undefined,
      SymbolKind.Module,
      { start: rangeStart, end: rangeEnd },
      { start: selectionStart, end: selectionEnd }
    );

    // Add parameter children for $THETA, $OMEGA, $SIGMA
    const expectedType = parameterLocations ? PARAM_TYPE_MAP[fullName] : undefined;
    if (expectedType && parameterLocations) {
      const children: DocumentSymbol[] = [];
      for (const loc of parameterLocations) {
        if (loc.type !== expectedType) continue;
        if (loc.line < rangeStart.line || loc.line > rangeEnd.line) continue;

        const childName = `${loc.type}(${loc.index})`;

        // Extract inline comment as detail
        const paramLineStart = doc.offsetAt({ line: loc.line, character: 0 });
        const paramLineEnd = text.indexOf('\n', paramLineStart);
        const paramLineRaw = paramLineEnd === -1
          ? text.slice(paramLineStart)
          : text.slice(paramLineStart, paramLineEnd);
        const paramLine = paramLineRaw.replace(/\r$/, '');
        const commentMatch = paramLine.match(/;(.+)/);
        const childDetail = commentMatch?.[1]?.trim() || undefined;

        // Range: full line; selectionRange: the numeric value
        const childRangeStart = { line: loc.line, character: 0 };
        const childRangeEnd = { line: loc.line, character: paramLine.length };
        const childSelStart = { line: loc.line, character: loc.startChar ?? 0 };
        const childSelEnd = { line: loc.line, character: loc.endChar ?? paramLine.length };

        children.push(DocumentSymbol.create(
          childName,
          childDetail,
          SymbolKind.Variable,
          { start: childRangeStart, end: childRangeEnd },
          { start: childSelStart, end: childSelEnd }
        ));
      }
      if (children.length > 0) {
        symbol.children = children;
      }
    }

    symbols.push(symbol);
  }

  return symbols;
}

export {
  locateControlRecordsInText,
  generateDiagnosticForControlRecord,
  getFullControlRecordName,
  validateContinuationMarkers,
  buildDocumentSymbols
};
