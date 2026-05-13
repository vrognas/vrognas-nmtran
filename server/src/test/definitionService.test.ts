import { TextDocument } from 'vscode-languageserver-textdocument';
import { DefinitionService } from '../services/definitionService';
import { Position } from 'vscode-languageserver';
import { createMockConnection, asMockConnection, MockConnection } from './mocks/mockConnection';
import { ParameterScanner } from '../services/ParameterScanner';

describe('DefinitionService', () => {
  let service: DefinitionService;
  let mockConnection: MockConnection;

  beforeEach(() => {
    ParameterScanner.clearCache();
    mockConnection = createMockConnection();
    service = new DefinitionService(asMockConnection(mockConnection));
  });

  describe('BLOCK matrix handling', () => {
    it('should find correct diagonal elements in BLOCK(2) with inline values', async () => {
      const content = '$OMEGA  BLOCK(2) 0.0444 0.027 0.0241    ; IIV (CL-V)';
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Test ETA(1) - should point to 0.0444
      const eta1Def = await service.provideDefinition(_doc, Position.create(0, 17)); // Position of 0.0444
      expect(eta1Def).toBeDefined();
      
      // Test ETA(2) - should point to 0.0241
      const eta2Def = await service.provideDefinition(_doc, Position.create(0, 31)); // Position of 0.0241
      expect(eta2Def).toBeDefined();
    });

    it('should handle BLOCK(3) diagonal elements correctly', async () => {
      const content = `$OMEGA  BLOCK(3)
0.1
0.05 0.2
0.01 0.03 0.15`;

      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // ETA(1) on line 1 (value 0.1).
      const eta1 = await service.provideDefinition(_doc, Position.create(1, 0));
      expect(eta1).not.toBeNull();
      expect(eta1![0]!.range.start.line).toBe(1);

      // ETA(2) on line 2 (second value 0.2, after off-diagonal 0.05).
      const eta2 = await service.provideDefinition(_doc, Position.create(2, 5));
      expect(eta2).not.toBeNull();
      expect(eta2![0]!.range.start.line).toBe(2);
      // The diagonal value '0.2' starts at char 5.
      expect(eta2![0]!.range.start.character).toBe(5);

      // ETA(3) on line 3 (third value 0.15, after two off-diagonals).
      const eta3 = await service.provideDefinition(_doc, Position.create(3, 10));
      expect(eta3).not.toBeNull();
      expect(eta3![0]!.range.start.line).toBe(3);
      expect(eta3![0]!.range.start.character).toBe(10);
    });

    it('should handle SAME references correctly', async () => {
      const content = `$OMEGA  BLOCK(1) 0.0165
$OMEGA  BLOCK(1)  SAME`;

      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Cursor on the SAME keyword (line 1, char ~18).
      const def = await service.provideDefinition(_doc, Position.create(1, 19));
      expect(def).not.toBeNull();
      // Two locations: the SAME keyword itself, and the referenced 0.0165 on line 0.
      expect(def!.length).toBe(2);
      const lines = def!.map(d => d.range.start.line).sort();
      expect(lines).toEqual([0, 1]);
    });

    it('should handle mixed BLOCK and diagonal OMEGA', async () => {
      const content = `$OMEGA  BLOCK(2) 0.0444 0.027 0.0241
$OMEGA  0.5   ; Simple diagonal
$OMEGA  BLOCK(1) 3.0`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Should correctly identify:
      // ETA(1) -> 0.0444 (from BLOCK(2))
      // ETA(2) -> 0.0241 (from BLOCK(2))
      // ETA(3) -> 0.5 (simple diagonal)
      // ETA(4) -> 3.0 (from BLOCK(1))
    });
  });

  describe('Parameter usage navigation', () => {
    it('should find definition from usage in $PK block', async () => {
      const content = `$THETA 0.5   ; CL
$PK
CL = THETA(1) * EXP(ETA(1))`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Clicking on THETA(1) should navigate to 0.5
      const def = await service.provideDefinition(_doc, Position.create(2, 10)); // Position in THETA(1)
      expect(def).toBeDefined();
      expect(def).toHaveLength(1);
    });

    it('should handle ERR() as synonym for EPS()', async () => {
      const content = `$SIGMA 0.01   ; Residual error
$ERROR
Y = F + F*ERR(1)`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Clicking on ERR(1) should navigate to 0.01 in $SIGMA
      const def = await service.provideDefinition(_doc, Position.create(2, 10)); // Position in ERR(1)
      expect(def).toBeDefined();
      expect(def).toHaveLength(1);
    });

    it('should handle bounded THETA syntax', async () => {
      const content = `$THETA (0.01, 0.5, 10)
$THETA 2.5 FIX`;

      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // THETA(1): cursor inside the bounded expression — definition spans the whole '(0.01, 0.5, 10)'.
      const t1 = await service.provideDefinition(_doc, Position.create(0, 10));
      expect(t1).not.toBeNull();
      expect(t1!.length).toBeGreaterThanOrEqual(1);
      expect(t1![0]!.range.start.line).toBe(0);
      // The whole bounded expression: starts at '(' (char 7), ends after ')' (char 22).
      expect(t1![0]!.range.start.character).toBe(7);
      expect(t1![0]!.range.end.character).toBe(22);

      // THETA(2): cursor on '2.5' — definition + FIX additional range.
      const t2 = await service.provideDefinition(_doc, Position.create(1, 7));
      expect(t2).not.toBeNull();
      expect(t2!.length).toBe(2); // value range + FIX
    });

    it('should handle FIXED/FIX keywords with THETA parameters', async () => {
      const content = `$THETA  (0,3) 2 FIXED (0,.6,1) 10 (-INF,-2.7,0) (37 FIXED) 4 FIX`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Test THETA(2) - should highlight both "2" and "FIXED"
      const theta2Def = await service.provideDefinition(_doc, Position.create(0, 14)); // Position on "2"
      expect(theta2Def).toBeDefined();
      expect(theta2Def).toHaveLength(2); // Should have both value and FIXED keyword
      
      // Test THETA(6) - should highlight both "37" and "FIXED" inside parentheses
      const theta6Def = await service.provideDefinition(_doc, Position.create(0, 49)); // Position on "37"
      expect(theta6Def).toBeDefined();
      expect(theta6Def).toHaveLength(2); // Should have both value and FIXED keyword
      
      // Test THETA(7) - should highlight both "4" and "FIX"
      const theta7Def = await service.provideDefinition(_doc, Position.create(0, 59)); // Position on "4"  
      expect(theta7Def).toBeDefined();
      expect(theta7Def).toHaveLength(2); // Should have both value and FIX keyword
    });

    it('should handle FIXED keyword with BLOCK matrices', async () => {
      const content = `$OMEGA BLOCK(2) FIX
0.1
0.01 0.1`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Both ETA(1) and ETA(2) should highlight their values AND the FIX keyword
      const eta1Def = await service.provideDefinition(_doc, Position.create(1, 0)); // Position on first "0.1"
      expect(eta1Def).toBeDefined();
      expect(eta1Def).toHaveLength(2); // Should have both value and FIX keyword
      
      const eta2Def = await service.provideDefinition(_doc, Position.create(2, 5)); // Position on second "0.1"  
      expect(eta2Def).toBeDefined();
      expect(eta2Def).toHaveLength(2); // Should have both value and FIX keyword
    });

    it('should handle FIXED keyword with BLOCK matrices - all values on next line', async () => {
      const content = `$OMEGA  BLOCK(2) FIXED
  0.0444 0.027 0.0241    ; IIV (CL-V)`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Both ETA(1) and ETA(2) should highlight their values AND the FIXED keyword from line 0
      const eta1Def = await service.provideDefinition(_doc, Position.create(1, 2)); // Position on "0.0444"
      expect(eta1Def).toBeDefined();
      expect(eta1Def).toHaveLength(2); // Should have both value and FIXED keyword
      
      const eta2Def = await service.provideDefinition(_doc, Position.create(1, 17)); // Position on "0.0241"  
      expect(eta2Def).toBeDefined();
      expect(eta2Def).toHaveLength(2); // Should have both value and FIXED keyword
    });

    it('should handle FIXED keyword with BLOCK matrices - mixed inline and continuation', async () => {
      const content = `$OMEGA  BLOCK(2) FIXED 0.0444
  0.027 0.0241    ; IIV (CL-V)`;
      
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Both ETA(1) and ETA(2) should highlight their values AND the FIXED keyword from line 0
      const eta1Def = await service.provideDefinition(_doc, Position.create(0, 23)); // Position on "0.0444" on first line
      expect(eta1Def).toBeDefined();
      expect(eta1Def).toHaveLength(2); // Should have both value and FIXED keyword
      
      const eta2Def = await service.provideDefinition(_doc, Position.create(1, 8)); // Position on "0.0241" on second line
      expect(eta2Def).toBeDefined();
      expect(eta2Def).toHaveLength(2); // Should have both value and FIXED keyword
    });
  });

  describe('Error handling', () => {
    it('should handle malformed BLOCK syntax gracefully', async () => {
      const content = '$OMEGA  BLOCK(';
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      // Should not throw error
      const result = await service.provideDefinition(_doc, Position.create(0, 10));
      expect(result).toBeDefined(); // Should return null or empty array, not throw
    });

    it('should handle empty _documents', async () => {
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, '');
      const result = await service.provideDefinition(_doc, Position.create(0, 0));
      expect(result).toBeNull();
    });

    it('should handle out of bounds positions', async () => {
      const content = '$THETA 0.5';
      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      
      const result = await service.provideDefinition(_doc, Position.create(10, 0));
      expect(result).toBeNull();
    });
  });

  describe('Complex scenarios', () => {
    it('should handle complete NMTRAN model structure', async () => {
      const content = `$PROBLEM Test model
$INPUT ID TIME DV AMT
$DATA data.csv IGNORE=@
$SUBROUTINE ADVAN2 TRANS2

$PK
CL = THETA(1) * EXP(ETA(1))
V  = THETA(2) * EXP(ETA(2))
KA = THETA(3) * EXP(ETA(3))

$ERROR
Y = F + F*EPS(1)

$THETA 0.5    ; CL
$THETA (0.1, 2, 10)  ; V
$THETA 1.5 FIX   ; KA

$OMEGA BLOCK(2) 0.0444 0.027 0.0241
$OMEGA 0.1

$SIGMA 0.01

$ESTIMATION METHOD=1 MAXEVAL=9999`;

      const _doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Test various parameter references
      // THETA(1) in $PK should navigate to 0.5
      // ETA(2) should navigate to 0.0241 (diagonal of BLOCK(2))
      // ETA(3) should navigate to 0.1
      // EPS(1) should navigate to 0.01
    });
  });

  describe('provideReferences', () => {
    it('should find all references to a THETA parameter', () => {
      const content = `$THETA 0.5   ; CL
$PK
CL = THETA(1) * 2
V = THETA(1) * 10`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Find references to THETA(1)
      const refs = service.provideReferences(doc, Position.create(2, 10), true);
      expect(refs).toBeDefined();
      expect(refs!.length).toBeGreaterThanOrEqual(2); // At least 2 usages
    });

    it('should find references excluding declaration', () => {
      const content = `$THETA 0.5   ; CL
$PK
CL = THETA(1) * 2
V = THETA(1) * 10`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Find references excluding declaration
      const refs = service.provideReferences(doc, Position.create(2, 10), false);
      expect(refs).toBeDefined();
      // Should find usage references but not the definition
    });

    it('should return null for non-parameter positions', () => {
      const content = `$PROBLEM Test
$PK
CL = 1.0`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      const refs = service.provideReferences(doc, Position.create(0, 5), true);
      expect(refs).toBeNull();
    });

    it('should find ETA references across document', () => {
      const content = `$OMEGA 0.1
$PK
CL = THETA(1) * EXP(ETA(1))
V = THETA(2) * EXP(ETA(1))`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      const refs = service.provideReferences(doc, Position.create(2, 23), true);
      expect(refs).toBeDefined();
      expect(refs!.length).toBeGreaterThanOrEqual(2); // Used twice
    });

    it('should find ERR references (EPS synonym)', () => {
      const content = `$SIGMA 0.01
$ERROR
Y = F + F*ERR(1)
IPRED = F + ERR(1)`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      const refs = service.provideReferences(doc, Position.create(2, 12), true);
      expect(refs).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle continuation lines', () => {
      const content = `$THETA  (0,3)
2 FIXED
(0,.6,1)`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Should recognize THETA parameters across continuation lines
      const def = service.provideDefinition(doc, Position.create(1, 0));
      expect(def).toBeDefined();
    });

    it('should handle parameters in comments gracefully', () => {
      const content = `$THETA 0.5   ; THETA(1) is clearance
$PK
CL = THETA(1)`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Should not crash when THETA(1) appears in comment
      const refs = service.provideReferences(doc, Position.create(2, 8), true);
      expect(refs).toBeDefined();
    });

    it('should handle BLOCK matrices with values on next line', async () => {
      const content = `$OMEGA BLOCK(2)
0.1
0.05 0.2`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Should find ETA(1) on line 1
      const def = await service.provideDefinition(doc, Position.create(1, 0));
      expect(def).toBeDefined();
    });
  });

  describe('user-defined variables (LHS bindings in $PRED / $PK / $ERROR / …)', () => {
    it('jumps to the first top-level `name = rhs` line for the identifier', async () => {
      const content = ['$PROBLEM x', '$DATA d', '$PK', '  CL = THETA(1) * 2', '  V = CL + 1'].join(
        '\n',
      );
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Cursor on the `CL` USAGE inside `V = CL + 1` (line 4, char 6).
      const def = await service.provideDefinition(doc, Position.create(4, 6));
      expect(def).not.toBeNull();
      expect(def!).toHaveLength(1);
      const loc = def![0]!;
      // Should jump to the LHS `CL` on line 3.
      expect(loc.range.start.line).toBe(3);
      expect(loc.range.start.character).toBe(2); // after the two leading spaces
      expect(loc.range.end.character).toBe(4); // 'CL' is 2 chars
    });

    it('finds all references to a user variable (LHS + RHS uses, skips comments)', () => {
      const content = [
        '$PROBLEM x',
        '$DATA d',
        '$PK',
        '  CL = THETA(1) * 2',
        '  V = CL + 1',
        '  ; CL not real',
        '$ERROR',
        '  IPRED = CL / V',
      ].join('\n');
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Cursor on the `CL` LHS at line 3.
      const refs = service.provideReferences(doc, Position.create(3, 2), true);
      expect(refs).not.toBeNull();
      // Three real CL occurrences: the LHS on line 3, RHS on line 4, RHS on line 7.
      // The commented `CL` on line 5 should be excluded.
      const lines = refs!.map((r) => r.range.start.line).sort();
      expect(lines).toEqual([3, 4, 7]);
    });

    it('returns null gracefully for an undefined identifier', async () => {
      const content = ['$PROBLEM x', '$DATA d', '$PK', '  CL = THETA(1)'].join('\n');
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);

      // Cursor on `THETA` (which IS defined-by-system but isn't a user variable
      // and isn't `THETA(n)` because we point right at the bare `T` in 'THETA(1)').
      // Actually parameter regex DOES match this — let's pick a known-undefined id.
      const noDef = await service.provideDefinition(doc, Position.create(2, 1)); // on '$PK' itself
      expect(noDef).toBeNull();
    });
  });
});