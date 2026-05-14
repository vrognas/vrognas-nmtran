/**
 * Definition and Reference Service — navigation for NMTRAN parameters
 * (THETA / ETA / EPS / ERR) and user-defined variables ($PK / $PRED / $ERROR
 * LHS bindings).
 *
 * Positions for parameter declarations are sourced directly from
 * `ParameterScanner.scanDocument`; this service intentionally holds no
 * parallel scan cache or position-finding logic.
 */

import { Connection, Location, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParameterScanner, ParameterLocation } from './ParameterScanner';
import { PerformanceMonitor } from '../utils/performanceMonitor';
import { ABBREVIATED_CODE_BLOCKS } from '../constants';
import { stripComment, splitLines } from '../utils/text';
import {
  RECORD_PATTERNS,
  BLOCK_RE,
  SAME_RE,
  createParameterReferenceRegex,
} from '../utils/patterns';
import { resolveErrBinding } from '../utils/errBinding';

const PARAMETER_PATTERNS = {
  ...RECORD_PATTERNS,
  BLOCK: BLOCK_RE,
  SAME: SAME_RE,
} as const;

/** NONMEM array names handled by the parameter (THETA/ETA/EPS) path; user-variable lookup skips these. */
const NONMEM_INDEXED_ARRAYS = new Set(['THETA', 'ETA', 'EPS', 'ERR', 'OMEGA', 'SIGMA']);

/** NMTRAN reserved words / control flow that aren't user-defined variables. Cursor on these returns null. */
const NMTRAN_KEYWORDS = new Set([
  'IF', 'THEN', 'ELSE', 'ELSEIF', 'ENDIF', 'DO', 'ENDDO', 'CALL',
  'AND', 'OR', 'NOT', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE',
  'TRUE', 'FALSE', 'FIX', 'FIXED',
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type ParameterType = 'THETA' | 'ETA' | 'EPS';

interface ParameterInfo {
  type: string;
  index: number;
}

export class DefinitionService {
  private connection: Connection;
  private performanceMonitor: PerformanceMonitor;

  constructor(connection: Connection) {
    this.connection = connection;
    this.performanceMonitor = new PerformanceMonitor(connection);
  }

  /**
   * Provides definition location for NMTRAN parameters.
   * THETA(3) → 3rd $THETA value range. ETA(2) → 2nd OMEGA diagonal. EPS(1) → 1st SIGMA value.
   * SAME constraints emit both the SAME keyword location and the referenced value location.
   */
  async provideDefinition(document: TextDocument, position: Position): Promise<Location[] | null> {
    return this.performanceMonitor.measure('provideDefinition', async () => {
      try {
        const parameter = this.getParameterAtPosition(document, position);
        if (parameter) {
          const definitionLocations = this.findAllDefinitionLocations(document, parameter);
          return definitionLocations.length > 0 ? definitionLocations : null;
        }

        // Fallback: user-defined variable (LHS of `name = rhs` inside an
        // abbreviated-code block — $PRED / $PK / $ERROR / $DES / …).
        const userVar = this.getUserVariableAtPosition(document, position);
        if (userVar) {
          const loc = this.findUserVariableDefinition(document, userVar);
          return loc ? [loc] : null;
        }

        return null;
      } catch (error) {
        this.connection.console.error(`❌ Error in definition provider: ${error}`);
        return null;
      }
    });
  }

  /**
   * Provides all reference locations for NMTRAN parameters.
   * Shows everywhere THETA(3), ETA(2), etc. is used in the document.
   */
  provideReferences(document: TextDocument, position: Position, includeDeclaration: boolean): Location[] | null {
    try {
      const parameter = this.getParameterAtPosition(document, position);
      if (parameter) {
        return this.findAllReferences(document, parameter, includeDeclaration);
      }

      const userVar = this.getUserVariableAtPosition(document, position);
      if (userVar) {
        return this.findUserVariableReferences(document, userVar, includeDeclaration);
      }

      return null;
    } catch (error) {
      this.connection.console.error(`❌ Error in references provider: ${error}`);
      return null;
    }
  }

  clearCacheForUri(_uri: string): void {
    // No-op: scan cache lives in ParameterScanner; server.ts invokes
    // ParameterScanner.clearCacheForUri on document close.
  }

  /**
   * Resolves cursor position to a parameter (THETA(n) / ETA(n) / EPS(n)).
   * Order: explicit reference at cursor → declared param whose value range covers cursor →
   * first param declared on this line → $RECORD header line ⇒ first param of that record.
   */
  private getParameterAtPosition(document: TextDocument, position: Position): ParameterInfo | null {
    const line = document.getText({
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: Number.MAX_VALUE }
    });

    // 1. Explicit reference: THETA(1), ETA(2), EPS(3), ERR(1).
    for (const m of line.matchAll(createParameterReferenceRegex())) {
      const idx = m.index ?? 0;
      const end = idx + m[0].length;
      if (position.character >= idx && position.character <= end) {
        const rawType = m[1]!.toUpperCase();
        const mappedType = rawType === 'ERR'
          ? resolveErrBinding(document).binding
          : rawType;
        return {
          type: mappedType,
          index: parseInt(m[2]!, 10)
        };
      }
    }

    // 2. Use scan output to map cursor on a definition / continuation / BLOCK header line.
    const allParams = ParameterScanner.scanDocument(document);
    const paramsOnLine = allParams.filter(p => p.line === position.line);

    // 2a. Cursor sits within a specific param value range.
    for (const p of paramsOnLine) {
      if (p.startChar !== undefined && p.endChar !== undefined &&
          position.character >= p.startChar && position.character <= p.endChar) {
        return { type: p.type, index: p.index };
      }
    }

    // 2b. Cursor on a line declaring at least one param (continuation, inline def) → first param.
    if (paramsOnLine.length > 0) {
      const first = paramsOnLine[0]!;
      return { type: first.type, index: first.index };
    }

    // 2c. Cursor on a $RECORD header with no inline values (e.g. `$OMEGA BLOCK(2)`).
    //     Resolve to the first param emitted at or after this header line, scoped to the record type.
    const trimmedLine = line.trim();
    const headerType = this.headerTypeFor(trimmedLine);
    if (headerType) {
      const next = allParams.find(p => p.type === headerType && p.line >= position.line);
      if (next) return { type: next.type, index: next.index };
    }

    return null;
  }

  private headerTypeFor(trimmedLine: string): ParameterType | null {
    if (PARAMETER_PATTERNS.THETA.test(trimmedLine)) return 'THETA';
    if (PARAMETER_PATTERNS.OMEGA.test(trimmedLine)) return 'ETA';
    if (PARAMETER_PATTERNS.SIGMA.test(trimmedLine)) return 'EPS';
    return null;
  }

  /**
   * Returns all definition locations for a parameter — primary range plus
   * additionalRanges (FIXED keywords) plus, for SAME-constrained ETA, the
   * referenced original BLOCK value.
   */
  private findAllDefinitionLocations(document: TextDocument, parameter: ParameterInfo): Location[] {
    const allParams = ParameterScanner.scanDocument(document);

    const paramLocation = allParams.find(param =>
      param.type === parameter.type && param.index === parameter.index
    );
    if (!paramLocation) return [];

    const lines = splitLines(document.getText());
    const line = lines[paramLocation.line];
    const locations: Location[] = [];

    locations.push({
      uri: document.uri,
      range: {
        start: { line: paramLocation.line, character: paramLocation.startChar ?? 0 },
        end:   { line: paramLocation.line, character: paramLocation.endChar   ?? line?.length ?? 0 }
      }
    });

    if (paramLocation.additionalRanges) {
      for (const range of paramLocation.additionalRanges) {
        locations.push({
          uri: document.uri,
          range: {
            start: { line: range.line ?? paramLocation.line, character: range.startChar },
            end:   { line: range.line ?? paramLocation.line, character: range.endChar }
          }
        });
      }
    }

    // ETA on a SAME line: also point at the referenced BLOCK's first diagonal value.
    if (parameter.type === 'ETA' && line && /\bSAME\b/i.test(line.trim())) {
      const referencedLocation = this.findSameReferenceLocation(document, paramLocation.line, allParams);
      if (referencedLocation) {
        locations.push(referencedLocation);
      }
    }

    return locations;
  }

  /**
   * For an ETA SAME line, return the first-diagonal location of the preceding
   * non-SAME `$OMEGA BLOCK(n)`.
   */
  private findSameReferenceLocation(
    document: TextDocument,
    sameLineNum: number,
    allParams: ParameterLocation[]
  ): Location | null {
    const lines = splitLines(document.getText());

    let blockLine = -1;
    for (let i = sameLineNum - 1; i >= 0; i--) {
      const trimmed = (lines[i] ?? '').trim();
      if (trimmed.startsWith(';') || !trimmed) continue;
      if (/^\$OMEGA.*BLOCK\(\d+\)/i.test(trimmed) && !/\bSAME\b/i.test(trimmed)) {
        blockLine = i;
        break;
      }
    }
    if (blockLine === -1) return null;

    const firstEta = allParams.find(p =>
      p.type === 'ETA' && p.line >= blockLine && p.line < sameLineNum
    );
    if (!firstEta || firstEta.startChar === undefined || firstEta.endChar === undefined) return null;

    return {
      uri: document.uri,
      range: {
        start: { line: firstEta.line, character: firstEta.startChar },
        end:   { line: firstEta.line, character: firstEta.endChar }
      }
    };
  }

  /**
   * Finds all references to a parameter in the document.
   * @param includeDeclaration If true, includes definition locations; if false, only usage locations.
   */
  private findAllReferences(document: TextDocument, parameter: ParameterInfo, includeDeclaration: boolean = true): Location[] {
    const references: Location[] = [];
    const lines = splitLines(document.getText());

    // EPS(n) and ERR(n) are synonyms; usage search must match both.
    const typePattern = parameter.type === 'EPS' ? '(EPS|ERR)' : parameter.type;
    const searchPattern = new RegExp(`\\b${typePattern}\\(${parameter.index}\\)`, 'gi');

    const allParams = ParameterScanner.scanDocument(document);

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      if (!line) continue;

      const paramLocation = allParams.find(param =>
        param.type === parameter.type && param.index === parameter.index && param.line === lineNum
      );

      if (paramLocation && includeDeclaration) {
        references.push({
          uri: document.uri,
          range: {
            start: { line: lineNum, character: paramLocation.startChar ?? 0 },
            end:   { line: lineNum, character: paramLocation.endChar   ?? line.length }
          }
        });

        if (paramLocation.additionalRanges) {
          for (const range of paramLocation.additionalRanges) {
            references.push({
              uri: document.uri,
              range: {
                start: { line: range.line ?? lineNum, character: range.startChar },
                end:   { line: range.line ?? lineNum, character: range.endChar }
              }
            });
          }
        }
      }

      for (const m of line.matchAll(searchPattern)) {
        const idx = m.index ?? 0;
        const commentStart = line.indexOf(';');
        const isInComment = commentStart !== -1 && idx > commentStart;
        if (!isInComment) {
          references.push({
            uri: document.uri,
            range: {
              start: { line: lineNum, character: idx },
              end:   { line: lineNum, character: idx + m[0].length }
            }
          });
        }
      }
    }

    return references;
  }

  /**
   * If the cursor sits on a bare identifier *inside an abbreviated-code
   * block* ($PRED / $PK / $ERROR / $DES / …) and that identifier isn't a
   * NONMEM array (THETA / ETA / EPS / ERR / OMEGA / SIGMA — those are
   * handled by the parameter path), return the identifier text. Used for
   * F12 / Find-References on user-defined variables like `CL`, `V1`, `Y`.
   */
  private getUserVariableAtPosition(document: TextDocument, position: Position): string | null {
    const word = this.getWordAtPosition(document, position);
    if (!word) return null;
    const upper = word.toUpperCase();
    if (NONMEM_INDEXED_ARRAYS.has(upper)) return null;
    if (NMTRAN_KEYWORDS.has(upper)) return null;
    if (!this.isInAbbreviatedCodeBlock(document, position.line)) return null;
    return word;
  }

  private getWordAtPosition(document: TextDocument, position: Position): string | null {
    const line = document.getText({
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: Number.MAX_VALUE },
    });
    for (const m of line.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (position.character >= start && position.character <= end) return m[0];
    }
    return null;
  }

  /** Walk back from `lineNum` to the most recent $RECORD; return true if it's an abbreviated-code block. */
  private isInAbbreviatedCodeBlock(document: TextDocument, lineNum: number): boolean {
    const lines = document.getText().split(/\r?\n/);
    for (let i = lineNum; i >= 0; i--) {
      const trimmed = (lines[i] ?? '').trim();
      if (trimmed.startsWith(';') || !trimmed) continue;
      const m = trimmed.match(/^\$(\w+)/);
      if (!m) continue;
      return ABBREVIATED_CODE_BLOCKS.has('$' + m[1]!.toUpperCase());
    }
    return false;
  }

  /** First top-level `<name> = …` assignment inside an abbreviated-code block. */
  private findUserVariableDefinition(document: TextDocument, name: string): Location | null {
    const lines = document.getText().split(/\r?\n/);
    let inAbbreviated = false;
    const upper = name.toUpperCase();
    const assignRe = new RegExp(`^\\s*(${escapeRegex(name)})\\s*=`, 'i');
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const raw = lines[lineNum] ?? '';
      const codeOnly = stripComment(raw);
      if (!codeOnly.trim()) continue;

      const recordMatch = codeOnly.match(/^\s*\$(\w+)\s*(.*)$/);
      let scanFrom = 0;
      let scanText = codeOnly;
      if (recordMatch && recordMatch[1] !== undefined) {
        const blockName = '$' + recordMatch[1].toUpperCase();
        inAbbreviated = ABBREVIATED_CODE_BLOCKS.has(blockName);
        scanFrom = codeOnly.length - (recordMatch[2] ?? '').length;
        scanText = recordMatch[2] ?? '';
      }
      if (!inAbbreviated) continue;

      const assignMatch = scanText.match(assignRe);
      if (!assignMatch || !assignMatch[1] || assignMatch[1].toUpperCase() !== upper) continue;
      const lhsStart = scanFrom + assignMatch[0].indexOf(assignMatch[1]);
      return {
        uri: document.uri,
        range: {
          start: { line: lineNum, character: lhsStart },
          end:   { line: lineNum, character: lhsStart + assignMatch[1].length },
        },
      };
    }
    return null;
  }

  /** All non-comment occurrences of the bare identifier in the document. */
  private findUserVariableReferences(
    document: TextDocument,
    name: string,
    _includeDeclaration: boolean,
  ): Location[] {
    const lines = document.getText().split(/\r?\n/);
    const results: Location[] = [];
    const wordRe = new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi');
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const raw = lines[lineNum] ?? '';
      const codeEnd = stripComment(raw).length;
      for (const m of raw.matchAll(wordRe)) {
        const idx = m.index ?? 0;
        if (idx >= codeEnd) break;
        results.push({
          uri: document.uri,
          range: {
            start: { line: lineNum, character: idx },
            end:   { line: lineNum, character: idx + m[0].length },
          },
        });
      }
    }
    return results;
  }
}
