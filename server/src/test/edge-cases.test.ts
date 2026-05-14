import { ParameterScanner } from '../services/parameterScanner';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('ParameterScanner Edge Cases', () => {
  function createDocument(content: string): TextDocument {
    return TextDocument.create('test://test.mod', 'nmtran', 1, content);
  }

  beforeEach(() => {
    ParameterScanner.clearCache();
  });

  describe('malformed input handling', () => {
    it('should handle empty documents', () => {
      const doc = createDocument('');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toEqual([]);
    });

    it('should handle documents with only whitespace', () => {
      const doc = createDocument('   \n\t\n   ');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toEqual([]);
    });

    it('should handle documents with only comments', () => {
      const doc = createDocument('; This is a comment\n; Another comment');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toEqual([]);
    });

    it('should handle malformed BLOCK syntax', () => {
      const doc = createDocument('$OMEGA BLOCK()\n0.1');
      const locations = ParameterScanner.scanDocument(doc);
      // Should treat as regular parameter due to malformed BLOCK syntax
      expect(locations).toHaveLength(1);
      expect(locations[0]?.type).toBe('ETA');
    });

    it('should handle BLOCK with invalid size', () => {
      const doc = createDocument('$OMEGA BLOCK(0)\n0.1');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(1);
    });
  });

  describe('extreme parameter counts', () => {
    it('should handle many THETA parameters', () => {
      const thetaValues = Array(20).fill('1.0').join(' ');
      const doc = createDocument(`$THETA ${thetaValues}`);
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(20);
      expect(locations.every(loc => loc.type === 'THETA')).toBe(true);
    });

    it('should handle nested BLOCK matrices', () => {
      // Multiple BLOCK declarations in sequence
      const content = `
$OMEGA BLOCK(2)
0.04 0.027 0.05
$OMEGA BLOCK(2) 
0.1 0.05 0.2
`;
      const doc = createDocument(content);
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(4); // 2 parameters per BLOCK(2)
    });
  });

  describe('mixed parameter types', () => {
    it('should handle interleaved parameter blocks', () => {
      const content = `
$THETA 1.0
$OMEGA 0.1
$THETA 2.0
$SIGMA 0.01
$THETA 3.0
`;
      const doc = createDocument(content);
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(5);
      
      const thetaCount = locations.filter(loc => loc.type === 'THETA').length;
      const etaCount = locations.filter(loc => loc.type === 'ETA').length;
      const epsCount = locations.filter(loc => loc.type === 'EPS').length;
      
      expect(thetaCount).toBe(3);
      expect(etaCount).toBe(1);
      expect(epsCount).toBe(1);
    });
  });

  describe('unusual numeric formats', () => {
    it('should handle scientific notation', () => {
      const doc = createDocument('$THETA 1.5E-6 2.3e+10 -4.7E-2');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(3);
      expect(locations.every(loc => loc.type === 'THETA')).toBe(true);
    });

    it('should handle negative numbers', () => {
      const doc = createDocument('$THETA -1.0 -2.5 -0.001');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(3);
    });

    it('should handle numbers without leading digits', () => {
      const doc = createDocument('$THETA .5 .001 .99');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(3);
    });
  });

  describe('complex FIXED patterns', () => {
    it('should handle multiple FIXED keywords', () => {
      const doc = createDocument('$THETA 1.0 FIXED 2.0 FIXED 3.0');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(3);
      // Check that FIXED ranges are captured
      expect(locations[0]?.additionalRanges).toBeDefined();
      expect(locations[1]?.additionalRanges).toBeDefined();
    });

    it('should handle FIX abbreviation', () => {
      const doc = createDocument('$THETA 1.0 FIX 2.0 FIX');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(2);
      expect(locations[0]?.additionalRanges).toBeDefined();
      expect(locations[1]?.additionalRanges).toBeDefined();
    });
  });

  describe('whitespace handling', () => {
    it('should handle irregular whitespace', () => {
      const doc = createDocument('$THETA\t\t1.0   \t2.0\n\t\t3.0');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(3);
    });

    it('should handle lines with only whitespace between parameters', () => {
      const content = `
$THETA 1.0
   
2.0
      
3.0
`;
      const doc = createDocument(content);
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(3);
    });
  });

  describe('SAME keyword edge cases', () => {
    it('should handle SAME with additional keywords', () => {
      const doc = createDocument('$OMEGA SAME FIXED');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(1);
      expect(locations[0]?.type).toBe('ETA');
    });

    it('should handle SAME in BLOCK context', () => {
      const doc = createDocument('$OMEGA BLOCK(2) SAME');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(1);
      expect(locations[0]?.type).toBe('ETA');
    });
  });

  describe('comment handling', () => {
    it('should handle inline comments', () => {
      const doc = createDocument('$THETA 1.0 ; Initial value\n$THETA 2.0 ; Second parameter');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(2);
    });

    it('should handle comments with semicolons in quotes', () => {
      // Edge case: semicolons within quoted strings (if any)
      const doc = createDocument('$THETA 1.0 2.0 ; Comment with; multiple; semicolons');
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(2);
    });
  });

  describe('large BLOCK matrices', () => {
    it('should handle BLOCK(5) matrix correctly', () => {
      // BLOCK(5) should have 15 elements total, 5 diagonal
      const content = `
$OMEGA BLOCK(5)
0.1    ; 1,1
0.05 0.2    ; 2,1 2,2  
0.01 0.02 0.3    ; 3,1 3,2 3,3
0.005 0.01 0.015 0.4    ; 4,1 4,2 4,3 4,4
0.001 0.002 0.003 0.004 0.5    ; 5,1 5,2 5,3 5,4 5,5
`;
      const doc = createDocument(content);
      const locations = ParameterScanner.scanDocument(doc);
      expect(locations).toHaveLength(5); // 5 diagonal elements = 5 parameters
      expect(locations.every(loc => loc.type === 'ETA')).toBe(true);
    });
  });

  describe('performance edge cases', () => {
    it('should handle very long lines efficiently', () => {
      const longLine = '$THETA ' + Array(100).fill('1.0').join(' ');
      const doc = createDocument(longLine);
      
      const start = performance.now();
      const locations = ParameterScanner.scanDocument(doc);
      const end = performance.now();
      
      expect(locations).toHaveLength(100);
      expect(end - start).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle many lines efficiently', () => {
      const manyLines = Array(1000).fill('1.0').map((val, i) => `${val} ; Line ${i}`).join('\n');
      const content = `$THETA\n${manyLines}`;
      const doc = createDocument(content);
      
      const start = performance.now();
      const locations = ParameterScanner.scanDocument(doc);
      const end = performance.now();
      
      expect(locations).toHaveLength(1000);
      expect(end - start).toBeLessThan(500); // Should complete in under 500ms
    });
  });
});