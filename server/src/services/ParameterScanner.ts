/**
 * ParameterScanner — walks an NMTRAN document and emits a
 * `ParameterLocation[]` describing every `THETA`/`ETA`/`EPS` declaration
 * (with bounds, FIXED keywords, and BLOCK matrix context). Result is
 * cached per (uri, version).
 *
 * Validators (sequential-numbering / references / block-matrix syntax /
 * SAME usage / parameter bounds / COM indices / infinity-token misuse)
 * live under `server/src/validators/` and consume either this output
 * or the raw document directly. `resolveErrBinding` lives in
 * `utils/errBinding.ts`.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { NMTRANMatrixParser } from '../utils/NMTRANMatrixParser';
import { stripComment, stripRecordPrefix, stripBlockPrefix } from '../utils/text';
import { RECORD_PATTERNS, BLOCK_RE, SAME_RE } from '../utils/patterns';

export interface ParameterLocation {
  type: 'THETA' | 'ETA' | 'EPS';
  index: number;
  line: number;
  startChar?: number;
  endChar?: number;
  additionalRanges?: Array<{ startChar: number; endChar: number; line?: number }>; // For FIXED keyword, etc.
}

export interface ScannerState {
  currentBlockType: 'THETA' | 'ETA' | 'EPS' | null;
  inBlockMatrix: boolean;
  blockMatrixRemaining: number;
  blockMatrixSize: number;
  blockElementsSeen: number;
  blockDiagonalsSeen: number;
  blockElements: string[];
  counters: { THETA: number; ETA: number; EPS: number };
  blockFixedKeywords: Array<{ startChar: number; endChar: number; line: number }>; // FIXED keywords for current block
}

interface BlockMatrixState {
  inBlockMatrix: boolean;
  blockMatrixRemaining: number;
}

function createScannerState(): ScannerState {
  return {
    currentBlockType: null,
    inBlockMatrix: false,
    blockMatrixRemaining: 0,
    blockMatrixSize: 0,
    blockElementsSeen: 0,
    blockDiagonalsSeen: 0,
    blockElements: [],
    counters: { THETA: 0, ETA: 0, EPS: 0 },
    blockFixedKeywords: [],
  };
}

// File-local patterns merged with the shared ones from utils/patterns.
const PARAMETER_PATTERNS = {
  ...RECORD_PATTERNS,
  BLOCK: BLOCK_RE,
  SAME: SAME_RE,
  FIXED: /\b(FIX|FIXED)\b/gi,
  FIXED_CASE_INSENSITIVE: /\b(FIX|FIXED)\b/i,
  FIXED_START: /^(FIX|FIXED)\b/i,
  NUMERIC: /[\d\-+][\d\-+.eE]*/g,
  NUMERIC_SINGLE: /[\d\-+][\d\-+.eE]*/,
  WHITESPACE: /\s/,
  WHITESPACE_OR_PAREN: /[\s(]/,
  PARAMETER_KEYWORDS: /\b(FIX|FIXED|STANDARD|VARIANCE|CORRELATION|CHOLESKY|DIAGONAL|SAME|VALUES|NAMES)\b/gi,
} as const;

export class ParameterScanner {
  private static scanCacheMap = new Map<string, ParameterLocation[]>();
  private static readonly MAX_SCAN_CACHE = 20;

  static clearCache(): void {
    this.scanCacheMap.clear();
  }

  static clearCacheForUri(uri: string): void {
    const prefix = uri + ':';
    for (const key of this.scanCacheMap.keys()) {
      if (key.startsWith(prefix)) {
        this.scanCacheMap.delete(key);
      }
    }
  }

  private static deepCopyLocations(locations: ParameterLocation[]): ParameterLocation[] {
    return locations.map(loc => ({
      ...loc,
      ...(loc.additionalRanges ? { additionalRanges: loc.additionalRanges.map(r => ({ ...r })) } : {})
    }));
  }

  /**
   * Scan document for all parameter definitions
   */
  static scanDocument(document: TextDocument): ParameterLocation[] {
    // Cache key is `<uri>:<version>` — the caller is responsible for
    // ensuring this pair uniquely identifies the document contents.
    // The `nmtran/parseModelText` LSP handler generates a unique URI per
    // call (`embedded://lst/<counter>`) so synthetic docs cache safely.
    const cacheKey = `${document.uri}:${document.version}`;
    const cached = this.scanCacheMap.get(cacheKey);
    if (cached) return this.deepCopyLocations(cached);

    const locations: ParameterLocation[] = [];
    const lines = document.getText().split('\n');
    const state = createScannerState();
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      if (!line) continue;

      const trimmed = line.trim();
      if (this.shouldSkipLine(trimmed)) continue;

      // Update state based on control record
      this.updateStateForControlRecord(trimmed, state, lineNum);

      // Process parameters if in a parameter block
      if (state.currentBlockType) {
        const lineLocations = this.processParameterLine(
          line, 
          lineNum, 
          state, 
          document
        );
        locations.push(...lineLocations);
      }
    }

    // Cache the scan result
    this.scanCacheMap.set(cacheKey, locations);
    if (this.scanCacheMap.size > this.MAX_SCAN_CACHE) {
      const firstKey = this.scanCacheMap.keys().next().value;
      if (firstKey) this.scanCacheMap.delete(firstKey);
    }

    return this.deepCopyLocations(locations);
  }

  /**
   * Check if line should be skipped
   */
  private static shouldSkipLine(trimmed: string): boolean {
    return trimmed.startsWith(';') || trimmed.length === 0;
  }

  /**
   * Update scanner state based on control record
   */
  private static updateStateForControlRecord(trimmed: string, state: ScannerState, lineNum: number): void {
    const lineWithoutComment = stripComment(trimmed).trim();

    if (PARAMETER_PATTERNS.THETA.test(lineWithoutComment)) {
      state.currentBlockType = 'THETA';
      state.inBlockMatrix = false;
      state.blockMatrixRemaining = 0;
      return;
    }

    // OMEGA / SIGMA share identical block-state setup; the only difference
    // is which parameter-array index counter they advance (ETA vs EPS).
    const isOmega = PARAMETER_PATTERNS.OMEGA.test(lineWithoutComment);
    const isSigma = !isOmega && PARAMETER_PATTERNS.SIGMA.test(lineWithoutComment);
    if (isOmega || isSigma) {
      state.currentBlockType = isOmega ? 'ETA' : 'EPS';
      const matrixState = this.detectBlockMatrix(lineWithoutComment);
      state.inBlockMatrix = matrixState.inBlockMatrix;
      state.blockMatrixRemaining = matrixState.blockMatrixRemaining;
      const blockMatch = lineWithoutComment.match(PARAMETER_PATTERNS.BLOCK);
      state.blockMatrixSize = blockMatch && blockMatch[1] ? parseInt(blockMatch[1], 10) : 0;
      state.blockElementsSeen = 0;
      state.blockDiagonalsSeen = 0;
      state.blockFixedKeywords = [];
      if (state.inBlockMatrix) {
        this.detectBlockFixedKeywords(lineWithoutComment, lineNum, state);
      }
      return;
    }

    if (lineWithoutComment.startsWith('$')) {
      // Any other control record — leave the THETA/ETA/EPS context.
      state.currentBlockType = null;
      state.inBlockMatrix = false;
      state.blockMatrixRemaining = 0;
    }
  }

  /**
   * Detect and store FIXED keywords from BLOCK declaration line
   */
  private static detectBlockFixedKeywords(line: string, lineNum: number, state: ScannerState): void {
    PARAMETER_PATTERNS.FIXED.lastIndex = 0;
    let match;
    while ((match = PARAMETER_PATTERNS.FIXED.exec(line)) !== null) {
      state.blockFixedKeywords.push({
        startChar: match.index,
        endChar: match.index + match[0].length,
        line: lineNum
      });
    }
  }

  /**
   * Detect BLOCK matrix from line
   */
  private static detectBlockMatrix(line: string): BlockMatrixState {
    const blockMatch = line.match(PARAMETER_PATTERNS.BLOCK);
    if (blockMatch && blockMatch[1]) {
      const blockSize = parseInt(blockMatch[1], 10);
      
      // BLOCK(1) should always be treated as regular parameters
      // because it's just a single diagonal element, not a true matrix
      if (blockSize === 1) {
        return {
          inBlockMatrix: false,
          blockMatrixRemaining: 0
        };
      }
      
      return {
        inBlockMatrix: true,
        blockMatrixRemaining: blockSize
      };
    }
    return {
      inBlockMatrix: false,
      blockMatrixRemaining: 0
    };
  }

  /**
   * Process a line containing parameters
   */
  private static processParameterLine(
    line: string, 
    lineNum: number, 
    state: ScannerState,
    document: TextDocument
  ): ParameterLocation[] {
    const locations: ParameterLocation[] = [];
    const trimmed = line.trim();
    
    // Count parameters on this line
    const paramCount = this.countParametersOnLine(trimmed, state);
    
    
    // For BLOCK matrices, first count all numeric values on this line
    let allValuesOnLine: string[] = [];
    if (state.inBlockMatrix) {
      const cleanLine = stripBlockPrefix(stripRecordPrefix(stripComment(trimmed)));
      const matches = cleanLine.match(PARAMETER_PATTERNS.NUMERIC);
      allValuesOnLine = matches || [];
      
    }
    
    // For BLOCK matrices, we need to determine which values are diagonal elements
    if (state.inBlockMatrix && allValuesOnLine.length > 0) {
      const processedLocations = this.processBlockMatrixLine(
        line,
        lineNum,
        state,
        allValuesOnLine
      );
      locations.push(...processedLocations);
    } else {
      // Regular (non-block) parameter processing - use sophisticated parser for THETA
      if (state.currentBlockType === 'THETA') {
        const expressions = this.parseParameterExpressions(line);
        
        for (let i = 0; i < Math.min(paramCount, expressions.length); i++) {
          state.counters.THETA++;
          
          const expr = expressions[i];
          const location: ParameterLocation = {
            type: 'THETA',
            index: state.counters.THETA,
            line: lineNum
          };
          
          if (expr) {
            location.startChar = expr.valueRange.startChar;
            location.endChar = expr.valueRange.endChar;
          }
          
          // Add FIXED keyword range if present
          if (expr?.fixedRange) {
            location.additionalRanges = [expr.fixedRange];
          }
          
          locations.push(location);
        }
      } else {
        // For OMEGA/SIGMA, use simpler processing (they typically don't have complex FIXED syntax)
        for (let i = 0; i < paramCount; i++) {
          const blockType = state.currentBlockType;
          if (!blockType) continue;
          
          state.counters[blockType]++;
          
          const location: ParameterLocation = {
            type: blockType,
            index: state.counters[blockType],
            line: lineNum
          };
          
          const valuePosition = this.findParameterValuePosition(
            line,
            lineNum,
            blockType,
            1,
            false,
            i + 1,
            document
          );
          
          if (valuePosition) {
            location.startChar = valuePosition.start;
            location.endChar = valuePosition.end;
          }
          
          // Check for FIXED keyword on this line (simpler approach for OMEGA/SIGMA)
          PARAMETER_PATTERNS.FIXED.lastIndex = 0; // Reset global regex
          const fixedMatches = [];
          let match;
          while ((match = PARAMETER_PATTERNS.FIXED.exec(line)) !== null) {
            fixedMatches.push({
              startChar: match.index,
              endChar: match.index + match[0].length
            });
          }
          if (fixedMatches.length > 0) {
            location.additionalRanges = fixedMatches;
          }
          
          locations.push(location);
        }
      }
    }
    
    // Update block matrix state
    if (state.inBlockMatrix && state.blockMatrixRemaining <= 0) {
      state.inBlockMatrix = false;
      state.blockElementsSeen = 0;
      state.blockDiagonalsSeen = 0;
    }
    
    return locations;
  }

  /**
   * Count parameters on a line based on current state
   */
  private static countParametersOnLine(trimmed: string, state: ScannerState): number {
    if (state.inBlockMatrix && state.blockMatrixRemaining > 0) {
      return this.countBlockMatrixParameters(trimmed, state);
    } else {
      return this.countRegularParameters(trimmed, state.currentBlockType);
    }
  }

  /**
   * Count parameters in a BLOCK matrix context
   */
  private static countBlockMatrixParameters(trimmed: string, state: ScannerState): number {
    if (trimmed.match(PARAMETER_PATTERNS.BLOCK)) {
      if (PARAMETER_PATTERNS.SAME.test(trimmed)) {
        // SAME constraint - defines 1 parameter
        return 1;
      } else {
        // Check for inline values
        const afterBlock = trimmed.replace(/^\$OMEGA\s+BLOCK\(\d+\)\s*/i, '')
                                  .replace(/^\$SIGMA\s+BLOCK\(\d+\)\s*/i, '');
        const hasValues = afterBlock.trim().length > 0 && !/^;/.test(afterBlock.trim());
        
        if (hasValues) {
          // Count diagonal parameters in inline values
          const numValues = this.countNumericValues(afterBlock);
          return Math.min(state.blockMatrixRemaining, numValues);
        }
        // BLOCK header without values
        return 0;
      }
    } else {
      // Matrix data line - could have multiple diagonal parameters if all values are on one line
      const numValues = this.countNumericValues(trimmed);
      // Return the minimum of remaining parameters needed and values found
      return Math.min(state.blockMatrixRemaining, numValues);
    }
  }

  /**
   * Count regular (non-matrix) parameters
   */
  private static countRegularParameters(line: string, blockType: 'THETA' | 'ETA' | 'EPS' | null): number {
    if (!blockType) return 0;
    
    // Check for SAME keyword first - it counts as 1 parameter
    if (PARAMETER_PATTERNS.SAME.test(line)) {
      return 1;
    }
    
    // For THETA parameters, count expressions (not individual numeric values)
    if (blockType === 'THETA') {
      const expressions = this.parseParameterExpressions(line);
      return expressions.length;
    }
    
    // For OMEGA/SIGMA, use the old numeric counting method
    const cleanContent = this.removeKeywords(line);
    if (!cleanContent) return 0;
    
    return this.countNumericValues(cleanContent);
  }

  /**
   * Remove keywords from parameter line
   */
  private static removeKeywords(line: string): string {
    // Remove comments
    const contentPart = stripComment(line);
    
    // Remove control record prefix + BLOCK(n) (BLOCK(1) decls land here too);
    // then strip parameter keywords while keeping numeric values.
    const cleanedPrefix = stripBlockPrefix(stripRecordPrefix(contentPart));
    return cleanedPrefix.replace(PARAMETER_PATTERNS.PARAMETER_KEYWORDS, '').trim();
  }

  /**
   * Count numeric values in a string
   */
  private static countNumericValues(content: string): number {
    const matches = content.match(PARAMETER_PATTERNS.NUMERIC);
    return matches ? matches.length : 0;
  }

  /**
   * Process BLOCK matrix line to find diagonal parameters
   */
  private static processBlockMatrixLine(
    line: string,
    lineNum: number,
    state: ScannerState,
    allValuesOnLine: string[]
  ): ParameterLocation[] {
    const locations: ParameterLocation[] = [];
    
    // Figure out which elements these values represent in the overall matrix
    const startElementIndex = state.blockElementsSeen;
    
    // Find which diagonal elements are on this line
    let diagonalsFound = 0;
    
    // Check each position on this line to see if it's a diagonal element
    for (let positionOnLine = 0; positionOnLine < allValuesOnLine.length; positionOnLine++) {
      const absolutePosition = startElementIndex + positionOnLine;
      const parameterIndex = NMTRANMatrixParser.isDiagonalElement(absolutePosition);
      
      if (parameterIndex !== null) {
        // This position contains a diagonal element
        const blockType = state.currentBlockType;
        if (!blockType) continue;
        
        state.counters[blockType]++;
        
        const location: ParameterLocation = {
          type: blockType,
          index: state.counters[blockType],
          line: lineNum
        };
        
        // Find the position of this specific value
        const targetValue = allValuesOnLine[positionOnLine];
        
        if (targetValue) {
          const cleanLine = line.replace(/;.*$/, '');
          const prevValue = positionOnLine > 0 ? allValuesOnLine[positionOnLine - 1] : undefined;
          const searchStart = prevValue ? cleanLine.lastIndexOf(prevValue) : 0;
          const valueStart = cleanLine.indexOf(targetValue, searchStart);
          
          if (valueStart !== -1) {
            location.startChar = valueStart;
            location.endChar = valueStart + targetValue.length;
          }
        }
        
        // Add FIXED keyword ranges to each parameter in the block
        if (state.blockFixedKeywords.length > 0) {
          location.additionalRanges = state.blockFixedKeywords.map(keyword => ({
            startChar: keyword.startChar,
            endChar: keyword.endChar,
            line: keyword.line
          }));
        }
        
        locations.push(location);
        diagonalsFound++;
      }
    }
    
    // Update total elements seen
    state.blockElementsSeen += allValuesOnLine.length;
    
    // Update diagonal count and block remaining  
    state.blockDiagonalsSeen += diagonalsFound;
    state.blockMatrixRemaining -= diagonalsFound;
    
    return locations;
  }

  /**
   * Parse THETA parameter expressions from a line
   * Handles: (0,3), 2 FIXED, (0,.6,1), 10, (-INF,-2.7,0), (37 FIXED), 4 FIX
   */
  private static parseParameterExpressions(line: string): Array<{
    valueRange: { startChar: number; endChar: number };
    fixedRange?: { startChar: number; endChar: number };
  }> {
    const expressions = [];
    
    // Remove control record prefix and comments
    const controlRecordMatch = line.match(/^\s*\$\w+\s*/i);
    const controlRecordLength = controlRecordMatch ? controlRecordMatch[0].length : 0;
    
    // Remove comment part
    const lineWithoutComment = stripComment(line);
    
    // Get content after control record
    const contentWithSpaces = lineWithoutComment.substring(controlRecordLength);
    const content = contentWithSpaces.trim();
    
    // Find where the trimmed content starts in the original line
    const trimmedContentStart = lineWithoutComment.indexOf(content, controlRecordLength);
    let currentPos = trimmedContentStart >= 0 ? trimmedContentStart : controlRecordLength;
    
    let i = 0;
    while (i < content.length) {
      // Skip whitespace
      while (i < content.length && PARAMETER_PATTERNS.WHITESPACE.test(content.charAt(i))) {
        i++;
        currentPos++;
      }
      if (i >= content.length) break;
      
      const startPos = i;
      const absStartPos = currentPos;
      
      if (content.charAt(i) === '(') {
        // Bounded expression: (low,init,up) or (value FIXED)
        let depth = 1;
        i++; // Skip opening paren
        while (i < content.length && depth > 0) {
          if (content.charAt(i) === '(') depth++;
          else if (content.charAt(i) === ')') depth--;
          i++;
        }
        
        const expr = content.substring(startPos, i);
        const fixedMatchInside = expr.match(PARAMETER_PATTERNS.FIXED_CASE_INSENSITIVE);
        
        const expression: {
          valueRange: { startChar: number; endChar: number };
          fixedRange?: { startChar: number; endChar: number };
        } = {
          valueRange: { startChar: absStartPos, endChar: absStartPos + expr.length }
        };
        
        if (fixedMatchInside && fixedMatchInside.index !== undefined) {
          // Has FIXED inside parentheses
          expression.fixedRange = { 
            startChar: absStartPos + fixedMatchInside.index, 
            endChar: absStartPos + fixedMatchInside.index + fixedMatchInside[0].length 
          };
        } else {
          // Check for FIXED keyword after the bounded expression
          // Skip whitespace after the closing parenthesis
          let afterParenPos = i;
          while (afterParenPos < content.length && PARAMETER_PATTERNS.WHITESPACE.test(content.charAt(afterParenPos))) {
            afterParenPos++;
          }
          
          // Check for FIXED/FIX keyword after the bounded expression
          const remainingAfterParen = content.substring(afterParenPos);
          const fixedMatchAfter = remainingAfterParen.match(PARAMETER_PATTERNS.FIXED_START);
          
          if (fixedMatchAfter) {
            expression.fixedRange = {
              startChar: absStartPos + (afterParenPos - startPos),
              endChar: absStartPos + (afterParenPos - startPos) + fixedMatchAfter[0].length
            };
            i = afterParenPos + fixedMatchAfter[0].length;
          }
        }
        
        expressions.push(expression);
      } else {
        // Simple value, possibly followed by FIXED
        // Read until next whitespace or parenthesis
        while (i < content.length && !PARAMETER_PATTERNS.WHITESPACE_OR_PAREN.test(content.charAt(i))) {
          i++;
        }
        
        // Check if followed by FIXED keyword
        const afterValue = i;
        
        // Skip whitespace
        while (i < content.length && PARAMETER_PATTERNS.WHITESPACE.test(content.charAt(i))) {
          i++;
        }
        
        // Check for FIXED/FIX keyword
        const remaining = content.substring(i);
        const fixedMatch = remaining.match(PARAMETER_PATTERNS.FIXED_START);
        
        const expression: {
          valueRange: { startChar: number; endChar: number };
          fixedRange?: { startChar: number; endChar: number };
        } = {
          valueRange: { startChar: absStartPos, endChar: absStartPos + (afterValue - startPos) }
        };
        
        if (fixedMatch) {
          expression.fixedRange = {
            startChar: absStartPos + (i - startPos),
            endChar: absStartPos + (i - startPos) + fixedMatch[0].length
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
   * Find the position of a parameter value
   * Delegates to appropriate finder based on parameter type
   */
  private static findParameterValuePosition(
    line: string,
    _lineNum: number,
    _paramType: 'THETA' | 'ETA' | 'EPS',
    paramIndex: number,
    inBlockMatrix: boolean,
    _positionInLine: number,
    _document: TextDocument
  ): { start: number; end: number } | null {
    const trimmed = line.trim();
    
    
    // Handle SAME keyword
    if (PARAMETER_PATTERNS.SAME.test(trimmed)) {
      const match = trimmed.match(PARAMETER_PATTERNS.SAME);
      if (match && match.index !== undefined) {
        const start = line.indexOf(match[0]);
        return {
          start: start,
          end: start + match[0].length
        };
      }
    }
    
    // For BLOCK(1) or regular parameters, find the first numeric value
    // Remove control record prefix and BLOCK(n) pattern
    let searchText = trimmed;
    const controlMatch = searchText.match(/^\s*\$\w+\s*/i);
    if (controlMatch) {
      searchText = searchText.substring(controlMatch[0].length);
    }
    
    const blockMatch = searchText.match(/^BLOCK\(\d+\)\s*/i);
    if (blockMatch) {
      searchText = searchText.substring(blockMatch[0].length);
    }
    
    // Remove comment part
    searchText = stripComment(searchText);
    
    // For BLOCK matrices, find the specific diagonal element
    if (inBlockMatrix) {
      // For multi-line BLOCK matrices, each continuation line has one diagonal parameter
      // The position within the row equals the parameter index within the block
      // E.g., for BLOCK(2): line 1 has 1 value (diagonal pos 1), line 2 has 2 values (diagonal pos 2)
      
      // Find all numeric values on this line
      PARAMETER_PATTERNS.NUMERIC.lastIndex = 0; // Reset global regex
      const matches = [];
      let match;
      
      while ((match = PARAMETER_PATTERNS.NUMERIC.exec(searchText)) !== null) {
        matches.push({
          value: match[0],
          index: match.index
        });
      }
      
      // For multi-line blocks, the diagonal position equals the parameter index
      // For single-line blocks with all values, use the diagonal position calculation
      const targetPosition = matches.length === 1 ? 0 : paramIndex - 1;
      
      // Debug: Remove after testing
      // console.log(`BLOCK: Found ${matches.length} values, using position ${targetPosition} for paramIndex ${paramIndex}`);
      
      if (matches.length > targetPosition && targetPosition >= 0) {
        const targetMatch = matches[targetPosition];
        if (targetMatch) {
          const numericValue = targetMatch.value;
          const absoluteStart = line.indexOf(numericValue, targetMatch.index > 0 ? line.indexOf(searchText) : 0);
        
          if (absoluteStart !== -1) {
            // Debug: Remove after testing
            // console.log(`Found: "${numericValue}" at ${absoluteStart}-${absoluteStart + numericValue.length}`);
            return {
              start: absoluteStart,
              end: absoluteStart + numericValue.length
            };
          }
        }
      }
    } else {
      // For regular parameters or first diagonal element, find first numeric value
      const match = searchText.match(PARAMETER_PATTERNS.NUMERIC_SINGLE);
      
      if (match && match.index !== undefined) {
        // Find the absolute position in the original line by searching for the numeric value
        const numericValue = match[0];
        const absoluteStart = line.indexOf(numericValue);
        
        if (absoluteStart !== -1) {
          return {
            start: absoluteStart,
            end: absoluteStart + numericValue.length
          };
        }
      }
    }
    
    return null;
  }


}