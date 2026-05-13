/**
 * Tests for Continuation Marker (&) Validation
 * 
 * Tests the validation of FORTRAN-style continuation markers,
 * ensuring proper placement and usage according to NMTRAN rules
 */

import { validateContinuationMarkers } from '../validators/continuationMarkers';
import { createDocument } from './test-helpers';

describe('Continuation Marker Validation', () => {

  describe('Valid Continuation Usage', () => {
    it('should accept valid continuation at end of line', () => {
      const content = `
$INPUT ID TIME AMT WGT APGR &
  DV EVID MDV
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept continuation before comments', () => {
      const content = `
$INPUT ID TIME AMT WGT & ; continuation with comment
  DV EVID MDV
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept multiple continuation lines', () => {
      const content = `
$INPUT ID TIME AMT WGT &
  APGR DV EVID &
  MDV SCR AGE
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept continuation in different control records', () => {
      const content = `
$INPUT ID TIME AMT &
  DV EVID MDV
$THETA (0,27.5) &
  (0,1.565) (0,2.1)
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should accept continuation with trailing whitespace', () => {
      const content = `
$INPUT ID TIME AMT WGT &   
  DV EVID MDV
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Invalid Continuation Usage', () => {
    it('should detect continuation marker in middle of line', () => {
      const content = `
$INPUT ID TIME & AMT WGT DV EVID
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Continuation marker (&) must appear at the end of the line');
      expect(validation.errors[0]?.line).toBe(1);  // Second line (0-indexed)
    });

    it('should detect orphaned continuation at end of file', () => {
      const content = `
$INPUT ID TIME AMT WGT &`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Orphaned continuation marker (&) at end of file');
    });

    it('should detect continuation not followed by content', () => {
      const content = `
$INPUT ID TIME AMT WGT &

$THETA 1.5`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Continuation marker (&) not followed by continuation content');
    });

    it('should detect continuation followed only by comment', () => {
      const content = `
$INPUT ID TIME AMT WGT &
; This is just a comment, no continuation content
$THETA 1.5`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('Continuation marker (&) not followed by continuation content');
    });

    it('should detect multiple invalid continuations', () => {
      const content = `
$INPUT ID & TIME AMT WGT
$THETA & 1.5 2.0
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(2);
      expect(validation.errors[0]?.message).toContain('must appear at the end of the line');
      expect(validation.errors[1]?.message).toContain('must appear at the end of the line');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty lines gracefully', () => {
      const content = `
$INPUT ID TIME AMT &

  DV EVID MDV
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('not followed by continuation content');
    });

    it('should handle files without any continuation markers', () => {
      const content = `
$PROBLEM Test Problem
$INPUT ID TIME DV EVID  
$THETA 1.5
$OMEGA 0.1
$SIGMA 1 FIX
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle ampersand in comments (should be ignored)', () => {
      const content = `
; fish & chips
$INPUT ID TIME DV
; rock & roll
$THETA 1.5
; comments with & symbols should be ignored
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle ampersand in inline comments (should be ignored)', () => {
      const content = `
$INPUT ID TIME DV   ; data & variables
$THETA 1.5          ; parameter & bounds
A = 1               ; This & should be ignored
B = 2               ; foo & bar
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle ampersand in string literals (if any)', () => {
      const content = `
$PROBLEM "Test & Problem"
$INPUT ID TIME DV
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]?.message).toContain('must appear at the end of the line');
    });
  });

  describe('Complex Continuation Scenarios', () => {
    it('should handle continuation in THETA bounds', () => {
      const content = `
$THETA (0,27.5) (0,1.565) &
  (0,2.1) (0,0.254)
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle continuation in BLOCK matrices', () => {
      const content = `
$OMEGA BLOCK(2) &
  0.1 0.05 0.2
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle continuation in abbreviated code', () => {
      const content = `
$PK
  CL = THETA(1) * &
    EXP(ETA(1))
  V = THETA(2)
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle complex mixed valid and invalid continuations', () => {
      const content = `
$INPUT ID TIME & AMT WGT   ; Invalid - & in middle
  DV EVID MDV              ; Valid continuation content
$THETA (0,1.5) &           ; Valid - & at end  
  (0,2.0)                  ; Valid continuation content
$OMEGA 0.1 & 0.2           ; Invalid - & in middle
`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      
      // Should detect multiple & errors
      expect(validation.errors.some(e => e.message.includes('must appear at the end of the line'))).toBe(true);
    });
  });

  describe('Position Accuracy', () => {
    it('should report correct character positions for invalid continuations', () => {
      const content = `$INPUT ID & TIME`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      
      const error = validation.errors[0];
      expect(error?.startChar).toBe(10); // Position of &
      expect(error?.endChar).toBe(11);   // Position after &
      expect(error?.line).toBe(0);
    });

    it('should report correct positions for multiple invalid continuations on same line', () => {
      const content = `$INPUT ID & TIME & AMT`;
      const document = createDocument(content);
      const validation = validateContinuationMarkers(document);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(2);
      
      // Both errors should be on line 0
      expect(validation.errors[0]?.line).toBe(0);
      expect(validation.errors[1]?.line).toBe(0);
      
      // First & should be at position 10
      expect(validation.errors[0]?.startChar).toBe(10);
      
      // Second & should be at position 17
      expect(validation.errors[1]?.startChar).toBe(17);
    });
  });
});