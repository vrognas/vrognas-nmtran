/**
 * Validate `$OMEGA BLOCK(n)` / `$SIGMA BLOCK(n)` matrix structure:
 *   - BLOCK size must be ≥ 1.
 *   - Element count across the block (header + continuation lines)
 *     must equal n*(n+1)/2 (lower-triangular).
 *   - `SAME` on the header line skips element counting (the block
 *     inherits the previous BLOCK's structure).
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult, ValidationError } from './types';
import { SAME_RE } from '../utils/patterns';
import { stripComment, splitLines } from '../utils/text';

const NUMERIC_RE = /[\d\-+][\d\-+.eE]*/g;

export function validateBlockMatrixSyntax(document: TextDocument): ValidationResult {
  const errors: ValidationError[] = [];
  const lines = splitLines(document.getText());
  let currentBlockType: 'OMEGA' | 'SIGMA' | null = null;
  let currentBlockSize = 0;
  let currentBlockStartLine = 0;
  let expectedElements = 0;
  let actualElements = 0;
  let inBlockMatrix = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith(';')) continue;

    const lineWithoutComment = stripComment(trimmed).trim();

    const omegaBlockMatch = lineWithoutComment.match(/^\$OMEGA\s+BLOCK\((\d+)\)/i);
    const sigmaBlockMatch = lineWithoutComment.match(/^\$SIGMA\s+BLOCK\((\d+)\)/i);

    if (omegaBlockMatch || sigmaBlockMatch) {
      const blockMatch = omegaBlockMatch || sigmaBlockMatch;
      if (!blockMatch || !blockMatch[1]) continue;
      const blockSize = parseInt(blockMatch[1], 10);
      currentBlockType = omegaBlockMatch ? 'OMEGA' : 'SIGMA';
      currentBlockSize = blockSize;
      currentBlockStartLine = lineNum;
      inBlockMatrix = true;
      actualElements = 0;

      if (blockSize < 1) {
        errors.push({
          message: `Invalid BLOCK size: BLOCK(${blockSize}). Size must be >= 1`,
          line: lineNum,
          startChar: blockMatch.index! + blockMatch[0].indexOf(`(${blockSize})`),
          endChar:
            blockMatch.index! +
            blockMatch[0].indexOf(`(${blockSize})`) +
            `(${blockSize})`.length,
        });
        continue;
      }

      // BLOCK(1) is valid NONMEM syntax — no warning needed.
      // Expected elements for symmetric matrix: n*(n+1)/2.
      expectedElements = (blockSize * (blockSize + 1)) / 2;

      // SAME on header skips element counting (inherits previous BLOCK).
      if (SAME_RE.test(lineWithoutComment)) {
        inBlockMatrix = false;
        continue;
      }

      // Inline values on the BLOCK declaration line.
      const afterBlock = lineWithoutComment.replace(/^\$\w+\s+BLOCK\(\d+\)\s*/i, '');
      if (afterBlock.trim().length > 0) {
        const inlineValues = afterBlock.match(NUMERIC_RE);
        if (inlineValues) actualElements += inlineValues.length;
      }
    } else if (inBlockMatrix && currentBlockType) {
      if (lineWithoutComment.startsWith('$')) {
        // New control record — validate current block, then exit.
        validateBlockElementCount(
          currentBlockType,
          currentBlockSize,
          expectedElements,
          actualElements,
          currentBlockStartLine,
          errors,
        );
        inBlockMatrix = false;
        currentBlockType = null;
      } else {
        const numericValues = lineWithoutComment.match(NUMERIC_RE);
        if (numericValues) actualElements += numericValues.length;
      }
    }
  }

  // Document ended while still inside a block.
  if (inBlockMatrix && currentBlockType) {
    validateBlockElementCount(
      currentBlockType,
      currentBlockSize,
      expectedElements,
      actualElements,
      currentBlockStartLine,
      errors,
    );
  }

  return { isValid: errors.length === 0, errors };
}

function validateBlockElementCount(
  blockType: 'OMEGA' | 'SIGMA',
  blockSize: number,
  expectedElements: number,
  actualElements: number,
  startLine: number,
  errors: ValidationError[],
): void {
  if (blockSize === 1) {
    if (actualElements !== 1) {
      errors.push({
        message: `${blockType} BLOCK(1) expects 1 element, found ${actualElements}`,
        line: startLine,
        startChar: 0,
        endChar: 0,
      });
    }
    return;
  }
  if (actualElements < expectedElements) {
    errors.push({
      message: `${blockType} BLOCK(${blockSize}) incomplete: expected ${expectedElements} elements, found ${actualElements}`,
      line: startLine,
      startChar: 0,
      endChar: 0,
    });
  } else if (actualElements > expectedElements) {
    errors.push({
      message: `${blockType} BLOCK(${blockSize}) has too many elements: expected ${expectedElements}, found ${actualElements}`,
      line: startLine,
      startChar: 0,
      endChar: 0,
    });
  }
}
