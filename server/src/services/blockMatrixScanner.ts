/**
 * BLOCK matrix state machine for `$OMEGA BLOCK(n)` / `$SIGMA BLOCK(n)`.
 *
 * NMTRAN BLOCK matrices are lower-triangular row-major:
 *
 *   BLOCK(3):
 *     a                       ← row 1: 1 value  (diagonal a)
 *     b c                     ← row 2: 2 values (b off-diagonal, c diagonal)
 *     d e f                   ← row 3: 3 values (d, e off-diagonal, f diagonal)
 *
 * Only diagonal elements (a, c, f) become declared parameters. Off-diagonals
 * are covariance terms — surfaced separately by validators but not emitted
 * as ParameterLocation.
 *
 * A BlockMatrixScanner instance lives for the duration of one BLOCK record
 * (created when the orchestrator sees a `BLOCK(n)` header without `SAME`,
 * discarded when the next record begins or the diagonal count is exhausted).
 * Lines belonging to the block — header line itself when it carries inline
 * values, plus continuation lines — flow through `processLine`, which
 * advances internal state and emits one ParameterLocation per diagonal.
 */

import type { ParameterLocation } from './parameterScanner';
import { NMTRANMatrixParser } from '../utils/NMTRANMatrixParser';
import { stripComment, stripRecordPrefix, stripBlockPrefix } from '../utils/text';
import { BLOCK_RE } from '../utils/patterns';

const NUMERIC_GLOBAL = /[\d\-+][\d\-+.eE]*/g;
const FIXED_GLOBAL = /\b(FIX|FIXED)\b/gi;

export interface BlockMatrixInfo {
  /** Block size from BLOCK(n). */
  size: number;
  /**
   * True for n>=2 (lower-triangular matrix needing the state machine).
   * BLOCK(1) is degenerate — one diagonal element — and the orchestrator
   * handles it as a diagonal value instead of allocating a scanner.
   */
  isMatrix: boolean;
}

/**
 * Recognise `BLOCK(n)` syntax on a line. Returns size + matrix-vs-diagonal
 * classification, or null when the line carries no BLOCK keyword.
 */
export function detectBlockMatrix(line: string): BlockMatrixInfo | null {
  const m = line.match(BLOCK_RE);
  if (!m || !m[1]) return null;
  const size = parseInt(m[1], 10);
  return { size, isMatrix: size >= 2 };
}

/**
 * Per-BLOCK position-math + remaining-diagonal bookkeeping.
 *
 * The orchestrator owns the global ETA/EPS counters and passes `allocIndex`
 * (a closure that bumps the counter + returns the new value) so the scanner
 * can label each diagonal without holding a reference to shared state.
 */
export class BlockMatrixScanner {
  /** Diagonals still expected. */
  private remaining: number;
  /** Cumulative element count across this block's lines (row-major lower-triangular). */
  private elementsSeen = 0;
  /**
   * FIXED keyword ranges captured from the BLOCK header line. Each diagonal
   * inherits these as additional ranges so hover / definition decorations
   * cover the keyword wherever it appears.
   */
  private readonly fixedKeywords: Array<{ startChar: number; endChar: number; line: number }> = [];

  constructor(info: BlockMatrixInfo, headerLine: string, headerLineNum: number) {
    this.remaining = info.size;
    for (const m of headerLine.matchAll(FIXED_GLOBAL)) {
      this.fixedKeywords.push({
        startChar: m.index!,
        endChar: m.index! + m[0].length,
        line: headerLineNum,
      });
    }
  }

  /** True while diagonal values are still expected from subsequent lines. */
  isActive(): boolean {
    return this.remaining > 0;
  }

  /**
   * Process one line belonging to the block (header w/ inline values OR a
   * continuation line). Returns ParameterLocations for the diagonal elements
   * found on this line. Advances internal position counters.
   */
  processLine(
    line: string,
    lineNum: number,
    type: 'ETA' | 'EPS',
    allocIndex: () => number,
  ): ParameterLocation[] {
    const trimmed = line.trim();
    const cleanLine = stripBlockPrefix(stripRecordPrefix(stripComment(trimmed)));
    const values = cleanLine.match(NUMERIC_GLOBAL) ?? [];
    if (values.length === 0) return [];

    const locations: ParameterLocation[] = [];
    const startElement = this.elementsSeen;
    let diagonalsFound = 0;

    for (let pos = 0; pos < values.length; pos++) {
      const absolute = startElement + pos;
      // isDiagonalElement returns the 1-based diagonal index when this
      // flat position is on the diagonal, or null for off-diagonals.
      const diagonal = NMTRANMatrixParser.isDiagonalElement(absolute);
      if (diagonal === null) continue;

      const value = values[pos]!;
      const codeOnly = line.replace(/;.*$/, '');
      // `lastIndexOf(prevValue)` anchors the search so repeated tokens like
      // `0.1 0.1 0.1` get distinct startChar/endChar per occurrence.
      const searchStart = pos > 0 ? codeOnly.lastIndexOf(values[pos - 1]!) : 0;
      const valueStart = codeOnly.indexOf(value, searchStart);

      const location: ParameterLocation = {
        type,
        index: allocIndex(),
        line: lineNum,
        ...(valueStart !== -1
          ? { startChar: valueStart, endChar: valueStart + value.length }
          : {}),
        ...(this.fixedKeywords.length > 0
          ? { additionalRanges: this.fixedKeywords.map((k) => ({ ...k })) }
          : {}),
      };
      locations.push(location);
      diagonalsFound++;
    }

    this.elementsSeen += values.length;
    this.remaining -= diagonalsFound;

    return locations;
  }
}
