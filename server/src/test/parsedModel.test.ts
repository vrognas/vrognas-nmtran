import { describe, test, expect, beforeEach } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParameterScanner } from '../services/ParameterScanner';
import { buildParsedModel } from '../services/parsedModelService';

function doc(content: string): TextDocument {
  return TextDocument.create('test://test.mod', 'nmtran', 1, content);
}

describe('buildParsedModel', () => {
  beforeEach(() => {
    ParameterScanner.clearCache();
  });

  test('minimal model: extracts thetas, omegas, sigmas, dataFile, inputColumns', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM minimal probe',
          '$INPUT ID TIME DV',
          '$DATA d.csv IGNORE=@',
          '$PRED Y = THETA(1) + ETA(1) + EPS(1)',
          '$THETA 1',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
          '$ESTIMATION MAXEVAL=0',
        ].join('\n'),
      ),
    );

    expect(m.dataFile).toBe('d.csv');
    expect(m.inputColumns).toEqual(['ID', 'TIME', 'DV']);
    expect(m.thetas).toEqual([{ index: 1, init: 1, fix: false }]);
    expect(m.omegas).toEqual([{ index: 1, value: 0.1, fix: false }]);
    expect(m.sigmas).toEqual([{ index: 1, value: 0.1, fix: false }]);
  });

  test('THETA bound triples and FIX flags parse correctly', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM bounds',
          '$DATA d',
          '$THETA (0, 1.5, 10)',
          '$THETA 2 FIX',
          '$THETA (0, 3)',
          '$OMEGA 0.1 FIX',
          '$SIGMA 0.2',
        ].join('\n'),
      ),
    );

    expect(m.thetas).toEqual([
      { index: 1, init: 1.5, lower: 0, upper: 10, fix: false },
      { index: 2, init: 2, fix: true },
      { index: 3, init: 3, lower: 0, fix: false },
    ]);
    expect(m.omegas).toEqual([{ index: 1, value: 0.1, fix: true }]);
    expect(m.sigmas).toEqual([{ index: 1, value: 0.2, fix: false }]);
  });

  test('returns null dataFile when no $DATA record present (read-only inspection)', () => {
    const m = buildParsedModel(
      doc(['$PROBLEM no-data', '$THETA 1', '$OMEGA 0.1', '$SIGMA 0.1'].join('\n')),
    );

    expect(m.dataFile).toBeNull();
    expect(m.inputColumns).toEqual([]);
    expect(m.thetas).toHaveLength(1);
  });
});
