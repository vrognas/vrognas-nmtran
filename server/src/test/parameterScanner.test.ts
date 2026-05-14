import { ParameterScanner } from '../services/parameterScanner';
import { validateSequentialNumbering } from '../validators/sequentialNumbering';
import { validateParameterReferences } from '../validators/parameterReferences';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Test the exact scenario from moxonidine.mod
const testContent = `$OMEGA  BLOCK(2) 0.0444 0.027 0.0241    ; IIV (CL-V)

$OMEGA  BLOCK(2) 0.1 0.027 0.04    ; IIV (CL-V)

$OMEGA  BLOCK(1) 0.0165           ; IOV CL
$OMEGA  BLOCK(1)  SAME         ; IOV CL

$OMEGA  BLOCK(1)  0.495           ; IOV KA`;

describe('ParameterScanner BLOCK Matrix Tests', () => {
  let document: TextDocument;

  beforeEach(() => {
    ParameterScanner.clearCache();
    document = TextDocument.create('test://test.mod', 'nmtran', 1, testContent);
  });

  test('should correctly identify all ETA parameters', () => {
    const locations = ParameterScanner.scanDocument(document);
    
    // Should find 7 ETA parameters
    const etaLocations = locations.filter(loc => loc.type === 'ETA');
    expect(etaLocations).toHaveLength(7);
    
    // Check each ETA parameter
    expect(etaLocations[0]).toEqual(expect.objectContaining({ type: 'ETA', index: 1, line: 0 }));
    expect(etaLocations[1]).toEqual(expect.objectContaining({ type: 'ETA', index: 2, line: 0 }));
    expect(etaLocations[2]).toEqual(expect.objectContaining({ type: 'ETA', index: 3, line: 2 }));
    expect(etaLocations[3]).toEqual(expect.objectContaining({ type: 'ETA', index: 4, line: 2 }));
    expect(etaLocations[4]).toEqual(expect.objectContaining({ type: 'ETA', index: 5, line: 4 }));
    expect(etaLocations[5]).toEqual(expect.objectContaining({ type: 'ETA', index: 6, line: 5 }));
    expect(etaLocations[6]).toEqual(expect.objectContaining({ type: 'ETA', index: 7, line: 7 }));
  });

  test('should find correct positions for numeric values', () => {
    const locations = ParameterScanner.scanDocument(document);
    const etaLocations = locations.filter(loc => loc.type === 'ETA');
    
    // ETA(1) should highlight "0.0444" at line 0
    const eta1 = etaLocations.find(loc => loc.index === 1);
    expect(eta1?.startChar).toBeDefined();
    expect(eta1?.endChar).toBeDefined();
    
    // ETA(3) should highlight "0.1" at line 2  
    const eta3 = etaLocations.find(loc => loc.index === 3);
    expect(eta3?.startChar).toBeDefined();
    expect(eta3?.endChar).toBeDefined();
    
    // ETA(5) should highlight "0.0165" at line 4
    const eta5 = etaLocations.find(loc => loc.index === 5);
    expect(eta5?.startChar).toBeDefined(); 
    expect(eta5?.endChar).toBeDefined();
  });

  test('BLOCK row with repeated 0 off-diagonals reports correct diagonal position', () => {
    // Regression pin: previously processLine used cleanLine.lastIndexOf(prevValue)
    // + cleanLine.indexOf(value, ...) to anchor each numeric. On rows like
    // `0 0.0676983`, lastIndexOf('0') finds the '0' inside '0.0676983', not
    // the standalone '0' — subsequent indexOf returns -1, the diagonal gets
    // no startChar/endChar, hover and F12 underline nothing.
    const content = ['$OMEGA BLOCK(2)', ' 0.0676983', ' 0 0.0676983'].join('\n');
    const document = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const locations = ParameterScanner.scanDocument(document);

    const etas = locations.filter(l => l.type === 'ETA');
    expect(etas).toHaveLength(2);

    const line2 = ' 0 0.0676983';
    const eta2 = etas[1]!;
    expect(eta2.line).toBe(2);
    // ETA(2) is the diagonal at flat position 2 — the second numeric on
    // line 2, which is `0.0676983` starting at char 3.
    const slice = line2.substring(eta2.startChar ?? -1, eta2.endChar ?? -1);
    expect(slice).toBe('0.0676983');
  });

  test('multi-value diagonal OMEGA assigns distinct positions to each ETA', () => {
    // Regression pin: previously every ETA on `$OMEGA 0.1 0.2 0.3` got the
    // position of the first value (0.1) — findParameterValuePosition ignored
    // the per-iteration index and returned the first numeric every time.
    const content = '$OMEGA 0.1 0.2 0.3';
    const document = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const locations = ParameterScanner.scanDocument(document);

    const etas = locations.filter(l => l.type === 'ETA');
    expect(etas).toHaveLength(3);

    const slice = (loc: typeof etas[number]) =>
      content.substring(loc.startChar ?? -1, loc.endChar ?? -1);
    expect(slice(etas[0]!)).toBe('0.1');
    expect(slice(etas[1]!)).toBe('0.2');
    expect(slice(etas[2]!)).toBe('0.3');
  });

  test('should handle complex THETA line with FIXED keywords', () => {
    const content = `$THETA  (0,3) 2 FIXED (0,.6,1) 10 (-INF,-2.7,0) (37 FIXED) 4 FIX`;
    const document = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    
    const locations = ParameterScanner.scanDocument(document);
    const thetaLocations = locations.filter(loc => loc.type === 'THETA');
    
    // Should find 7 THETA parameters
    expect(thetaLocations).toHaveLength(7);
    
    // THETA(2) should have additionalRanges for FIXED keyword
    const theta2 = thetaLocations.find(loc => loc.index === 2);
    expect(theta2).toBeDefined();
    expect(theta2?.additionalRanges).toBeDefined();
    
    // THETA(6) should have additionalRanges for FIXED keyword inside parentheses
    const theta6 = thetaLocations.find(loc => loc.index === 6);
    expect(theta6).toBeDefined();
    expect(theta6?.additionalRanges).toBeDefined();
    
    // THETA(7) should have additionalRanges for FIX keyword
    const theta7 = thetaLocations.find(loc => loc.index === 7);
    expect(theta7).toBeDefined();
    expect(theta7?.additionalRanges).toBeDefined();
  });

  test('should validate sequential parameter numbering', () => {
    // Test valid sequential parameters
    const validContent = `$THETA  1 2 3
$OMEGA  0.1 0.2  
$SIGMA  0.01`;
    const validDocument = TextDocument.create('test://test.mod', 'nmtran', 1, validContent);
    const validLocations = ParameterScanner.scanDocument(validDocument);
    
    const validResult = validateSequentialNumbering(validLocations);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors).toHaveLength(0);
    
    // Test with manually created parameters that have gaps
    const parametersWithGaps = [
      { type: 'THETA' as const, index: 1, line: 0 },
      { type: 'THETA' as const, index: 2, line: 0 },
      { type: 'THETA' as const, index: 4, line: 0 }, // Missing THETA(3)
      { type: 'ETA' as const, index: 1, line: 1 },
      { type: 'ETA' as const, index: 3, line: 1 },   // Missing ETA(2)
      { type: 'EPS' as const, index: 2, line: 2 },   // Missing EPS(1)
    ];
    
    const invalidResult = validateSequentialNumbering(parametersWithGaps);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors).toContain('Missing THETA(3) - parameters must be sequential with no gaps');
    expect(invalidResult.errors).toContain('Missing ETA(2) - parameters must be sequential with no gaps');
    expect(invalidResult.errors).toContain('Missing EPS(1) - parameters must be sequential with no gaps');
  });

  test('should validate parameter references against definitions', () => {
    // Test valid references
    const validContent = `$THETA  1.5 2.0
$OMEGA  0.1
$SIGMA  0.01
$PK
CL = THETA(1) * EXP(ETA(1))
V = THETA(2)
Y = F + F * EPS(1)`;
    const validDocument = TextDocument.create('test://test.mod', 'nmtran', 1, validContent);
    
    const validResult = validateParameterReferences(validDocument);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    // Test invalid references (references to undefined parameters)
    const invalidContent = `$THETA  1.5
$OMEGA  0.1  
$PK
CL = THETA(1) * EXP(ETA(1))
V = THETA(15)  ; Invalid - only 1 THETA defined
KA = THETA(3) * EXP(ETA(5))  ; Invalid - only 1 ETA defined
Y = F + F * EPS(2)  ; Invalid - no EPS defined`;
    const invalidDocument = TextDocument.create('test://test-invalid.mod', 'nmtran', 1, invalidContent);

    const invalidResult = validateParameterReferences(invalidDocument);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors).toHaveLength(4);
    
    // Check error messages and positions
    const theta15Error = invalidResult.errors.find(e => e.message.includes('THETA(15)'));
    expect(theta15Error).toBeDefined();
    expect(theta15Error?.message).toBe('THETA(15) referenced but only 1 THETA parameters defined');
    expect(theta15Error?.line).toBe(4); // 0-indexed line 4 = line 5 in editor
    
    const theta3Error = invalidResult.errors.find(e => e.message.includes('THETA(3)'));
    expect(theta3Error).toBeDefined();
    expect(theta3Error?.line).toBe(5);
    
    const eta5Error = invalidResult.errors.find(e => e.message.includes('ETA(5)'));
    expect(eta5Error).toBeDefined();
    expect(eta5Error?.line).toBe(5);
    
    const eps2Error = invalidResult.errors.find(e => e.message.includes('EPS(2)'));
    expect(eps2Error).toBeDefined();
    expect(eps2Error?.line).toBe(6);
  });

  test('should detect unused parameter definitions', () => {
    // Test with unused parameters
    const contentWithUnused = `$THETA  1.5 2.0 3.0
$OMEGA  0.1 0.2
$SIGMA  0.01
$PK
CL = THETA(2) * EXP(ETA(2))  ; Uses THETA(2) and ETA(2)
Y = F + F * EPS(1)           ; Uses EPS(1)
; THETA(1), THETA(3), ETA(1) are defined but never used`;
    const unusedDocument = TextDocument.create('test://test.mod', 'nmtran', 1, contentWithUnused);
    
    const result = validateParameterReferences(unusedDocument);
    expect(result.isValid).toBe(false);
    
    // Should find 3 unused parameters
    const unusedErrors = result.errors.filter(e => e.message.includes('defined but never referenced'));
    expect(unusedErrors).toHaveLength(3);
    
    // Check specific unused parameters
    const unusedTheta1 = unusedErrors.find(e => e.message.startsWith('THETA(1)'));
    expect(unusedTheta1).toBeDefined();
    expect(unusedTheta1?.line).toBe(0); // $THETA line
    
    const unusedTheta3 = unusedErrors.find(e => e.message.startsWith('THETA(3)'));
    expect(unusedTheta3).toBeDefined();
    expect(unusedTheta3?.line).toBe(0);
    
    const unusedEta1 = unusedErrors.find(e => e.message.startsWith('ETA(1)'));
    expect(unusedEta1).toBeDefined();
    expect(unusedEta1?.line).toBe(1); // $OMEGA line
  });

  test('should ignore commented-out parameter definitions', () => {
    // Test with commented-out control records and inline comments
    const contentWithComments = `$THETA  1.5 2.0 ; 3.0  4.0 commented out
; $THETA  5.0 6.0  ; This entire line is commented out
$OMEGA  0.1
; $OMEGA  0.2 0.3  ; These OMEGAs are commented out
$SIGMA  0.01

$PK
CL = THETA(1) * EXP(ETA(1))  ; Uses THETA(1) and ETA(1) ✓
V = THETA(2)                 ; Uses THETA(2) ✓
Y = F + F * EPS(1)           ; Uses EPS(1) ✓
KA = THETA(3)                ; ERROR: THETA(3) doesn't exist (commented out)
Q = ETA(2)                   ; ERROR: ETA(2) doesn't exist (commented out)`;

    const commentDocument = TextDocument.create('test://test.mod', 'nmtran', 1, contentWithComments);
    const result = validateParameterReferences(commentDocument);
    
    expect(result.isValid).toBe(false);
    
    // Should find errors for THETA(3) and ETA(2) which are referenced but commented out
    const definitionErrors = result.errors.filter(e => e.message.includes('referenced but only'));
    expect(definitionErrors).toHaveLength(2);
    
    const theta3Error = definitionErrors.find(e => e.message.includes('THETA(3)'));
    expect(theta3Error).toBeDefined();
    expect(theta3Error?.message).toBe('THETA(3) referenced but only 2 THETA parameters defined');
    
    const eta2Error = definitionErrors.find(e => e.message.includes('ETA(2)'));
    expect(eta2Error).toBeDefined();
    expect(eta2Error?.message).toBe('ETA(2) referenced but only 1 ETA parameters defined');
    
    // Should not find any unused parameter errors since all defined parameters are used
    const unusedErrors = result.errors.filter(e => e.message.includes('defined but never referenced'));
    expect(unusedErrors).toHaveLength(0);
  });

  test('should handle mixed commented and uncommented parameter definitions', () => {
    // Test complex scenario with mixed commenting
    const mixedContent = `$THETA  1.5 ; 2.0  3.0
$THETA  2.0    ; Second THETA, first was 1.5
; $THETA  99.0 ; This doesn't count
$OMEGA  0.1 ; 0.2
; $OMEGA  0.3
$SIGMA  0.01

$PK
TV1 = THETA(1)  ; OK - uses THETA(1) = 1.5
TV2 = THETA(2)  ; OK - uses THETA(2) = 2.0  
IIV = ETA(1)    ; OK - uses ETA(1) = 0.1
ERR = EPS(1)    ; OK - uses EPS(1) = 0.01`;

    const mixedDocument = TextDocument.create('test://test.mod', 'nmtran', 1, mixedContent);
    const result = validateParameterReferences(mixedDocument);
    
    // Should be valid - all referenced parameters are properly defined (uncommented)
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should treat ERR(n) and EPS(n) as synonymous', () => {
    // Test that ERR and EPS are treated as equivalent
    const contentWithErr = `$THETA  1.5 2.0
$OMEGA  0.1
$SIGMA  0.01 0.02

$PK
CL = THETA(1) * EXP(ETA(1))
V = THETA(2)

$ERROR
Y = F + F * ERR(1) + ERR(2)  ; Uses ERR instead of EPS - should be valid`;

    const errDocument = TextDocument.create('test://test.mod', 'nmtran', 1, contentWithErr);
    const result = validateParameterReferences(errDocument);
    
    // Should be valid - ERR(1) maps to EPS(1), ERR(2) maps to EPS(2)
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should show meaningful error when ERR references undefined EPS parameters', () => {
    // Test error messages when ERR references non-existent parameters
    const contentWithInvalidErr = `$THETA  1.5
$OMEGA  0.1
$SIGMA  0.01  ; Only EPS(1) defined

$ERROR
Y = F + F * ERR(1) + ERR(3)  ; ERR(3) should be invalid
CL = THETA(1) * EXP(ETA(1))  ; Use all defined parameters`;

    const invalidErrDocument = TextDocument.create('test://test.mod', 'nmtran', 1, contentWithInvalidErr);
    const result = validateParameterReferences(invalidErrDocument);
    
    // Should be invalid - ERR(3) maps to EPS(3) but only EPS(1) is defined
    expect(result.isValid).toBe(false);
    
    const errError = result.errors.find(e => e.message.includes('ERR(3)'));
    expect(errError).toBeDefined();
    expect(errError?.message).toBe('ERR(3) referenced but only 1 EPS parameters defined');
  });

  test('should detect unused EPS when only ERR is used', () => {
    // Test that unused EPS detection works when ERR is used instead
    const contentWithUnusedEps = `$THETA  1.5
$OMEGA  0.1
$SIGMA  0.01 0.02  ; EPS(1) and EPS(2) defined

$ERROR
Y = F + F * ERR(1)  ; Only uses ERR(1), EPS(2) is unused
CL = THETA(1) * EXP(ETA(1))  ; Use all other parameters`;

    const unusedEpsDocument = TextDocument.create('test://test.mod', 'nmtran', 1, contentWithUnusedEps);
    const result = validateParameterReferences(unusedEpsDocument);

    // Should be invalid - EPS(2) is defined but never referenced (ERR(1) maps to EPS(1))
    expect(result.isValid).toBe(false);

    const unusedError = result.errors.find(e => e.message.includes('EPS(2)') && e.message.includes('never referenced'));
    expect(unusedError).toBeDefined();
  });

  // NONMEM Help Ch.8 ($ERROR): ERR(I) = ETA(I) for individual data, EPS(I) for population data.
  // Static heuristic: $SIGMA absent = individual, $SIGMA present = population.
  test('ERR(n) resolves to ETA(n) when $OMEGA present and $SIGMA absent (individual data)', () => {
    const content = `$THETA 1 FIX
$OMEGA 1 FIX
$PK
CL = THETA(1)
$ERROR
Y = A(3) + ERR(1)`;
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const result = validateParameterReferences(doc);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('ERR(n) out-of-range in individual-data model reports ETA count, not EPS', () => {
    const content = `$THETA 1 FIX
$OMEGA 1 FIX
$PK
CL = THETA(1) * EXP(ETA(1))
$ERROR
Y = F + ERR(2)`;
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const result = validateParameterReferences(doc);
    expect(result.isValid).toBe(false);
    const err = result.errors.find(e => e.message.includes('ERR(2)'));
    expect(err?.message).toBe('ERR(2) referenced but only 1 ETA parameters defined');
  });

  test('parameter references are case-insensitive (theta/eta/eps/err)', () => {
    // NONMEM is case-insensitive; lowercase refs must be detected as uses.
    const content = `$THETA 1 2
$OMEGA 0.1
$SIGMA 0.01
$PK
CL = theta(1) * EXP(eta(1))
V = Theta(2)
$ERROR
Y = F + F * err(1)`;
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const result = validateParameterReferences(doc);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('lowercase out-of-range ref still flagged (canonical uppercase in message)', () => {
    // Case-insensitive match must also preserve error reporting path.
    const content = `$THETA 1
$OMEGA 0.1
$SIGMA 0.01
$PK
CL = theta(5) * EXP(eta(1))
Y = F + F * eps(1)`;
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const result = validateParameterReferences(doc);
    expect(result.isValid).toBe(false);
    const err = result.errors.find(e => e.message.includes('THETA(5)'));
    expect(err?.message).toBe('THETA(5) referenced but only 1 THETA parameters defined');
  });

  test('zero-count diagnostic uses grammatical "no" phrasing', () => {
    const content = `$OMEGA 1
$SIGMA 0.01
$PK
CL = THETA(1) * EXP(ETA(1))
$ERROR
Y = F + EPS(1)`;
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const result = validateParameterReferences(doc);
    const err = result.errors.find(e => e.message.includes('THETA(1)'));
    expect(err?.message).toBe('THETA(1) referenced but no THETA parameters defined');
  });
});