/**
 * Validate that every `THETA(n)` / `ETA(n)` / `EPS(n)` / `ERR(n)`
 * reference in the document resolves to a declared parameter, and
 * flag declared parameters that aren't referenced anywhere.
 *
 * `validateParameterReferencesWithParameters` takes a pre-scanned
 * `ParameterLocation[]` (the diagnostics service already has this in
 * hand); `validateParameterReferences` is the convenience wrapper
 * that scans on the caller's behalf.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ValidationResult } from './types';
import { ParameterScanner, type ParameterLocation } from '../services/ParameterScanner';
import { resolveErrBinding } from '../utils/errBinding';
import { createParameterReferenceRegex } from '../utils/patterns';
import { stripComment } from '../utils/text';

export function validateParameterReferencesWithParameters(
  document: TextDocument,
  parameters: ParameterLocation[],
): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const lines = document.getText().split('\n');

  const maxCounts = { THETA: 0, ETA: 0, EPS: 0 };
  for (const param of parameters) {
    maxCounts[param.type] = Math.max(maxCounts[param.type], param.index);
  }

  const { binding: errBinding, hasOmega, hasSigma } = resolveErrBinding(document);

  const referencedParams = new Set<string>();
  const refRegex = createParameterReferenceRegex();

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    const lineWithoutComment = stripComment(line);

    for (const match of lineWithoutComment.matchAll(refRegex)) {
      const rawParamType = match[1]!.toUpperCase() as 'THETA' | 'ETA' | 'EPS' | 'ERR';
      const paramIndex = parseInt(match[2]!, 10);

      if (rawParamType === 'ERR' && !hasSigma && !hasOmega) {
        errors.push({
          message: `ERR(${paramIndex}) cannot resolve - no $OMEGA or $SIGMA defined`,
          line: lineNum,
          startChar: match.index!,
          endChar: match.index! + match[0].length,
        });
        continue;
      }

      const paramType = rawParamType === 'ERR' ? errBinding : rawParamType;
      referencedParams.add(`${paramType}:${paramIndex}`);

      if (paramIndex > maxCounts[paramType]) {
        const count = maxCounts[paramType];
        const countPhrase = count === 0 ? 'no' : `only ${count}`;
        errors.push({
          message: `${rawParamType}(${paramIndex}) referenced but ${countPhrase} ${paramType} parameters defined`,
          line: lineNum,
          startChar: match.index!,
          endChar: match.index! + match[0].length,
        });
      }
    }
  }

  for (const param of parameters) {
    const key = `${param.type}:${param.index}`;
    if (!referencedParams.has(key)) {
      errors.push({
        message: `${param.type}(${param.index}) defined but never referenced`,
        line: param.line,
        startChar: param.startChar || 0,
        endChar: param.endChar || 0,
      });
    }
  }

  return { isValid: errors.length === 0, errors };
}

export function validateParameterReferences(document: TextDocument): ValidationResult {
  const parameters = ParameterScanner.scanDocument(document);
  return validateParameterReferencesWithParameters(document, parameters);
}
