/**
 * Validate that THETA / ETA / EPS parameter indices are sequential with no
 * gaps. Pure function of the pre-scanned `ParameterLocation[]` — does not
 * touch the document itself.
 *
 * Returns file-level error strings (no line / column info), unlike the
 * positional validators in this directory — gaps are global, not tied to
 * a specific text range.
 */

import type { ParameterLocation } from '../services/ParameterScanner';

export interface SequentialNumberingResult {
  isValid: boolean;
  errors: string[];
}

export function validateSequentialNumbering(
  parameters: ParameterLocation[],
): SequentialNumberingResult {
  const errors: string[] = [];
  const groups: Record<'THETA' | 'ETA' | 'EPS', number[]> = {
    THETA: [],
    ETA: [],
    EPS: [],
  };

  for (const param of parameters) {
    groups[param.type].push(param.index);
  }

  for (const [type, indices] of Object.entries(groups)) {
    if (indices.length === 0) continue;

    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const expected = i + 1;
      if (sorted[i] !== expected) {
        errors.push(
          `Missing ${type}(${expected}) - parameters must be sequential with no gaps`,
        );
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}
