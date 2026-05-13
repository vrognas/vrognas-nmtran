/**
 * Validate that NMTRAN's `INF` / `INFINITY` / `INFIN` / `INFTY` tokens
 * appear only inside `$THETA` bound triples. Used as identifiers in
 * `$PK` / `$PRED` / `$ERROR` / etc. they trigger NMTRAN ERROR 208
 * (UNDEFINED VARIABLE).
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult } from './types';
import { ABBREVIATED_CODE_BLOCKS } from '../constants';
import { stripComment } from '../utils/text';

// Order longest→shortest so alternation matches the longest first.
const INFINITY_TOKEN = /\b(INFINITY|INFIN|INFTY|INF)\b/gi;

export function validateInfinityTokenUsage(document: TextDocument): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const lines = document.getText().split('\n');

  let inAbbreviatedBlock = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;

    const withoutComment = stripComment(trimmed);

    // Control record keyword resets block context; don't scan the $RECORD line itself.
    const controlRecordMatch = withoutComment.match(/^\$(\w+)/);
    if (controlRecordMatch) {
      const recordName = '$' + controlRecordMatch[1]!.toUpperCase();
      inAbbreviatedBlock = ABBREVIATED_CODE_BLOCKS.has(recordName);
      continue;
    }

    if (!inAbbreviatedBlock) continue;

    const leadingWhitespace = line.length - line.trimStart().length;
    for (const match of withoutComment.matchAll(INFINITY_TOKEN)) {
      const tokenStart = leadingWhitespace + match.index!;
      errors.push({
        message: `${match[0].toUpperCase()} is only valid inside $THETA bound triples. Use e.g. 1.0D+30 or the NMPRD_REAL::INFNTY constant via verbatim code.`,
        line: lineNum,
        startChar: tokenStart,
        endChar: tokenStart + match[0].length,
      });
    }
  }

  return { isValid: errors.length === 0, errors };
}
