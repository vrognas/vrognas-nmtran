/**
 * Hover Service
 *
 * Handles hover information for NMTRAN control records.
 * Separated from main server for better maintainability.
 */

import { Connection, Hover, MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { explainControlRecordHover } from '../hoverInfo';
import { getFullControlRecordName } from '../utils/validateControlRecords';
import { ParameterScanner, ParameterLocation } from './ParameterScanner';
import { reservedDiagnosticItems } from '../constants';
import { resolveErrBinding } from '../utils/errBinding';

export class HoverService {
  private connection: Connection;

  private createControlRecordRegex() { return /\$[A-Z]+\b/g; }
  private createParameterUsageRegex() { return /\b(THETA|ETA|EPS|ERR)\((\d+)\)/gi; }

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Provides hover information for control records and parameter references at the given position
   */
  provideHover(document: TextDocument, position: { line: number; character: number }): Hover | null {
    try {
      const text = document.getText();
      const offset = document.offsetAt(position);
      const lines = text.split('\n');
      const parameterLocations = ParameterScanner.scanDocument(document);

      const parameterHover = this.getParameterReferenceHover(document, position, offset, parameterLocations, lines);
      if (parameterHover) return parameterHover;

      const reservedVariableHover = this.getReservedVariableHover(text, offset);
      if (reservedVariableHover) return reservedVariableHover;

      const diagnosticItemHover = this.getDiagnosticItemHover(text, offset);
      if (diagnosticItemHover) return diagnosticItemHover;

      return this.getControlRecordHover(text, offset, document);
    } catch (error) {
      this.connection.console.error(`Error providing hover: ${error}`);
      return null;
    }
  }

  /**
   * Get hover information for parameter references like THETA(1), ETA(2), etc.
   */
  private getParameterReferenceHover(
    document: TextDocument,
    _position: { line: number; character: number },
    offset: number,
    parameterLocations: ParameterLocation[],
    lines: string[]
  ): Hover | null {
    const text = document.getText();
    const paramRegex = this.createParameterUsageRegex();
    let match: RegExpExecArray | null;

    while ((match = paramRegex.exec(text)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;

      if (start <= offset && offset <= end) {
        const paramType = match[1]!.toUpperCase() as 'THETA' | 'ETA' | 'EPS' | 'ERR';
        const paramIndex = parseInt(match[2] || '0', 10);

        // Resolve ERR -> ETA (individual) or EPS (population) per NONMEM Help Ch.8.
        const normalizedType = paramType === 'ERR'
          ? resolveErrBinding(document).binding
          : paramType;

        // Find the parameter definition
        const definition = parameterLocations.find(loc =>
          loc.type === normalizedType && loc.index === paramIndex
        );

        if (definition) {
          const hoverContent = this.buildParameterHoverContent(definition, paramType, paramIndex, parameterLocations, lines);

          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: hoverContent
            },
            range: {
              start: document.positionAt(start),
              end: document.positionAt(end)
            }
          };
        }
      }
    }

    return null;
  }

  /**
   * Get hover information for control records
   */
  private getControlRecordHover(text: string, offset: number, document: TextDocument): Hover | null {
    const controlRegex = this.createControlRecordRegex();
    let match: RegExpExecArray | null;

    while ((match = controlRegex.exec(text)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;

      if (start <= offset && offset <= end) {
        const controlRecord = match[0];
        const fullControlRecord = getFullControlRecordName(controlRecord);

        const hoverInfo: MarkupContent = {
          kind: MarkupKind.Markdown,
          value: explainControlRecordHover(controlRecord, fullControlRecord)
        };

        return {
          contents: hoverInfo,
          range: {
            start: document.positionAt(start),
            end: document.positionAt(end)
          }
        };
      }
    }

    return null;
  }

  /**
   * Build hover content for parameter references by extracting definition text
   */
  private buildParameterHoverContent(
    definition: ParameterLocation,
    paramType: string,
    paramIndex: number,
    parameterLocations: ParameterLocation[],
    lines: string[]
  ): string {
    const definitionLine = lines[definition.line];

    if (!definitionLine) {
      return `**${paramType}(${paramIndex})**: Definition not found`;
    }

    // Extract the parameter value from the main range
    let parameterValue = '';
    if (definition.startChar !== undefined && definition.endChar !== undefined) {
      parameterValue = definitionLine.substring(definition.startChar, definition.endChar).trim();
    }

    // Check if this is a SAME keyword and resolve it back through the chain.
    if (parameterValue === 'SAME') {
      const resolved = this.resolveSameOrigin(paramType, paramIndex, parameterLocations, lines);
      if (resolved) {
        parameterValue = `${resolved.value} SAME as ${paramType}(${resolved.originalIndex})`;
      }
    }

    // Extract FIXED keywords from additional ranges
    const fixedKeywords: string[] = [];
    if (definition.additionalRanges) {
      for (const range of definition.additionalRanges) {
        if (range.line !== undefined && range.line !== definition.line) {
          // FIXED keyword is on a different line (BLOCK declaration line)
          const fixedLine = lines[range.line];
          if (fixedLine) {
            const fixedText = fixedLine.substring(range.startChar, range.endChar);
            fixedKeywords.push(fixedText);
          }
        } else {
          // FIXED keyword is on the same line as the value
          const fixedText = definitionLine.substring(range.startChar, range.endChar);
          fixedKeywords.push(fixedText);
        }
      }
    }

    // Build the hover content
    let content = `**${paramType}(${paramIndex})**`;

    if (parameterValue || fixedKeywords.length > 0) {
      const parts = [];
      if (parameterValue) {
        parts.push(parameterValue);
      }
      if (fixedKeywords.length > 0) {
        parts.push(...fixedKeywords);
      }
      content += `: ${parts.join(' ')}`;
    }

    return content;
  }

  /**
   * Walk SAME-chains backward to the closest declared value of the same type.
   * Returns `{value, originalIndex}` where `value` is the literal text of the
   * referenced declaration and `originalIndex` is its 1-based parameter index.
   * Returns null when no prior declared value exists (e.g. SAME with nothing
   * to anchor to).
   */
  private resolveSameOrigin(
    paramType: string,
    paramIndex: number,
    parameterLocations: ParameterLocation[],
    lines: string[],
  ): { value: string; originalIndex: number } | null {
    const sameTypeParams = parameterLocations.filter(
      loc => loc.type === paramType && loc.index < paramIndex,
    );
    const previousParam = sameTypeParams[sameTypeParams.length - 1];
    if (!previousParam) return null;

    const previousLine = lines[previousParam.line];
    if (
      !previousLine ||
      previousParam.startChar === undefined ||
      previousParam.endChar === undefined
    ) return null;

    const previousValue = previousLine.substring(previousParam.startChar, previousParam.endChar).trim();
    if (previousValue === 'SAME') {
      return this.resolveSameOrigin(paramType, previousParam.index, parameterLocations, lines);
    }
    return { value: previousValue, originalIndex: previousParam.index };
  }

  /**
   * Get hover information for reserved diagnostic items (PRED, CWRES, etc.)
   * available in $TABLE without user definition.
   */
  private getDiagnosticItemHover(text: string, offset: number): Hover | null {
    // Find the word surrounding the cursor.
    const wordStart = this.findWordStart(text, offset);
    const wordEnd = this.findWordEnd(text, offset);
    if (wordStart === wordEnd) return null;

    const word = text.substring(wordStart, wordEnd).toUpperCase();
    const description = reservedDiagnosticItems[word];
    if (!description) return null;

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** — ${description}\n\nReserved NONMEM diagnostic item. Available directly in \`$TABLE\` without definition in \`$PK\`/\`$PRED\`/\`$ERROR\`.`
      } as MarkupContent
    } as Hover;
  }

  private findWordStart(text: string, offset: number): number {
    let i = offset;
    while (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1] || '')) i--;
    return i;
  }

  private findWordEnd(text: string, offset: number): number {
    let i = offset;
    while (i < text.length && /[A-Za-z0-9_]/.test(text[i] || '')) i++;
    return i;
  }

  /**
   * Get hover information for reserved variables like ICALL, NEWIND, Y
   */
  private getReservedVariableHover(text: string, offset: number): Hover | null {
    // Check for reserved variables at the cursor position
    const reservedVariables = {
      'ICALL': 'Reserved variable - Execution context: 0=run init, 1=problem init, 2=analysis, 3=finalization, 4=simulation, 5=expectation, 6=data average',
      'NEWIND': 'Reserved variable - Individual record indicator: 0=first record, 1=new individual, 2=continuation record',
      'Y': 'Mandatory left-hand quantity for PRED - represents the predicted value or observation under the statistical model',
      'ERR': 'Reserved array - Alternative to ETA(n)/EPS(n) for random intra-individual effects'
    };

    // Find word boundaries around the offset
    const beforeOffset = Math.max(0, offset - 10);
    const afterOffset = Math.min(text.length, offset + 10);
    const searchText = text.substring(beforeOffset, afterOffset);

    for (const [variable, description] of Object.entries(reservedVariables)) {
      const regex = new RegExp(`\\b${variable}\\b`, 'i');
      const match = regex.exec(searchText);

      if (match) {
        const matchStart = beforeOffset + match.index;
        const matchEnd = matchStart + match[0].length;

        // Check if the cursor is within the match
        if (offset >= matchStart && offset <= matchEnd) {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: description
            } as MarkupContent
          } as Hover;
        }
      }
    }

    return null;
  }
}
