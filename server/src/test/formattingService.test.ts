/**
 * FormattingService coverage — indentation, IF/THEN nesting, operator spacing.
 *
 * The service had no tests; these are minimal end-to-end checks against
 * the public `formatDocument` API. Each test applies the returned edits
 * to the source and compares the result.
 */

import { FormattingService } from '../services/formattingService';
import { createDocument } from './test-helpers';
import { createMockConnection, asMockConnection } from './mocks/mockConnection';
import type { TextEdit } from 'vscode-languageserver/node';

/** Apply line-replacement edits in reverse order (avoids offset drift). */
function applyEdits(source: string, edits: TextEdit[]): string {
  const lines = source.split('\n');
  const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line);
  for (const edit of sorted) {
    lines[edit.range.start.line] = edit.newText;
  }
  return lines.join('\n');
}

describe('FormattingService', () => {
  const service = new FormattingService(asMockConnection(createMockConnection()));

  it('places control records at column 0, indents block contents', () => {
    const source = ['$PK', '  CL = THETA(1)', '$ERROR', '   Y = F + EPS(1)'].join('\n');
    const doc = createDocument(source);
    const result = applyEdits(source, service.formatDocument(doc, 2));

    const lines = result.split('\n');
    expect(lines[0]).toBe('$PK');
    expect(lines[1]?.startsWith('  ')).toBe(true);
    expect(lines[2]).toBe('$ERROR');
    expect(lines[3]?.startsWith('  ')).toBe(true);
  });

  it('increases indent inside IF/THEN, decreases at ENDIF', () => {
    const source = ['$PK', 'IF (TIME.GT.0) THEN', 'CL = THETA(1)', 'ENDIF', 'V = THETA(2)'].join(
      '\n',
    );
    const doc = createDocument(source);
    const result = applyEdits(source, service.formatDocument(doc, 2));

    const lines = result.split('\n');
    // Base indent inside $PK is 2 spaces; IF body adds another 2.
    expect(lines[1]).toBe('  IF (TIME .GT. 0) THEN');
    expect(lines[2]).toBe('    CL = THETA(1)');
    // ENDIF de-indents back to base.
    expect(lines[3]).toBe('  ENDIF');
    expect(lines[4]).toBe('  V = THETA(2)');
  });

  it('preserves scientific notation when spacing operators', () => {
    // `1E-2` must stay glued — formatMinusOperator's first regex protects it
    // before the binary-minus pass would otherwise split it.
    const source = ['$PK', 'CL=THETA(1)*1.5E-2'].join('\n');
    const doc = createDocument(source);
    const result = applyEdits(source, service.formatDocument(doc, 2));

    expect(result.split('\n')[1]).toBe('  CL = THETA(1) * 1.5E-2');
  });
});
