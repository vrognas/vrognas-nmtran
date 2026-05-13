import { describe, it, expect } from 'vitest';
import { NMTRANMatrixParser } from '../utils/NMTRANMatrixParser';

describe('NMTRANMatrixParser', () => {
  describe('getDiagonalPosition', () => {
    it('returns flat-array index of the n-th diagonal element', () => {
      expect(NMTRANMatrixParser.getDiagonalPosition(1)).toBe(0);
      expect(NMTRANMatrixParser.getDiagonalPosition(2)).toBe(2);
      expect(NMTRANMatrixParser.getDiagonalPosition(3)).toBe(5);
      expect(NMTRANMatrixParser.getDiagonalPosition(4)).toBe(9);
      expect(NMTRANMatrixParser.getDiagonalPosition(5)).toBe(14);
    });
  });

  describe('isDiagonalElement', () => {
    it('returns 1-based parameter index for diagonal positions', () => {
      expect(NMTRANMatrixParser.isDiagonalElement(0)).toBe(1);
      expect(NMTRANMatrixParser.isDiagonalElement(2)).toBe(2);
      expect(NMTRANMatrixParser.isDiagonalElement(5)).toBe(3);
      expect(NMTRANMatrixParser.isDiagonalElement(9)).toBe(4);
      expect(NMTRANMatrixParser.isDiagonalElement(14)).toBe(5);
    });

    it('returns null for off-diagonal positions', () => {
      expect(NMTRANMatrixParser.isDiagonalElement(1)).toBeNull();
      expect(NMTRANMatrixParser.isDiagonalElement(3)).toBeNull();
      expect(NMTRANMatrixParser.isDiagonalElement(4)).toBeNull();
    });
  });
});
