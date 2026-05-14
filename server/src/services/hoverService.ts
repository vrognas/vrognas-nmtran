/**
 * Hover Service
 *
 * Handles hover information for NMTRAN control records.
 * Separated from main server for better maintainability.
 */

import { Connection, Hover, MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { splitLines, findWordStart, findWordEnd } from '../utils/text';
import { explainControlRecordHover } from '../hoverInfo';
import { getFullControlRecordName } from '../utils/validateControlRecords';
import { ParameterScanner, ParameterLocation } from './parameterScanner';
import { reservedDiagnosticItems, reservedVariables } from '../constants';
import { resolveErrBinding } from '../utils/errBinding';
import { createParameterReferenceRegex, createControlRecordRegex } from '../utils/patterns';

export class HoverService {
  // Connection no longer used internally — errors propagate to server.ts wrapper.
  // Constructor retained so the wiring in server.ts stays uniform across services.
  constructor(_connection: Connection) {}

  /**
   * Provides hover information for control records and parameter references at the given position
   */
  provideHover(document: TextDocument, position: { line: number; character: number }): Hover | null {
    // Errors propagate to server.ts withDoc wrapper, which logs uniformly.
    const text = document.getText();
    const offset = document.offsetAt(position);
    const lines = splitLines(text);
    const parameterLocations = ParameterScanner.scanDocument(document);

    const parameterHover = this.getParameterReferenceHover(document, position, offset, parameterLocations, lines);
    if (parameterHover) return parameterHover;

    const reservedVariableHover = this.getReservedVariableHover(text, offset);
    if (reservedVariableHover) return reservedVariableHover;

    const diagnosticItemHover = this.getDiagnosticItemHover(text, offset);
    if (diagnosticItemHover) return diagnosticItemHover;

    return this.getControlRecordHover(text, offset, document);
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
    const paramRegex = createParameterReferenceRegex();
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
    const controlRegex = createControlRecordRegex();
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
    const wordStart = findWordStart(text, offset);
    const wordEnd = findWordEnd(text, offset);
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

  /**
   * Get hover information for reserved variables like ICALL, NEWIND, Y.
   * Looks up the word under the cursor in the shared `reservedVariables` map.
   */
  private getReservedVariableHover(text: string, offset: number): Hover | null {
    const wordStart = findWordStart(text, offset);
    const wordEnd = findWordEnd(text, offset);
    if (wordStart === wordEnd) return null;

    const word = text.substring(wordStart, wordEnd).toUpperCase();
    const description = reservedVariables[word];
    if (!description) return null;

    return {
      contents: { kind: MarkupKind.Markdown, value: description } as MarkupContent,
    } as Hover;
  }
}
