import { describe, it, expect } from 'vitest';
import { extractPriors } from '../services/priorScanner';

describe('extractPriors', () => {
  it('returns empty maps for a model with no $PRIOR records', () => {
    const r = extractPriors(['$PROBLEM x', '$THETA 1', '$OMEGA 0.1', '$SIGMA 1'].join('\n'));
    expect(r.thetaPriors.size).toBe(0);
    expect(r.thetaPriorVariances.size).toBe(0);
    expect(r.omegaPriors.size).toBe(0);
    expect(r.omegaPriorDfs.size).toBe(0);
  });

  it('parses scalar-form $THETAP / $THETAPV with FIX + comment', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '$THETAP  4.91 FIX ; 1  prior CLH',
        '$THETAP  69.5 FIX ; 2  prior V1',
        '$THETAPV 1.32E-01 FIX ; 1  prior CLH variance',
        '$THETAPV 4.64E+01 FIX ; 2  prior V1 variance',
      ].join('\n'),
    );
    expect(r.thetaPriors.get(1)).toMatchObject({ value: 4.91, fix: true, comment: '1  prior CLH' });
    expect(r.thetaPriors.get(2)).toMatchObject({ value: 69.5, fix: true });
    expect(r.thetaPriorVariances.get(1)?.value).toBeCloseTo(0.132, 3);
    expect(r.thetaPriorVariances.get(2)?.value).toBeCloseTo(46.4, 1);
  });

  it('parses $OMEGAP scalar + BLOCK forms, keeping diagonal elements only', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '$OMEGAP  0  FIX  ; 1 V2',
        '$OMEGAP  0.273  FIX  ; 2 Res err col',
        '$OMEGAP  BLOCK(3) FIX',
        ' 0.1',
        ' 0 0.2',
        ' 0 0 0.3',
      ].join('\n'),
    );
    expect(r.omegaPriors.get(1)?.value).toBe(0);
    expect(r.omegaPriors.get(2)?.value).toBeCloseTo(0.273, 3);
    expect(r.omegaPriors.get(3)?.value).toBeCloseTo(0.1, 3);
    expect(r.omegaPriors.get(4)?.value).toBeCloseTo(0.2, 3);
    expect(r.omegaPriors.get(5)?.value).toBeCloseTo(0.3, 3);
    expect(r.omegaPriors.size).toBe(5);
  });

  it('expands $OMEGAPD scalars across the block range of the matching $OMEGAP record', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '$OMEGAP  0.1  FIX  ; block 1 (1 element)',
        '$OMEGAP  BLOCK(2) FIX',
        ' 0.5',
        ' 0 0.6',
        '$OMEGAPD 3 FIX ; for block 1',
        '$OMEGAPD 5 FIX ; for block 2',
      ].join('\n'),
    );
    // Block 1 → OMEGA(1); df = 3.
    expect(r.omegaPriorDfs.get(1)?.value).toBe(3);
    // Block 2 → OMEGA(2), OMEGA(3); df = 5 for both.
    expect(r.omegaPriorDfs.get(2)?.value).toBe(5);
    expect(r.omegaPriorDfs.get(3)?.value).toBe(5);
    expect(r.omegaPriorDfs.size).toBe(3);
  });

  it('$SIGMAP / $SIGMAPD analogous to OMEGA priors', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '$SIGMAP 0.05 FIX ; res var',
        '$SIGMAPD 100 FIX ; high-confidence prior',
      ].join('\n'),
    );
    expect(r.sigmaPriors.get(1)?.value).toBeCloseTo(0.05, 3);
    expect(r.sigmaPriorDfs.get(1)?.value).toBe(100);
  });

  it('BLOCK(N) SAME without inline values advances the index counter without populating', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '$OMEGAP BLOCK(2) FIX',
        ' 0.1',
        ' 0 0.2',
        '$OMEGAP BLOCK(2) SAME',
        '$OMEGAPD 3 FIX',
        '$OMEGAPD 4 FIX',
      ].join('\n'),
    );
    // Block 1: OMEGA(1)=0.1, OMEGA(2)=0.2.
    expect(r.omegaPriors.get(1)?.value).toBeCloseTo(0.1, 3);
    expect(r.omegaPriors.get(2)?.value).toBeCloseTo(0.2, 3);
    // Block 2 (SAME): nothing populated, but the index advances so the
    // df expansion covers the right range.
    expect(r.omegaPriors.size).toBe(2);
    expect(r.omegaPriorDfs.get(1)?.value).toBe(3);
    expect(r.omegaPriorDfs.get(2)?.value).toBe(3);
    expect(r.omegaPriorDfs.get(3)?.value).toBe(4);
    expect(r.omegaPriorDfs.get(4)?.value).toBe(4);
  });

  it('ignores `;` comment lines and the contents of unrelated $RECORDS', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '; this is a comment',
        '$PK',
        'CL = THETA(1)',
        '$THETAP 1.0 FIX ; ok',
      ].join('\n'),
    );
    expect(r.thetaPriors.size).toBe(1);
    expect(r.thetaPriors.get(1)?.value).toBe(1.0);
  });

  it('parses multiple values on a single $THETAP record line (NM docs canonical form)', () => {
    // Per NM 7 $THETAP docs: `$THETAP (2.0 FIX) (2.0 FIX) (2.0 FIX) (2.0 FIX)` — 4 priors on one line.
    const r = extractPriors(
      ['$PROBLEM x', '$THETAP (2.0 FIX) (2.0 FIX) (2.0 FIX) (2.0 FIX) ; all 4'].join('\n'),
    );
    expect(r.thetaPriors.size).toBe(4);
    for (let i = 1; i <= 4; i++) {
      expect(r.thetaPriors.get(i)?.value).toBeCloseTo(2.0, 3);
      expect(r.thetaPriors.get(i)?.fix).toBe(true);
    }
    // Comment attaches to the last value (NM-TRAN `;` runs to EOL).
    expect(r.thetaPriors.get(4)?.comment).toBe('all 4');
    expect(r.thetaPriors.get(1)?.comment).toBeUndefined();
  });

  it('parses multiple $OMEGAPD scalars on one record line', () => {
    const r = extractPriors(
      [
        '$PROBLEM x',
        '$OMEGAP 0.1 FIX',
        '$OMEGAP 0.2 FIX',
        '$OMEGAP 0.3 FIX',
        '$OMEGAPD 3 5 10 FIX',
      ].join('\n'),
    );
    expect(r.omegaPriorDfs.get(1)?.value).toBe(3);
    expect(r.omegaPriorDfs.get(2)?.value).toBe(5);
    expect(r.omegaPriorDfs.get(3)?.value).toBe(10);
  });

  it('Pirana-style real-world model from positron-nonmem report (10 thetaPs + 10 thetaPVs + 5 omegaP blocks + 5 omegaPDs)', () => {
    const r = extractPriors(
      [
        '$PROBLEM colistin',
        '$THETAP  4.91 FIX ; 1 CLH',
        '$THETAP  69.5 FIX ; 2 V1',
        '$THETAP  4.10 FIX ; 3 CL',
        '$THETAP  1.4 FIX ; 4 V1CMS',
        '$THETAP  7.95 FIX ; 5 Q2CMS',
        '$THETAP  463 FIX ; 6 QCMS',
        '$THETAP  12.3 FIX ; 7 V2CMS',
        '$THETAP  0.597 FIX ; 8 CRCL',
        '$THETAP  6.63 FIX ; 9 CLfilt',
        '$THETAP  0.624 FIX ; 10 Vcol',
        '$THETAPV 0.132 FIX ; 1',
        '$THETAPV 46.4 FIX ; 2',
        '$THETAPV 0.284 FIX ; 3',
        '$THETAPV 0.0282 FIX ; 4',
        '$THETAPV 0.765 FIX ; 5',
        '$THETAPV 37815 FIX ; 6',
        '$THETAPV 0.600 FIX ; 7',
        '$THETAPV 0.00602 FIX ; 8',
        '$THETAPV 6.35 FIX ; 9',
        '$THETAPV 0.0623 FIX ; 10',
        '$OMEGAP 0 FIX ; 1 V2',
        '$OMEGAP 0.273 FIX ; 2 Res err col',
        '$OMEGAP BLOCK(13) FIX',
        ' 0.0676983 ; 3 IOVCL',
        ' 0 0.0676983',
        ' 0 0 0.0676983',
        ' 0 0 0 0.0676983',
        ' 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0 0 0 0 0 0.0676983',
        ' 0 0 0 0 0 0 0 0 0 0 0 0 0.0676983',
        '$OMEGAPD 3 FIX ; block 1 df',
        '$OMEGAPD 3 FIX ; block 2 df',
        '$OMEGAPD 3 FIX ; block 3 df',
      ].join('\n'),
    );
    expect(r.thetaPriors.size).toBe(10);
    expect(r.thetaPriorVariances.size).toBe(10);
    expect(r.omegaPriors.get(1)?.value).toBe(0);
    expect(r.omegaPriors.get(2)?.value).toBeCloseTo(0.273, 3);
    expect(r.omegaPriors.get(3)?.value).toBeCloseTo(0.0677, 4);
    expect(r.omegaPriors.get(15)?.value).toBeCloseTo(0.0677, 4); // last diagonal of BLOCK(13)
    expect(r.omegaPriors.size).toBe(15);
    // Df expansion: block 1 (single) → idx 1; block 2 (single) → idx 2;
    // block 3 (BLOCK(13)) → idx 3..15.
    expect(r.omegaPriorDfs.get(1)?.value).toBe(3);
    expect(r.omegaPriorDfs.get(2)?.value).toBe(3);
    expect(r.omegaPriorDfs.get(3)?.value).toBe(3);
    expect(r.omegaPriorDfs.get(15)?.value).toBe(3);
    expect(r.omegaPriorDfs.size).toBe(15);
  });
});
