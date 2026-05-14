/**
 * BLOCK(1) highlighting through the public DefinitionService API.
 *
 * Pins the case where `$OMEGA BLOCK(1)` values with various spacing
 * patterns must resolve `provideDefinition` to the numeric value range.
 */

import { DefinitionService } from '../services/definitionService';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { createMockConnection, asMockConnection, MockConnection } from './mocks/mockConnection';
import { ParameterScanner } from '../services/parameterScanner';

describe('BLOCK(1) Highlighting', () => {
  let mockConnection: MockConnection;
  let definitionService: DefinitionService;

  beforeEach(() => {
    ParameterScanner.clearCache();
    mockConnection = createMockConnection();
    definitionService = new DefinitionService(asMockConnection(mockConnection));
  });

  function highlightedSubstring(line: string, content: string, cursor: Position): Promise<string | null> {
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    return definitionService.provideDefinition(doc, cursor).then(def => {
      if (!def || def.length === 0) return null;
      const r = def[0]!.range;
      return line.substring(r.start.character, r.end.character);
    });
  }

  it('BLOCK(1) with normal spacing highlights the value', async () => {
    const line = '$OMEGA  BLOCK(1) 3.0           ; IIV KA';
    const text = await highlightedSubstring(line, line, Position.create(0, 18));
    expect(text).toBe('3.0');
  });

  it('BLOCK(1) with extra spaces before comment highlights the value', async () => {
    const line = '$OMEGA  BLOCK(1) 0.0165           ; IOV CL';
    const text = await highlightedSubstring(line, line, Position.create(0, 20));
    expect(text).toBe('0.0165');
  });

  it('BLOCK(1) with double space after BLOCK(1) highlights the value', async () => {
    const line = '$OMEGA  BLOCK(1)  0.495           ; IOV KA';
    const text = await highlightedSubstring(line, line, Position.create(0, 20));
    expect(text).toBe('0.495');
  });
});
