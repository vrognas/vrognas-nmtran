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
    expect(m.thetas).toEqual([{ index: 1, init: 1, fix: false, line: 4 }]);
    expect(m.omegas).toEqual([{ index: 1, value: 0.1, fix: false, line: 5 }]);
    expect(m.sigmas).toEqual([{ index: 1, value: 0.1, fix: false, line: 6 }]);
  });

  test('THETA / OMEGA / SIGMA decls carry their declaration line (used for goto-definition from Variables pane)', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM line tracking',
          '$DATA d',
          '$THETA',
          '  1.0     ; CL',
          '  2.0     ; V',
          '$OMEGA',
          '  0.1     ; PPV CL',
          '$SIGMA',
          '  0.05    ; res err',
        ].join('\n'),
      ),
    );

    expect(m.thetas.map((t) => t.line)).toEqual([3, 4]);
    expect(m.omegas.map((o) => o.line)).toEqual([6]);
    expect(m.sigmas.map((s) => s.line)).toEqual([8]);
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
      { index: 1, init: 1.5, lower: 0, upper: 10, fix: false, line: 2 },
      { index: 2, init: 2, fix: true, line: 3 },
      { index: 3, init: 3, lower: 0, fix: false, line: 4 },
    ]);
    expect(m.omegas).toEqual([{ index: 1, value: 0.1, fix: true, line: 5 }]);
    expect(m.sigmas).toEqual([{ index: 1, value: 0.2, fix: false, line: 6 }]);
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
    expect(byName.K.value).toBeCloseTo(Math.log(6), 8); // LOG = natural log per NONMEM
    expect(byName.COND.value).toBeUndefined(); // .GT. comparison not implemented
  });

  test('joins `&`-continuation lines into a single logical assignment', () => {
    // Pattern straight from real colistin-pk-model.mod $PK block.
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM cont',
          '$DATA d',
          '$PK',
          '  OCC1 = 0',
          '  OCC2 = 0',
          '  OCC3 = 0',
          '  IOVCL = OCC1*ETA(1) + OCC2*ETA(2) +&',
          '          OCC3*ETA(3)',
          '$THETA 1',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    const iovcl = m.equations.find((e) => e.name === 'IOVCL');
    expect(iovcl).toBeDefined();
    expect(iovcl!.rhs).toBe('OCC1*ETA(1) + OCC2*ETA(2) + OCC3*ETA(3)');
    // OCCn = 0, ETA(n) = 0 (typical individual) -> IOVCL = 0
    expect(iovcl!.value).toBe(0);
    // The line number should point at the first line of the multi-line statement.
    expect(iovcl!.line).toBe(6);
  });

  test('skips assignments inside IF/THEN ... ENDIF blocks (runtime-conditional)', () => {
    // Mirrors colistin-pk-model.mod's $ERROR block: F_FLAG = 0 unconditionally,
    // then F_FLAG = 1 inside `IF(...) THEN ... ENDIF`. Only the unconditional
    // assignment should land in equations[].
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM cond',
          '$DATA d',
          '$ERROR',
          '  F_FLAG = 0',
          '  IF(BLOQ.EQ.1.OR.BMS.EQ.1) THEN',
          '    F_FLAG = 1',
          '    IWRES = 0',
          '  ENDIF',
          '  Y = 1',
          '$THETA 1',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    const names = m.equations.map((e) => e.name);
    expect(names).toEqual(['F_FLAG', 'Y']);
    const byName = Object.fromEntries(m.equations.map((e) => [e.name, e.value]));
    expect(byName.F_FLAG).toBe(0);
    expect(byName.Y).toBe(1);
  });

  test('OMEGA BLOCK(n) SAME inherits the value of the previous BLOCK declaration', () => {
    // User reported OMEGA(4,4) showing as null in the Variables pane — SAME
    // lines have a non-numeric token where parameterScanner records the
    // location, so parseFloat returns NaN. NONMEM semantics: BLOCK(n) SAME
    // inherits from the most recent BLOCK(n). Multi-line SAME stacks all
    // inherit the same anchor value.
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM iov',
          '$DATA d',
          '$OMEGA  0  FIX  ; 1',
          '$OMEGA  0.260981  ; 2',
          '$OMEGA  BLOCK(1)',
          '  0.0676983  ; 3',
          '$OMEGA  BLOCK(1) SAME',
          '$OMEGA  BLOCK(1) SAME',
          '$OMEGA  BLOCK(1) SAME',
          '$THETA 1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    const values = m.omegas.map((o) => o.value);
    expect(values).toEqual([0, 0.260981, 0.0676983, 0.0676983, 0.0676983, 0.0676983]);
    // Indices preserved — parameterScanner already numbers them sequentially.
    expect(m.omegas.map((o) => o.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('SIGMA BLOCK(n) SAME inherits analogously', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM sigma-same',
          '$DATA d',
          '$SIGMA  BLOCK(1)',
          '  0.05',
          '$SIGMA  BLOCK(1) SAME',
          '$THETA 1',
          '$OMEGA 0.1',
        ].join('\n'),
      ),
    );

    expect(m.sigmas.map((s) => s.value)).toEqual([0.05, 0.05]);
  });

  test('evaluator handles common NONMEM intrinsics (LOG / EXP / SQRT / MIN / MAX)', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM intrinsics',
          '$DATA d',
          '$PK',
          '  BCMS = LOG(0.120*1000/1628)',
          '  E = EXP(0)',
          '  S = SQRT(9)',
          '  LO = LOG10(100)',
          '  MN = MIN(5, 3, 8)',
          '  MX = MAX(5, 3, 8)',
          '  AB = ABS(-7)',
          '$THETA 1',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );

    const byName = Object.fromEntries(m.equations.map((e) => [e.name, e.value]));
    expect(byName.BCMS).toBeCloseTo(Math.log(0.12 * 1000 / 1628), 8);
    expect(byName.E).toBe(1);
    expect(byName.S).toBe(3);
    expect(byName.LO).toBe(2);
    expect(byName.MN).toBe(3);
    expect(byName.MX).toBe(8);
    expect(byName.AB).toBe(7);
  });
});
