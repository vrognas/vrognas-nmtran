/**
 * Validate that the `SAME` keyword only appears inside a `$OMEGA BLOCK(n)`
 * / `$SIGMA BLOCK(n)` declaration (where it means "reuse the previous
 * block's structure"). Standalone `SAME` outside that context is invalid.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult } from './types';
import { SAME_RE } from '../utils/patterns';
import { stripComment } from '../utils/text';

export function validateSameKeywordUsage(document: TextDocument): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const lines = document.getText().split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;

    const lineWithoutComment = stripComment(trimmed).trim();

    if (!SAME_RE.test(lineWithoutComment)) continue;

    const sameMatch = lineWithoutComment.match(SAME_RE);
    if (!sameMatch) continue;

    const isInBlockDeclaration = /^\$\w+\s+BLOCK\(\d+\)\s+.*SAME/i.test(lineWithoutComment);
    const isStandaloneBlock = /^\$\w+\s+BLOCK\(\d+\)\s+SAME\s*$/i.test(lineWithoutComment);

    if (!isInBlockDeclaration && !isStandaloneBlock) {
      const startPos = line.indexOf(sameMatch[0]);
      errors.push({
        message:
          'SAME keyword should only be used with BLOCK matrices to reference previous block structure',
        line: lineNum,
        startChar: startPos,
        endChar: startPos + sameMatch[0].length,
      });
    }
  }

  return { isValid: errors.length === 0, errors };
}
