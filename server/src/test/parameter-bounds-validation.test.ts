/**
 * Tests for Parameter Bounds Validation
 * 
 * Tests validation of THETA, OMEGA, and SIGMA parameter bounds,
 * including proper syntax and logical bound relationships
 */

import { ParameterScanner } from '../services/ParameterScanner';
import { validateParameterBounds } from '../validators/parameterBounds';
import { createDocument } from './test-helpers';

describe('Parameter Bounds Validation', () => {
  beforeEach(() => {
    ParameterScanner.clearCache();
  });

  describe('Valid THETA Bounds', () => {
    it('should accept valid bounded THETA parameters', () => {
      const content = `
$THETA (0,27.5,100)     ; Lower bound, initial, upper bound
$THETA (0,1.565)        ; Lower bound, initial (no upper)
$THETA 2.1              ; Just initial value
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept infinity bounds', () => {
      const content = `
$THETA (-INF,27.5,INF)   ; Infinite bounds
$THETA (-INFINITY,1.5,INFINITY) ; Alternative infinity notation
$THETA (0,2.1,INF)       ; Mixed finite and infinite
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept INFIN and INFTY infinity forms (NMTRAN 7.6.0)', () => {
      // Per NONMEM Users Guide Part IV Ch.III + NMTRAN 7.6.0 prefix-matching:
      // INF, INFINITY, INFIN, INFTY are all valid infinity tokens in $THETA bound triples.
      const content = `
$THETA (-INFIN,1,INFIN)
$THETA (-INFTY,1,INFTY)
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept negative values in bounds', () => {
      const content = `
$THETA (-10,-2.7,0)      ; All negative bounds
$THETA (-INF,-5,10)      ; Mixed negative/positive
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept scientific notation in bounds', () => {
      const content = `
$THETA (1E-6,1E-3,1E-1)  ; Scientific notation
$THETA (0,2.5E-2,1E2)    ; Mixed notation
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept empty initial values for THETA only', () => {
      const content = `
$THETA (0,,0.346)        ; Empty initial value - valid for THETA
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Invalid THETA Bounds', () => {
    it('should detect lower bound greater than initial value', () => {
      const content = `
$THETA (10,5,20)         ; Lower > initial
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Lower bound (10) cannot be greater than initial value (5)');
    });

    it('should detect initial value greater than upper bound', () => {
      const content = `
$THETA (0,15,10)         ; Initial > upper
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Initial value (15) cannot be greater than upper bound (10)');
    });

    it('should detect lower bound greater than upper bound', () => {
      const content = `
$THETA (20,25,10)        ; Lower > upper (also other violations)
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.message.includes('Lower bound (20) cannot be greater than upper bound (10)'))).toBe(true);
    });

    it('should detect invalid numeric values', () => {
      const content = `
$THETA (0,abc,10)        ; Invalid initial value
$THETA (xyz,5,10)        ; Invalid lower bound
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.message.includes('Invalid initial value: abc'))).toBe(true);
      expect(validation.errors.some(e => e.message.includes('Invalid lower bound: xyz'))).toBe(true);
    });

    it('should detect wrong number of bound components', () => {
      const content = `
$THETA (0,1,2,3)         ; Too many components (4)
$THETA (1,2)             ; Ambiguous - could be (low,init) but 2 components not standard
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.message.includes('found 4 components'))).toBe(true);
    });

    it('should distinguish between empty and invalid initial values', () => {
      const content = `
$THETA (0,,0.346)        ; Valid: empty initial value for THETA
$THETA (0,abc,0.346)     ; Invalid: non-numeric initial value
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Invalid initial value: abc');
    });

    it('should reject bound syntax for OMEGA and SIGMA', () => {
      const content = `
$OMEGA (0.001,0.1,1.0)   ; Invalid: OMEGA doesn't support bounds
$SIGMA (1E-6,0.01,0.1)   ; Invalid: SIGMA doesn't support bounds
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(2);
      expect(validation.errors[0]?.message).toContain('does not support bound syntax');
      expect(validation.errors[1]?.message).toContain('does not support bound syntax');
    });
  });

  describe('OMEGA Parameter Validation', () => {
    it('should accept valid OMEGA values', () => {
      const content = `
$OMEGA 0.1               ; Valid variance value
$OMEGA 0.2               ; Another variance value
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should warn about negative OMEGA values', () => {
      const content = `
$OMEGA -0.1              ; Negative variance (unusual but allowed)
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('should generally be positive');
    });

    it('should handle OMEGA BLOCK matrices', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept negative off-diagonals in OMEGA BLOCK (covariances)', () => {
      // User's real case: multi-line BLOCK(4) with negative off-diagonal.
      // NONMEM allows off-diagonals (covariances) to be negative; only diagonals (variances) must be positive.
      const content = `
$OMEGA BLOCK(4)
0.1
6.83328E-04  0.1
1.05324E-03 -1.82494E-03  0.1
7.11753E-04  8.46056E-04  1.47772E-03  0.1
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should still flag negative diagonal in OMEGA BLOCK', () => {
      // Diagonal (variance) must be positive even in BLOCK. BLOCK(2): values [d1, c21, d2].
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 -0.2
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.message.includes('-0.2'))).toBe(true);
    });

    it('should accept negative off-diagonals in compact BLOCK form', () => {
      // All values on BLOCK line; -0.05 is off-diagonal (position 2,1).
      const content = `
$OMEGA BLOCK(2) 0.1 -0.05 0.2
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('SIGMA Parameter Validation', () => {
    it('should accept valid SIGMA values', () => {
      const content = `
$SIGMA 0.01              ; Valid residual error value
$SIGMA 1 FIX             ; Fixed residual error
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should warn about negative SIGMA values', () => {
      const content = `
$SIGMA -0.5              ; Negative residual error (unusual)
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('should generally be positive');
    });
  });

  describe('Complex Parameter Scenarios', () => {
    it('should handle multiple parameters with mixed validity', () => {
      const content = `
$THETA (0,27.5,100)      ; Valid THETA with bounds
$THETA (10,5,20)         ; Invalid - lower > initial  
$THETA 2.1               ; Valid THETA simple value
$THETA (-INF,abc,INF)    ; Invalid - bad initial value
$OMEGA 0.1               ; Valid OMEGA value  
$OMEGA -0.2              ; Warning - negative variance
$SIGMA 1 FIX             ; Valid SIGMA (no bounds to check)
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      
      // Check specific error messages
      expect(validation.errors.some(e => e.message.includes('Lower bound (10) cannot be greater than initial value (5)'))).toBe(true);
      expect(validation.errors.some(e => e.message.includes('Invalid initial value: abc'))).toBe(true);
      expect(validation.errors.some(e => e.message.includes('OMEGA initial value (-0.2) should generally be positive'))).toBe(true);
    });

    it('should handle parameters with comments', () => {
      const content = `
$THETA (0,27.5,100)    ; TVCL - typical clearance
$THETA (10,5,20)       ; Invalid bound - lower > initial
$OMEGA 0.1             ; IIV on CL
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.message.includes('Lower bound (10) cannot be greater than initial value (5)'))).toBe(true);
    });

    it('should handle parameters across multiple control records', () => {
      const content = `
$THETA (0,1,10)          ; Valid THETA with bounds
$OMEGA 0.1               ; Valid OMEGA value
$SIGMA 0.01              ; Valid SIGMA value  
$THETA (20,5,10)         ; Invalid THETA - multiple bound violations
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Error Recovery', () => {
    it('should handle malformed parentheses gracefully', () => {
      const content = `
$THETA (0,1,10          ; Missing closing paren
$THETA 0,1,10)          ; Missing opening paren
$THETA ((0,1,10))       ; Double parentheses
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      // Should not crash - behavior may vary based on parsing strategy
      expect(validation).toBeDefined();
    });

    it('should handle empty bound expressions', () => {
      const content = `
$THETA ()                ; Empty bounds
$THETA (,1,)             ; Empty components
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      // Should handle gracefully without crashing
      expect(validation).toBeDefined();
    });

    it('should handle very large numbers', () => {
      const content = `
$THETA (0,1e10,1e20)     ; Very large numbers
$THETA (-1e20,-1e10,0)   ; Very large negative numbers
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle parameters without any bounds', () => {
      const content = `
$THETA 1.5 2.0 3.5       ; Simple unbounded parameters
$OMEGA 0.1 0.2           ; Simple variances
$SIGMA 1 FIX             ; Fixed parameter
`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Position Accuracy', () => {
    it('should report correct positions for bound validation errors', () => {
      const content = `$THETA (10,5,20)`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      
      const error = validation.errors[0];
      expect(error?.line).toBe(0);
      expect(error?.startChar).toBe(7);  // Start of (10,5,20)
      expect(error?.endChar).toBe(16);   // End of (10,5,20)
    });

    it('should handle multiple bound expressions on same line', () => {
      const content = `$THETA (0,1,10) (20,5,30)`;
      const document = createDocument(content);
      const validation = validateParameterBounds(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1); // Only second expression has error
      
      const error = validation.errors[0];
      expect(error?.line).toBe(0);
      expect(error?.startChar).toBe(16); // Start of second expression
      expect(error?.endChar).toBe(25);   // End of second expression (adjust for actual length)
    });
  });
});