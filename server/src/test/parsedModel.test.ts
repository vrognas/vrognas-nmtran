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

  test('extracts top-level assignments inside abbreviated-code blocks ($PRED / $PK / $ERROR)', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM eqs',
          '$DATA d',
          '$INPUT ID DV',
          '$PRED',
          '  Y = THETA(1) + ETA(1) + EPS(1)  ; main',
          '$PK',
          '  CL = THETA(2)',
          '  DX = 1',
          '$ERROR',
          '  IPRED = F',
          '$THETA 1 1.5',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    // ETA(n) and EPS(n) are random with mean 0 — the typical-individual
    // prediction substitutes 0 for both. So Y = THETA(1) + 0 + 0 = 1.
    expect(m.equations).toEqual([
      { name: 'Y', rhs: 'THETA(1) + ETA(1) + EPS(1)', block: '$PRED', line: 4, value: 1 },
      { name: 'CL', rhs: 'THETA(2)', block: '$PK', line: 6, value: 1.5 },
      { name: 'DX', rhs: '1', block: '$PK', line: 7, value: 1 },
      { name: 'IPRED', rhs: 'F', block: '$ERROR', line: 9, value: undefined },
    ]);
  });

  test('CRLF line endings: $INPUT and $DATA still extract correctly', () => {
    // Real Windows-saved .mod files are CRLF. The regex `(.*)$` without the
    // `m` flag won't match if the line ends with \r — caught a regression
    // where extractInputColumns silently returned [].
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM crlf',
          '$INPUT ID TIME DV',
          '$DATA d.csv IGNORE=@',
          '$THETA 1',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\r\n'),
      ),
    );
    expect(m.dataFile).toBe('d.csv');
    expect(m.inputColumns).toEqual(['ID', 'TIME', 'DV']);
  });

  test('handles inline-after-record assignments ($PRED Y = ... on the same line)', () => {
    // Mirrors the user's actual minimal probe — the $PRED token and the Y
    // assignment share a single line. Earlier extractor missed this because
    // it treated the line as record-only and continued.
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM inline',
          '$INPUT ID TIME DV',
          '$DATA d.csv IGNORE=@',
          '$PRED Y = THETA(1) + ETA(1) + EPS(1)',
          '$THETA 1',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    expect(m.inputColumns).toEqual(['ID', 'TIME', 'DV']);
    expect(m.equations).toEqual([
      { name: 'Y', rhs: 'THETA(1) + ETA(1) + EPS(1)', block: '$PRED', line: 3, value: 1 },
    ]);
  });

  test('evaluator resolves cross-equation references and returns undefined for unsupported syntax', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM chained',
          '$DATA d',
          '$PK',
          '  CL = THETA(1) * 2',
          '  V = CL + 1',
          '  K = LOG(CL)',
          '  COND = (CL.GT.0)',
          '$THETA 3',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    const byName = Object.fromEntries(m.equations.map((e) => [e.name, e]));
    expect(byName.CL.value).toBe(6);
    expect(byName.V.value).toBe(7);
    expect(byName.K.value).toBeUndefined(); // LOG(...) not implemented
    expect(byName.COND.value).toBeUndefined(); // .GT. not implemented
  });
});
