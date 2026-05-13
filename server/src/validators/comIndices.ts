/**
 * Validate that `COM(i)` references in abbreviated code stay within the
 * `COMRES + COMSAV` size declared in `$ABBREV`. NONMEM's COM array is
 * shared across blocks; writing past the declared size silently
 * overflows into other data — worth flagging early.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult } from './types';
import { stripComment } from '../utils/text';

const ABBR_RE = /^\$ABBR(EV)?\b/i;
const COMRES_RE = /\bCOMRES\s*=\s*(\d+)/i;
const COMSAV_RE = /\bCOMSAV\s*=\s*(\d+)/i;
const COM_REF = /\bCOM\s*\(\s*(\d+)\s*\)/gi;

export function validateComIndices(document: TextDocument): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const lines = document.getText().split('\n');

  let comres = 0;
  let comsav = 0;
  let declared = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    if (!ABBR_RE.test(trimmed)) continue;
    const line = stripComment(trimmed);
    const r = line.match(COMRES_RE);
    const s = line.match(COMSAV_RE);
    if (r) {
      comres = Math.max(comres, parseInt(r[1]!, 10));
      declared = true;
    }
    if (s) {
      comsav = Math.max(comsav, parseInt(s[1]!, 10));
      declared = true;
    }
  }

  if (!declared) return { isValid: true, errors };

  const maxAllowed = comres + comsav;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    if (!rawLine) continue;
    const scanLine = stripComment(rawLine);

    for (const match of scanLine.matchAll(COM_REF)) {
      const idx = parseInt(match[1]!, 10);
      if (idx > maxAllowed) {
        errors.push({
          message: `COM(${idx}) exceeds COMRES+COMSAV (${comres}+${comsav}=${maxAllowed}) declared in $ABBREV`,
          line: lineNum,
          startChar: match.index!,
          endChar: match.index! + match[0].length,
        });
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}
