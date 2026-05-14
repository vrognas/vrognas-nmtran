/**
 * Tests for BLOCK Matrix Validation
 * 
 * Tests the critical BLOCK matrix syntax validation feature,
 * including proper matrix structure, element counts, and SAME keyword usage
 */

import { ParameterScanner } from '../services/parameterScanner';
import { validateSameKeywordUsage } from '../validators/sameKeywordUsage';
import { validateBlockMatrixSyntax } from '../validators/blockMatrixSyntax';
import { createDocument } from './test-helpers';

describe('BLOCK Matrix Validation', () => {
  beforeEach(() => {
    ParameterScanner.clearCache();
  });

  describe('Valid BLOCK Matrix Structures', () => {
    it('should validate correct BLOCK(2) matrix with 3 elements', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate correct BLOCK(3) matrix with 6 elements', () => {
      const content = `
$OMEGA BLOCK(3) 
  0.1 
  0.05 0.2
  0.02 0.03 0.15
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate BLOCK matrix with SAME keyword', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2
$OMEGA BLOCK(2) SAME
$OMEGA BLOCK(1) SAME
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate mixed BLOCK and regular parameters', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2
$OMEGA 0.3
$OMEGA BLOCK(1) 0.4
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true); // BLOCK(1) is valid - no warnings
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Invalid BLOCK Matrix Structures', () => {
    it('should detect BLOCK matrix with too few elements', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('incomplete: expected 3 elements, found 2');
    });

    it('should detect BLOCK matrix with too many elements', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2 0.15
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('too many elements: expected 3, found 4');
    });

    it('should detect invalid BLOCK size (zero)', () => {
      const content = `
$OMEGA BLOCK(0) 0.1
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Invalid BLOCK size: BLOCK(0). Size must be >= 1');
    });

    it('should accept BLOCK(1) as valid NONMEM syntax', () => {
      const content = `
$OMEGA BLOCK(1) 0.1             ; Valid - BLOCK(1) with value
$OMEGA BLOCK(1) SAME            ; Valid - BLOCK(1) with SAME  
$OMEGA BLOCK(2) 0.1 0.05 0.2    ; Valid - true matrix
$OMEGA BLOCK(1) 0.3             ; Valid - another BLOCK(1)
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('SIGMA BLOCK Matrix Validation', () => {
    it('should validate SIGMA BLOCK matrices', () => {
      const content = `
$SIGMA BLOCK(2) 0.01 0.005 0.02
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid SIGMA BLOCK matrices', () => {
      const content = `
$SIGMA BLOCK(3) 0.01 0.005
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('SIGMA BLOCK(3) incomplete: expected 6 elements, found 2');
    });
  });

  describe('Complex BLOCK Matrix Scenarios', () => {
    it('should handle multiple BLOCK matrices in sequence', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2    ; First block
$OMEGA BLOCK(1) 0.3             ; Single element block (valid)  
$OMEGA BLOCK(2) SAME            ; Reference to first block
$OMEGA 0.4                      ; Regular parameter
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true); // All BLOCK structures are valid
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle BLOCK matrices with comments', () => {
      const content = `
$OMEGA BLOCK(2) ; Block matrix start
  0.1           ; Variance for first parameter
  0.05 0.2      ; Covariance and variance for second parameter
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle BLOCK matrices split across multiple lines', () => {
      const content = `
$OMEGA BLOCK(3)
0.1
0.05 0.2  
0.01 0.02 0.15
$SIGMA BLOCK(2)
0.01
0.005 0.02
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('SAME Keyword Validation', () => {
    it('should validate proper SAME keyword usage', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2
$OMEGA BLOCK(2) SAME
`;
      const document = createDocument(content);
      const validation = validateSameKeywordUsage(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect SAME keyword used outside BLOCK context', () => {
      const content = `
$OMEGA 0.1
$OMEGA SAME  ; Invalid - SAME without BLOCK
`;
      const document = createDocument(content);
      const validation = validateSameKeywordUsage(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('SAME keyword should only be used with BLOCK matrices');
    });

    it('should validate SAME in different control records', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2
$OMEGA BLOCK(2) SAME
$SIGMA BLOCK(2) 0.01 0.005 0.02  
$SIGMA BLOCK(2) SAME
`;
      const document = createDocument(content);
      const validation = validateSameKeywordUsage(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Edge Cases and Error Recovery', () => {
    it('should handle malformed BLOCK declarations gracefully', () => {
      const content = `
$OMEGA BLOCK() 0.1  ; Missing size
$OMEGA BLOCK(abc) 0.2  ; Non-numeric size
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      // Should not crash, may or may not report errors depending on parsing strategy
      expect(validation).toBeDefined();
    });

    it('should handle empty BLOCK matrices', () => {
      const content = `
$OMEGA BLOCK(2)
; No elements provided
$THETA 1.5
`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('incomplete: expected 3 elements, found 0');
    });

    it('should handle BLOCK matrices at end of file', () => {
      const content = `
$OMEGA BLOCK(2) 0.1 0.05 0.2`;
      const document = createDocument(content);
      const validation = validateBlockMatrixSyntax(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Matrix Size Calculations', () => {
    const testCases = [
      { size: 1, expected: 1 },   // 1*(1+1)/2 = 1
      { size: 2, expected: 3 },   // 2*(2+1)/2 = 3  
      { size: 3, expected: 6 },   // 3*(3+1)/2 = 6
      { size: 4, expected: 10 },  // 4*(4+1)/2 = 10
      { size: 5, expected: 15 }   // 5*(5+1)/2 = 15
    ];

    testCases.forEach(({ size, expected }) => {
      it(`should correctly calculate elements needed for BLOCK(${size})`, () => {
        const elements = Array(expected).fill('0.1').join(' ');
        const content = `$OMEGA BLOCK(${size}) ${elements}`;
        
        const document = createDocument(content);
        const validation = validateBlockMatrixSyntax(document);
        
        expect(validation.isValid).toBe(true); // All BLOCK sizes are valid
      });
    });
  });
});