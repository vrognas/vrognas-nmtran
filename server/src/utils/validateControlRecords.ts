import { Diagnostic, DiagnosticSeverity, TextDocument } from 'vscode-languageserver/node';
import { allowedControlRecords } from '../constants';
import { stripComment } from './text';
import { createControlRecordRegex } from './patterns';

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
  const controlRecordRegex = createControlRecordRegex();
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
 * Extracts a detail snippet from content after a control record keyword.
 * Strips trailing comments and truncates long content. Exported for
 * consumption by the document-outline builder in
 * `services/documentSymbols.ts`.
 */
function extractControlRecordDetail(restOfLine: string): string {
  let detail = stripComment(restOfLine).trim();
  // Truncate
  if (detail.length > 60) {
    detail = detail.substring(0, 57) + '...';
  }
  return detail;
}

export {
  locateControlRecordsInText,
  generateDiagnosticForControlRecord,
  getFullControlRecordName,
  extractControlRecordDetail,
};
