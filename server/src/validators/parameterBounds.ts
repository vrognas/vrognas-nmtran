/**
 * Validate THETA bound triples (`(low,init,upper)`) and OMEGA / SIGMA
 * variance values. Catches: invalid numeric tokens, `low > init`,
 * `init > upper`, `low > upper`, negative variance (except BLOCK
 * off-diagonals), and OMEGA/SIGMA using bound syntax (not allowed by
 * NMTRAN).
 *
 * Off-diagonal detection within `BLOCK(n)` uses
 * `NMTRANMatrixParser.isDiagonalElement` so negative covariance values
 * stay legal there.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult, ValidationError } from './types';
import { RECORD_PATTERNS } from '../utils/patterns';
import { stripComment, splitTopLevelCommas, splitLines } from '../utils/text';
import { NMTRANMatrixParser } from '../utils/NMTRANMatrixParser';

export function validateParameterBounds(document: TextDocument): ValidationResult {
  const errors: ValidationError[] = [];
  const lines = splitLines(document.getText());
  let currentBlockType: 'THETA' | 'OMEGA' | 'SIGMA' | null = null;
  // BLOCK matrix state: cumulative value count for diagonal/off-diagonal detection.
  let blockState: { size: number; count: number } | null = null;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;

    const lineWithoutComment = stripComment(trimmed).trim();

    let startedBlockLine = false;
    if (RECORD_PATTERNS.THETA.test(lineWithoutComment)) {
      currentBlockType = 'THETA';
      blockState = null;
    } else if (
      RECORD_PATTERNS.OMEGA.test(lineWithoutComment) ||
      RECORD_PATTERNS.SIGMA.test(lineWithoutComment)
    ) {
      currentBlockType = RECORD_PATTERNS.OMEGA.test(lineWithoutComment) ? 'OMEGA' : 'SIGMA';
      const bm = lineWithoutComment.match(/BLOCK\((\d+)\)/i);
      if (bm) {
        blockState = { size: parseInt(bm[1]!, 10), count: 0 };
        startedBlockLine = true;
      } else {
        blockState = null;
      }
    } else if (lineWithoutComment.startsWith('$')) {
      currentBlockType = null;
      blockState = null;
    }

    if (!currentBlockType) continue;

    const isOmegaOrSigma = currentBlockType === 'OMEGA' || currentBlockType === 'SIGMA';

    if (!startedBlockLine && lineWithoutComment.includes('(')) {
      // Parenthesized bound expressions (THETA bounds; invalid for OMEGA/SIGMA non-BLOCK).
      const boundExpressions = extractBoundExpressions(lineWithoutComment);
      for (const expr of boundExpressions) {
        const validation = validateSingleParameterBound(expr.text, currentBlockType);
        if (validation.isValid) continue;
        for (const error of validation.errors) {
          const absoluteStart = line.indexOf(expr.text, expr.startPos);
          if (absoluteStart !== -1) {
            errors.push({
              message: error,
              line: lineNum,
              startChar: absoluteStart,
              endChar: absoluteStart + expr.text.length,
            });
          }
        }
      }
    } else if (isOmegaOrSigma) {
      const osType = currentBlockType as 'OMEGA' | 'SIGMA';
      // Simple values (BLOCK line after stripping BLOCK(n) prefix, or plain continuation line).
      const simpleValues = extractSimpleParameterValues(lineWithoutComment);
      for (const value of simpleValues) {
        let isOffDiagonal = false;
        if (blockState) {
          blockState.count++;
          isOffDiagonal = !isBlockDiagonalPosition(blockState.count);
        }
        const validation = validateSimpleParameterValue(value.text, osType, isOffDiagonal);
        if (validation.isValid) continue;
        for (const error of validation.errors) {
          errors.push({
            message: error,
            line: lineNum,
            startChar: value.startPos,
            endChar: value.endPos,
          });
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

function isBlockDiagonalPosition(oneIndexedCount: number): boolean {
  return NMTRANMatrixParser.isDiagonalElement(oneIndexedCount - 1) !== null;
}

function extractBoundExpressions(line: string): Array<{ text: string; startPos: number }> {
  const expressions: Array<{ text: string; startPos: number }> = [];
  let i = 0;

  const controlMatch = line.match(/^\s*\$\w+\s*/i);
  if (controlMatch) i = controlMatch[0].length;

  const blockMatch = line.substring(i).match(/^BLOCK\(\d+\)\s*/i);
  if (blockMatch) i += blockMatch[0].length;

  while (i < line.length) {
    if (line.charAt(i) !== '(') {
      i++;
      continue;
    }
    const startPos = i;
    let depth = 1;
    i++;
    while (i < line.length && depth > 0) {
      if (line.charAt(i) === '(') depth++;
      else if (line.charAt(i) === ')') depth--;
      i++;
    }
    if (depth === 0) {
      expressions.push({ text: line.substring(startPos, i), startPos });
    }
  }

  return expressions;
}

function validateSingleParameterBound(
  boundExpr: string,
  paramType: 'THETA' | 'OMEGA' | 'SIGMA',
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const content = boundExpr.substring(1, boundExpr.length - 1).trim();
  const parts = splitTopLevelCommas(content);

  if (paramType === 'OMEGA' || paramType === 'SIGMA') {
    if (parts.length === 1) {
      const firstPart = parts[0];
      if (firstPart) {
        const value = parseNumericValue(firstPart.trim());
        if (value === null) {
          errors.push(`Invalid ${paramType} value: ${firstPart.trim()}`);
        } else if (value < 0) {
          errors.push(`${paramType} value (${value}) should generally be positive (variance parameter)`);
        }
      }
    } else {
      errors.push(`${paramType} does not support bound syntax. Use single value only: ${paramType} value`);
    }
    return { isValid: errors.length === 0, errors };
  }

  // THETA: (init), (low,init), or (low,init,high).
  if (parts.length === 1) {
    const firstPart = parts[0];
    if (firstPart) {
      const value = parseNumericValue(firstPart.trim());
      if (value === null) errors.push(`Invalid ${paramType} value: ${firstPart.trim()}`);
    }
  } else if (parts.length === 2) {
    const lowStr = parts[0]?.trim() || '';
    const initStr = parts[1]?.trim() || '';
    const low = parseNumericValue(lowStr);
    const init = parseNumericValue(initStr);

    if (low === null && !isInfinity(lowStr)) errors.push(`Invalid lower bound: ${lowStr}`);
    if (init === null) errors.push(`Invalid initial value: ${initStr}`);
    if (low !== null && init !== null && low > init) {
      errors.push(`Lower bound (${low}) cannot be greater than initial value (${init})`);
    }
  } else if (parts.length === 3) {
    const lowStr = parts[0]?.trim() || '';
    const initStr = parts[1]?.trim() || '';
    const highStr = parts[2]?.trim() || '';
    const low = parseNumericValue(lowStr);
    const init = parseNumericValue(initStr);
    const high = parseNumericValue(highStr);

    if (low === null && !isInfinity(lowStr)) errors.push(`Invalid lower bound: ${lowStr}`);
    // THETA permits empty init (omitted), meaning unbounded.
    if (init === null && initStr !== '') errors.push(`Invalid initial value: ${initStr}`);
    if (high === null && !isInfinity(highStr)) errors.push(`Invalid upper bound: ${highStr}`);

    if (low !== null && high !== null && low > high) {
      errors.push(`Lower bound (${low}) cannot be greater than upper bound (${high})`);
    }
    if (init !== null) {
      if (low !== null && low > init) {
        errors.push(`Lower bound (${low}) cannot be greater than initial value (${init})`);
      }
      if (high !== null && init > high) {
        errors.push(`Initial value (${init}) cannot be greater than upper bound (${high})`);
      }
    }
  } else {
    errors.push(`Invalid THETA format: expected (value), (low,init), or (low,init,high), found ${parts.length} components`);
  }

  return { isValid: errors.length === 0, errors };
}

function parseNumericValue(valueStr: string): number | null {
  const trimmed = valueStr.trim();
  if (isInfinity(trimmed)) return trimmed.startsWith('-') ? -Infinity : Infinity;
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : num;
}

function isInfinity(valueStr: string): boolean {
  const trimmed = valueStr.trim().toUpperCase();
  const core =
    trimmed.startsWith('+') || trimmed.startsWith('-') ? trimmed.substring(1) : trimmed;
  // Per NONMEM Users Guide Part IV Ch.III + NMTRAN 7.6.0 prefix matching.
  return core === 'INF' || core === 'INFINITY' || core === 'INFIN' || core === 'INFTY';
}

const NUMERIC_RE = /([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

function extractSimpleParameterValues(
  line: string,
): Array<{ text: string; startPos: number; endPos: number }> {
  const values: Array<{ text: string; startPos: number; endPos: number }> = [];
  let content = line;

  const controlMatch = content.match(/^\s*\$(OMEGA|SIGMA)\s*/i);
  if (controlMatch) content = content.substring(controlMatch[0].length);

  content = content.replace(/^BLOCK\(\d+\)\s*/i, '');
  if (content.trim().toUpperCase() === 'SAME') return values;

  for (const match of content.matchAll(NUMERIC_RE)) {
    const value = match[1];
    if (!value) continue;
    const startInContent = match.index!;
    const endInContent = startInContent + value.length;

    const prefixLength = line.length - content.length;
    const absoluteStart = prefixLength + startInContent;
    const absoluteEnd = prefixLength + endInContent;

    // Verify this is a standalone numeric value (whitespace / comment / EOL boundaries),
    // not a digit run embedded inside a keyword.
    const beforeChar = absoluteStart > 0 ? line.charAt(absoluteStart - 1) : ' ';
    const afterChar = absoluteEnd < line.length ? line.charAt(absoluteEnd) : ' ';
    if (
      /\s/.test(beforeChar) &&
      (/\s/.test(afterChar) || afterChar === ';' || absoluteEnd === line.length)
    ) {
      values.push({ text: value, startPos: absoluteStart, endPos: absoluteEnd });
    }
  }

  return values;
}

function validateSimpleParameterValue(
  valueStr: string,
  paramType: 'OMEGA' | 'SIGMA',
  isOffDiagonal: boolean,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const value = parseNumericValue(valueStr);
  if (value === null) {
    errors.push(`Invalid ${paramType} value: ${valueStr}`);
  } else if (value < 0 && !isOffDiagonal) {
    errors.push(`${paramType} initial value (${value}) should generally be positive (variance parameter)`);
  }
  return { isValid: errors.length === 0, errors };
}
