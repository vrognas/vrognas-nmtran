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

  test('two bound pairs on one line: `$THETA (0, 0.1) (0, 10)` → THETA(1)=0.1, THETA(2)=10', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM bounds-pairs',
          '$DATA d',
          '$THETA (0, 0.1) (0, 10)',
          '$OMEGA 0.1',
          '$SIGMA 0.1',
        ].join('\n'),
      ),
    );
    expect(m.thetas).toEqual([
      { index: 1, init: 0.1, lower: 0, fix: false, line: 2 },
      { index: 2, init: 10, lower: 0, fix: false, line: 2 },
    ]);
  });

  test('inline `;<comment>` becomes the decl `comment` field (Pirana-style label)', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM labels',
          '$DATA d',
          '$THETA',
          '  4.79      ; CL',
          '  90.2      ; V',
          '  (0, 7.47) ; Q',
          '  105       ; V2',
          '$OMEGA',
          '  0.397     ; IIV CL',
          '  0.365     ; IIV V2',
          '$SIGMA',
          '  1450      ; PAdditive',
          '  0.00739   ; Proportional',
        ].join('\n'),
      ),
    );

    expect(m.thetas.map((t) => t.comment)).toEqual(['CL', 'V', 'Q', 'V2']);
    expect(m.omegas.map((o) => o.comment)).toEqual(['IIV CL', 'IIV V2']);
    expect(m.sigmas.map((s) => s.comment)).toEqual(['PAdditive', 'Proportional']);
  });

  test('decl with no inline `;` leaves `comment` undefined', () => {
    const m = buildParsedModel(
      doc(['$PROBLEM no-comment', '$DATA d', '$THETA 1.5', '$OMEGA 0.1', '$SIGMA 0.1'].join('\n')),
    );
    expect(m.thetas[0].comment).toBeUndefined();
    expect(m.omegas[0].comment).toBeUndefined();
    expect(m.sigmas[0].comment).toBeUndefined();
  });

  test('PsN runrecord `;;` lines are NOT picked up as parameter comments', () => {
    // The `;; Based on:` lives in $PROBLEM block, never as a parameter
    // suffix. Even if a malformed file had `;;` next to a decl, exclude it.
    const m = buildParsedModel(
      doc(['$PROBLEM rr', ';; Based on: 1', '$DATA d', '$THETA 1.5 ;; not a label', '$OMEGA 0.1', '$SIGMA 0.1'].join('\n')),
    );
    expect(m.thetas[0].comment).toBeUndefined();
  });

  test('multi-decl single-line: comment goes to the LAST decl (NM-TRAN `;` runs to EOL)', () => {
    // Per NM-TRAN spec a `;` consumes everything to EOL. With three values
    // on one line and one trailing `;`, the comment region only intersects
    // the last decl's range; earlier decls have no `;` between them and
    // the next decl, so they correctly resolve undefined.
    const m = buildParsedModel(
      doc(['$PROBLEM multi', '$DATA d', '$THETA 1 2 3 ;all three', '$OMEGA 0.1', '$SIGMA 0.1'].join('\n')),
    );
    expect(m.thetas.map((t) => t.comment)).toEqual([undefined, undefined, 'all three']);
  });

  test('$OMEGA BLOCK(n): Pirana-style `; <label>` on each row attaches to the diagonal (i,i)', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM block-labels',
          '$DATA d',
          '$OMEGA BLOCK(4)',
          '  0.1 ; A',
          '  0.05 0.1 ; B',
          '  0.05 0.05 0.1 ; C',
          '  0.05 0.05 0.05 0.1 ; D',
        ].join('\n'),
      ),
    );
    expect(m.omegas.map((o) => ({ i: o.index, c: o.comment }))).toEqual([
      { i: 1, c: 'A' },
      { i: 2, c: 'B' },
      { i: 3, c: 'C' },
      { i: 4, c: 'D' },
    ]);
  });

  // Reported via positron-nonmem 2026-05-12: in lst-mode, the Fit
  // Inspector was showing the WRONG parameter counts for the active
  // .lst — earlier files' counts were sticking. Root cause: the
  // `embedded://lst` URI + version=1 hard-coded by the
  // `nmtran/parseModelText` request handler collides in
  // `ParameterScanner.scanDocument`'s `${uri}:${version}` cache,
  // serving the first parse's locations for every subsequent embedded
  // text. Skip the cache for synthetic URIs.
  test('parseModelText path: distinct embedded contents return distinct decls (no cache collision)', () => {
    // beforeEach clears the cache; both calls hit the embedded path.
    const m1 = buildParsedModel(
      TextDocument.create('embedded://lst', 'nmtran', 1, [
        '$PROBLEM a',
        '$DATA d',
        '$THETA 1 ; A',
        '$THETA 2 ; B',
        '$OMEGA BLOCK(2) 0.1 0.05 0.2',
        '$SIGMA 1',
      ].join('\n')),
    );
    expect(m1.thetas.length).toBe(2);
    expect(m1.omegas.length).toBe(2);

    const m2 = buildParsedModel(
      TextDocument.create('embedded://lst', 'nmtran', 1, [
        '$PROBLEM b',
        '$DATA d',
        '$THETA 1 ; X',
        '$THETA 2 ; Y',
        '$THETA 3 ; Z',
        '$OMEGA 0 FIX',
      ].join('\n')),
    );
    // If the cache served m1's result, m2 would report 2 thetas. Real
    // count is 3.
    expect(m2.thetas.length).toBe(3);
    expect(m2.omegas.length).toBe(1);
    expect(m2.sigmas.length).toBe(0);
  });

  // Reported via positron-nonmem 2026-05-12: model has 7 active $THETA
  // lines, 1 $OMEGA, 0 $SIGMA. parser returned thetas=4 / omegas=4 /
  // sigmas=1. Commented `; $THETA (...)` lines between active decls
  // appear to break state.
  test('commented `; $THETA` between active $THETA lines does not stop further THETA counting', () => {
    const m = buildParsedModel(
      doc(
        [
          '$PROBLEM repro',
          '$DATA d',
          '$THETA  0.854 ; SHAPE',
          '$THETA  -2.145 ; SCALE',
          '$THETA  -1.315 ; SCALE_gamma',
          '$THETA  0.218 ; SOFA',
          '$THETA  0.021 ; AGE',
          '; $THETA  (-2.905) ; Loss',
          '; $THETA (0.115) ; charlson_total',
          '; $THETA (-0.511)    ;diuretics',
          '$THETA  -0.72 ; klebsiella_other vs acinetobacter_psudomonas',
          '; $THETA  (0.01) ; log(mic_colistin)',
          '; $THETA  (0.662) ; Failure',
          '$THETA  0.066 ; cavg_micc_120',
          '$OMEGA  0  FIX  ;   ETA_BASE',
        ].join('\n'),
      ),
    );
    expect(m.thetas.length).toBe(7);
    expect(m.thetas.map((t) => t.comment)).toEqual([
      'SHAPE',
      'SCALE',
      'SCALE_gamma',
      'SOFA',
      'AGE',
      'klebsiella_other vs acinetobacter_psudomonas',
      'cavg_micc_120',
    ]);
    expect(m.omegas.length).toBe(1);
    expect(m.omegas[0]).toMatchObject({ index: 1, value: 0, fix: true, comment: 'ETA_BASE' });
    expect(m.sigmas.length).toBe(0);
  });
});
