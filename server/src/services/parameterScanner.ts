/**
 * ParameterScanner — walks an NMTRAN document and emits a
 * `ParameterLocation[]` describing every `THETA`/`ETA`/`EPS` declaration
 * (with bounds, FIXED keywords, and BLOCK matrix context). Result is
 * cached per (uri, version).
 *
 * Orchestration only. Per-line work delegates to:
 *   - `parseThetaExpressions`  — bounded `(low,init,upper)` + simple values + FIXED
 *   - `BlockMatrixScanner`     — lower-triangular state machine for BLOCK(n>=2)
 *   - `findValuePositions`     — diagonal OMEGA/SIGMA + BLOCK(1) + SAME keyword
 *
 * Validators consume the emitted `ParameterLocation[]` rather than re-
 * parsing the document. `resolveErrBinding` lives in `utils/errBinding.ts`.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { stripComment, splitLines } from '../utils/text';
import { RECORD_PATTERNS, SAME_RE } from '../utils/patterns';
import { BlockMatrixScanner, detectBlockMatrix } from './blockMatrixScanner';

export interface ParameterLocation {
  type: 'THETA' | 'ETA' | 'EPS';
  index: number;
  line: number;
  startChar?: number;
  endChar?: number;
  /** FIXED keyword ranges and other parallel decorations. */
  additionalRanges?: Array<{ startChar: number; endChar: number; line?: number }>;
}

interface ScannerState {
  currentBlockType: 'THETA' | 'ETA' | 'EPS' | null;
  counters: { THETA: number; ETA: number; EPS: number };
  block: BlockMatrixScanner | null;
}

const FIXED_GLOBAL = /\b(FIX|FIXED)\b/gi;
const NUMERIC_GLOBAL = /[\d\-+][\d\-+.eE]*/g;
const WHITESPACE = /\s/;
const WHITESPACE_OR_PAREN = /[\s(]/;
const FIXED_START = /^(FIX|FIXED)\b/i;
const FIXED_INSIDE = /\b(FIX|FIXED)\b/i;

export class ParameterScanner {
  private static scanCacheMap = new Map<string, ParameterLocation[]>();
  private static readonly MAX_SCAN_CACHE = 20;

  static clearCache(): void {
    this.scanCacheMap.clear();
  }

  static clearCacheForUri(uri: string): void {
    const prefix = uri + ':';
    for (const key of this.scanCacheMap.keys()) {
      if (key.startsWith(prefix)) this.scanCacheMap.delete(key);
    }
  }

  private static deepCopy(locations: ParameterLocation[]): ParameterLocation[] {
    return locations.map((loc) => ({
      ...loc,
      ...(loc.additionalRanges
        ? { additionalRanges: loc.additionalRanges.map((r) => ({ ...r })) }
        : {}),
    }));
  }

  static scanDocument(document: TextDocument): ParameterLocation[] {
    // Cache key is `<uri>:<version>` — caller's responsibility to ensure
    // (uri, version) uniquely identifies content. `nmtran/parseModelText`
    // mints unique URIs per call so synthetic docs cache safely.
    const cacheKey = `${document.uri}:${document.version}`;
    const cached = this.scanCacheMap.get(cacheKey);
    if (cached) return this.deepCopy(cached);

    const lines = splitLines(document.getText());
    const state: ScannerState = {
      currentBlockType: null,
      counters: { THETA: 0, ETA: 0, EPS: 0 },
      block: null,
    };
    const locations: ParameterLocation[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;

      const lineWithoutComment = stripComment(trimmed).trim();

      // 1. $RECORD headers reset block context. BLOCK headers also seed a
      //    BlockMatrixScanner (except SAME variants — those emit one ETA
      //    via the diagonal path below, preserving prior behaviour).
      if (this.updateRecordContext(lineWithoutComment, line, lineNum, state)) {
        // Header line consumed for state; fall through so inline values
        // (e.g. `$THETA 0.5`, `$OMEGA BLOCK(2) 0.1 0 0.2`) get emitted.
      }

      if (state.currentBlockType === null) continue;

      // 2. Dispatch per active context.
      if (state.currentBlockType === 'THETA') {
        locations.push(...this.emitThetas(line, lineNum, state));
      } else if (state.block && state.block.isActive()) {
        const type = state.currentBlockType;
        locations.push(
          ...state.block.processLine(line, lineNum, type, () => ++state.counters[type]),
        );
        if (!state.block.isActive()) state.block = null;
      } else {
        locations.push(...this.emitDiagonalOmegaSigma(line, lineNum, state));
      }
    }

    this.scanCacheMap.set(cacheKey, locations);
    if (this.scanCacheMap.size > this.MAX_SCAN_CACHE) {
      const firstKey = this.scanCacheMap.keys().next().value;
      if (firstKey) this.scanCacheMap.delete(firstKey);
    }

    return this.deepCopy(locations);
  }

  /**
   * Apply $RECORD transitions. Returns true when the line is a $RECORD
   * header — the caller still falls through to emit any inline values on
   * the same line.
   */
  private static updateRecordContext(
    lineWithoutComment: string,
    fullLine: string,
    lineNum: number,
    state: ScannerState,
  ): boolean {
    if (RECORD_PATTERNS.THETA.test(lineWithoutComment)) {
      state.currentBlockType = 'THETA';
      state.block = null;
      return true;
    }

    const isOmega = RECORD_PATTERNS.OMEGA.test(lineWithoutComment);
    const isSigma = !isOmega && RECORD_PATTERNS.SIGMA.test(lineWithoutComment);
    if (isOmega || isSigma) {
      state.currentBlockType = isOmega ? 'ETA' : 'EPS';
      const info = detectBlockMatrix(lineWithoutComment);
      const isSame = SAME_RE.test(lineWithoutComment);
      // BLOCK(n>=2) without SAME → seed the matrix scanner. BLOCK(1) and
      // BLOCK(n) SAME fall to the diagonal path (one value / one keyword).
      state.block =
        info && info.isMatrix && !isSame
          ? new BlockMatrixScanner(info, fullLine, lineNum)
          : null;
      return true;
    }

    if (lineWithoutComment.startsWith('$')) {
      state.currentBlockType = null;
      state.block = null;
      return true;
    }

    return false;
  }

  private static emitThetas(
    line: string,
    lineNum: number,
    state: ScannerState,
  ): ParameterLocation[] {
    const out: ParameterLocation[] = [];
    for (const expr of parseThetaExpressions(line)) {
      state.counters.THETA++;
      out.push({
        type: 'THETA',
        index: state.counters.THETA,
        line: lineNum,
        startChar: expr.valueRange.startChar,
        endChar: expr.valueRange.endChar,
        ...(expr.fixedRange ? { additionalRanges: [expr.fixedRange] } : {}),
      });
    }
    return out;
  }

  private static emitDiagonalOmegaSigma(
    line: string,
    lineNum: number,
    state: ScannerState,
  ): ParameterLocation[] {
    const type = state.currentBlockType;
    if (type !== 'ETA' && type !== 'EPS') return [];

    const valuePositions = findValuePositions(line);
    if (valuePositions.length === 0) return [];

    // FIXED keywords on this line apply to every parameter on the line.
    const fixedMatches: Array<{ startChar: number; endChar: number }> = [];
    for (const m of line.matchAll(FIXED_GLOBAL)) {
      fixedMatches.push({ startChar: m.index!, endChar: m.index! + m[0].length });
    }

    return valuePositions.map((pos) => {
      state.counters[type]++;
      return {
        type,
        index: state.counters[type],
        line: lineNum,
        startChar: pos.start,
        endChar: pos.end,
        ...(fixedMatches.length > 0 ? { additionalRanges: fixedMatches } : {}),
      };
    });
  }
}

/**
 * Parse THETA parameter expressions from a line.
 * Handles: `(0,3)`, `2 FIXED`, `(0,.6,1)`, `10`, `(-INF,-2.7,0)`,
 * `(37 FIXED)`, `4 FIX`. Returns one entry per declared parameter on the
 * line, in order, with absolute char offsets relative to the original line.
 */
function parseThetaExpressions(line: string): Array<{
  valueRange: { startChar: number; endChar: number };
  fixedRange?: { startChar: number; endChar: number };
}> {
  const expressions: Array<{
    valueRange: { startChar: number; endChar: number };
    fixedRange?: { startChar: number; endChar: number };
  }> = [];

  const controlRecordMatch = line.match(/^\s*\$\w+\s*/i);
  const controlRecordLength = controlRecordMatch ? controlRecordMatch[0].length : 0;
  const lineWithoutComment = stripComment(line);

  const contentWithSpaces = lineWithoutComment.substring(controlRecordLength);
  const content = contentWithSpaces.trim();
  const trimmedContentStart = lineWithoutComment.indexOf(content, controlRecordLength);
  let currentPos = trimmedContentStart >= 0 ? trimmedContentStart : controlRecordLength;

  let i = 0;
  while (i < content.length) {
    while (i < content.length && WHITESPACE.test(content.charAt(i))) {
      i++;
      currentPos++;
    }
    if (i >= content.length) break;

    const startPos = i;
    const absStartPos = currentPos;

    if (content.charAt(i) === '(') {
      // Bounded expression: (low,init,up) or (value FIXED).
      let depth = 1;
      i++;
      while (i < content.length && depth > 0) {
        if (content.charAt(i) === '(') depth++;
        else if (content.charAt(i) === ')') depth--;
        i++;
      }

      const expr = content.substring(startPos, i);
      const fixedInside = expr.match(FIXED_INSIDE);

      const expression: {
        valueRange: { startChar: number; endChar: number };
        fixedRange?: { startChar: number; endChar: number };
      } = {
        valueRange: { startChar: absStartPos, endChar: absStartPos + expr.length },
      };

      if (fixedInside && fixedInside.index !== undefined) {
        expression.fixedRange = {
          startChar: absStartPos + fixedInside.index,
          endChar: absStartPos + fixedInside.index + fixedInside[0].length,
        };
      } else {
        // FIXED keyword may appear AFTER the closing parenthesis.
        let afterParen = i;
        while (afterParen < content.length && WHITESPACE.test(content.charAt(afterParen))) {
          afterParen++;
        }
        const fixedAfter = content.substring(afterParen).match(FIXED_START);
        if (fixedAfter) {
          expression.fixedRange = {
            startChar: absStartPos + (afterParen - startPos),
            endChar: absStartPos + (afterParen - startPos) + fixedAfter[0].length,
          };
          i = afterParen + fixedAfter[0].length;
        }
      }

      expressions.push(expression);
    } else {
      // Simple value possibly followed by FIXED.
      while (i < content.length && !WHITESPACE_OR_PAREN.test(content.charAt(i))) i++;
      const afterValue = i;

      while (i < content.length && WHITESPACE.test(content.charAt(i))) i++;
      const fixedMatch = content.substring(i).match(FIXED_START);

      const expression: {
        valueRange: { startChar: number; endChar: number };
        fixedRange?: { startChar: number; endChar: number };
      } = {
        valueRange: { startChar: absStartPos, endChar: absStartPos + (afterValue - startPos) },
      };

      if (fixedMatch) {
        expression.fixedRange = {
          startChar: absStartPos + (i - startPos),
          endChar: absStartPos + (i - startPos) + fixedMatch[0].length,
        };
        i += fixedMatch[0].length;
      }

      expressions.push(expression);
    }

    currentPos = absStartPos + (i - startPos);
  }

  return expressions;
}

/**
 * Locate every parameter value on a non-block OMEGA/SIGMA line, in order.
 * SAME yields a single position (the SAME keyword); otherwise every numeric
 * token after the $RECORD + BLOCK(n) prefix is returned.
 *
 * Absolute character offsets relative to the original `line`.
 */
function findValuePositions(line: string): Array<{ start: number; end: number }> {
  const trimmed = line.trim();

  if (SAME_RE.test(trimmed)) {
    const match = trimmed.match(SAME_RE);
    if (match && match.index !== undefined) {
      const start = line.indexOf(match[0]);
      if (start !== -1) return [{ start, end: start + match[0].length }];
    }
    return [];
  }

  let offset = 0;
  let searchText = line;
  const controlMatch = searchText.match(/^\s*\$\w+\s*/i);
  if (controlMatch) {
    offset += controlMatch[0].length;
    searchText = searchText.substring(controlMatch[0].length);
  }
  const blockMatch = searchText.match(/^BLOCK\(\d+\)\s*/i);
  if (blockMatch) {
    offset += blockMatch[0].length;
    searchText = searchText.substring(blockMatch[0].length);
  }
  searchText = stripComment(searchText);

  const positions: Array<{ start: number; end: number }> = [];
  for (const m of searchText.matchAll(NUMERIC_GLOBAL)) {
    const start = offset + (m.index ?? 0);
    positions.push({ start, end: start + m[0].length });
  }
  return positions;
}
