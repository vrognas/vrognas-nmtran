/**
 * Validate FORTRAN-style line-continuation markers (`&`):
 *   - must appear at the end of a non-comment line (whitespace + optional
 *     `;<comment>` after is OK);
 *   - must not be the very last non-empty line in the file;
 *   - must not be followed only by blank or comment-only lines.
 *
 * Returns the same positional `ValidationResult` shape as the other
 * validators under this directory.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult } from './types';
import { splitLines } from '../utils/text';

export function validateContinuationMarkers(document: TextDocument): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const lines = splitLines(document.getText());

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;
    if (line.trim().startsWith(';')) continue; // Skip pure-comment lines.

    // Position of the first `;` — any `&` past it lives inside a comment.
    const commentStart = line.indexOf(';');

    for (let charPos = 0; charPos < line.length; charPos++) {
      if (commentStart !== -1 && charPos >= commentStart) break;
      if (line.charAt(charPos) !== '&') continue;

      const afterAmpersand = line.substring(charPos + 1);
      const isAtLineEnd = /^\s*(;.*)?$/.test(afterAmpersand);

      if (!isAtLineEnd) {
        errors.push({
          message: 'Continuation marker (&) must appear at the end of the line',
          line: lineNum,
          startChar: charPos,
          endChar: charPos + 1,
        });
        continue;
      }

      if (lineNum === lines.length - 1) {
        errors.push({
          message: 'Orphaned continuation marker (&) at end of file',
          line: lineNum,
          startChar: charPos,
          endChar: charPos + 1,
        });
        continue;
      }

      const nextLine = lines[lineNum + 1];
      if (!nextLine || nextLine.trim() === '' || nextLine.trim().startsWith(';')) {
        errors.push({
          message: 'Continuation marker (&) not followed by continuation content',
          line: lineNum,
          startChar: charPos,
          endChar: charPos + 1,
        });
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}
