/**
 * Completion Service
 * 
 * Provides intelligent code completion for NMTRAN control records and parameters.
 * Modern LSP feature for improved developer experience.
 */

import { Connection, CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { allowedControlRecords, reservedDiagnosticItems } from '../constants';
import { getFullControlRecordName } from '../utils/validateControlRecords';
import { splitLines } from '../utils/text';

export class CompletionService {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Provides completion items at the given position
   */
  provideCompletions(document: TextDocument, position: { line: number; character: number }): CompletionItem[] {
    try {
      const text = document.getText();
      const lines = splitLines(text);
      const line = lines[position.line] || '';
      const linePrefix = line.substring(0, position.character);

      // Complete control records when user types $
      if (linePrefix.endsWith('$') || linePrefix.match(/\$[A-Z]*$/)) {
        return this.getControlRecordCompletions();
      }

      const currentWord = this.getCurrentWord(linePrefix);

      // Inside $TABLE: suggest reserved diagnostic items
      if (this.isInTableBlock(lines, position.line)) {
        return this.getDiagnosticItemCompletions(currentWord);
      }

      // Complete common NMTRAN parameters
      if (currentWord.length > 0) {
        return this.getParameterCompletions(currentWord);
      }

      return [];

    } catch (error) {
      this.connection.console.error(`❌ Error providing completions: ${error}`);
      return [];
    }
  }

  /**
   * Gets completion items for control records
   */
  private getControlRecordCompletions(): CompletionItem[] {
    return allowedControlRecords.map(record => ({
      label: record,
      kind: CompletionItemKind.Keyword,
      detail: 'NMTRAN Control Record',
      documentation: `Insert ${record} control record`,
      insertText: record,
      sortText: record
    }));
  }

  /**
   * Gets completion items for common parameters
   */
  private getParameterCompletions(prefix: string): CompletionItem[] {
    const commonParams = [
      { name: 'METHOD', detail: 'Estimation method', snippet: 'METHOD=${1:1}' },
      { name: 'MAXEVAL', detail: 'Maximum evaluations', snippet: 'MAXEVAL=${1:9999}' },
      { name: 'PRINT', detail: 'Print level', snippet: 'PRINT=${1:1}' },
      { name: 'POSTHOC', detail: 'Post-hoc estimation', snippet: 'POSTHOC' },
      { name: 'LAPLACE', detail: 'Laplace method', snippet: 'LAPLACE' },
      { name: 'INTERACTION', detail: 'Interaction', snippet: 'INTERACTION' },
      { name: 'NOABORT', detail: 'No abort on error', snippet: 'NOABORT' }
    ];

    return commonParams
      .filter(param => param.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(param => ({
        label: param.name,
        kind: CompletionItemKind.Property,
        detail: param.detail,
        insertText: param.snippet,
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: param.name
      }));
  }

  /**
   * Extracts the current word being typed
   */
  private getCurrentWord(linePrefix: string): string {
    const match = linePrefix.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    return match ? match[0] : '';
  }

  /**
   * Is the cursor inside a $TABLE block? Scans backward for the nearest $RECORD keyword.
   */
  private isInTableBlock(lines: string[], currentLine: number): boolean {
    for (let i = currentLine; i >= 0; i--) {
      const trimmed = (lines[i] || '').trim();
      if (trimmed.startsWith(';')) continue;
      const m = trimmed.match(/^\$(\w+)/);
      if (m) {
        const full = getFullControlRecordName('$' + m[1]!);
        return full === '$TABLE';
      }
    }
    return false;
  }

  /**
   * Completion items for the 43 reserved NONMEM diagnostic items.
   */
  private getDiagnosticItemCompletions(prefix: string): CompletionItem[] {
    const lcPrefix = prefix.toLowerCase();
    return Object.entries(reservedDiagnosticItems)
      .filter(([name]) => name.toLowerCase().startsWith(lcPrefix))
      .map(([name, description]) => ({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: 'NONMEM diagnostic item',
        documentation: description,
        insertText: name,
        sortText: name
      }));
  }
}
