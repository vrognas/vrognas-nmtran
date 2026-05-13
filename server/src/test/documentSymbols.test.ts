import { buildDocumentSymbols } from '../services/documentSymbols';
import { SymbolKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParameterScanner } from '../services/ParameterScanner';

function createTestDocument(content: string): TextDocument {
  return TextDocument.create('test://test.mod', 'nmtran', 1, content);
}

describe('Document Symbols', () => {

  test('returns DocumentSymbol array with correct names and uniform kind', () => {
    const doc = createTestDocument(
      '$PROBLEM Test Model\n$THETA (0,1)\n$ESTIMATION METHOD=1'
    );
    const symbols = buildDocumentSymbols(doc);

    expect(symbols).toHaveLength(3);
    expect(symbols[0].name).toBe('$PROBLEM');
    expect(symbols[1].name).toBe('$THETA');
    expect(symbols[2].name).toBe('$ESTIMATION');
    symbols.forEach(s => expect(s.kind).toBe(SymbolKind.Module));
  });

  test('full-block ranges span between control records', () => {
    const doc = createTestDocument(
      '$PROBLEM Test\n$PK\nCL = THETA(1)\nV = THETA(2)\n$ESTIMATION METHOD=1'
    );
    const symbols = buildDocumentSymbols(doc);

    // $PROBLEM: line 0 only (next record starts line 1)
    expect(symbols[0].range.start.line).toBe(0);
    expect(symbols[0].range.end.line).toBe(0);
    // selectionRange covers just "$PROBLEM"
    expect(symbols[0].selectionRange.start.character).toBe(0);
    expect(symbols[0].selectionRange.end.character).toBe('$PROBLEM'.length);

    // $PK: lines 1-3 (next record starts line 4)
    expect(symbols[1].range.start.line).toBe(1);
    expect(symbols[1].range.end.line).toBe(3);

    // $ESTIMATION: line 4 to EOF (line 4)
    expect(symbols[2].range.start.line).toBe(4);
    expect(symbols[2].range.end.line).toBe(4);
  });

  test('detail text extracted from content after keyword', () => {
    const doc = createTestDocument(
      '$PROBLEM PK Analysis\n$DATA file.csv IGNORE=@\n$ESTIMATION METHOD=COND INTER\n$THETA (0,1) ;CL'
    );
    const symbols = buildDocumentSymbols(doc);

    expect(symbols[0].detail).toBe('PK Analysis');
    expect(symbols[1].detail).toBe('file.csv IGNORE=@');
    expect(symbols[2].detail).toBe('METHOD=COND INTER');
    expect(symbols[3].detail).toBe('(0,1)');
  });

  test('THETA children nested under control record', () => {
    const doc = createTestDocument(
      '$THETA (0,1) ;CL\n$THETA (0,10) ;V\n$ESTIMATION METHOD=1'
    );
    ParameterScanner.clearCache();
    const params = ParameterScanner.scanDocument(doc);
    const symbols = buildDocumentSymbols(doc, params);

    expect(symbols[0].children).toHaveLength(1);
    expect(symbols[0].children![0].name).toBe('THETA(1)');
    expect(symbols[0].children![0].detail).toBe('CL');
    expect(symbols[0].children![0].kind).toBe(SymbolKind.Variable);

    expect(symbols[1].children).toHaveLength(1);
    expect(symbols[1].children![0].name).toBe('THETA(2)');
    expect(symbols[1].children![0].detail).toBe('V');
  });

  test('OMEGA BLOCK children and SIGMA children', () => {
    const doc = createTestDocument(
      '$OMEGA BLOCK(2) .3 .1 .3 ;IIV\n$SIGMA 1 FIX'
    );
    ParameterScanner.clearCache();
    const params = ParameterScanner.scanDocument(doc);
    const symbols = buildDocumentSymbols(doc, params);

    expect(symbols[0].children).toHaveLength(2);
    expect(symbols[0].children![0].name).toBe('ETA(1)');
    expect(symbols[0].children![1].name).toBe('ETA(2)');

    expect(symbols[1].children).toHaveLength(1);
    expect(symbols[1].children![0].name).toBe('EPS(1)');
  });

  test('no children when parameter locations not provided', () => {
    const doc = createTestDocument('$THETA (0,1)\n$OMEGA .1');
    const symbols = buildDocumentSymbols(doc);

    symbols.forEach(s => expect(s.children).toBeUndefined());
  });
});
