/**
 * NMTRANMatrixParser — index arithmetic for the row-major lower-triangular
 * BLOCK matrix layout used by NM-TRAN. Both methods are pure math.
 *
 * Diagonal of parameter n (1-based) lives at flat position n*(n+1)/2 - 1:
 *   n=1 → 0, n=2 → 2, n=3 → 5, n=4 → 9, ...
 */

export class NMTRANMatrixParser {
  /** Flat-array position of the n-th (1-based) diagonal element. */
  static getDiagonalPosition(paramIndex: number): number {
    return (paramIndex * (paramIndex + 1)) / 2 - 1;
  }

  /**
   * If `position` (0-based) is a diagonal slot, return the 1-based parameter
   * index that lives there; otherwise null.
   */
  static isDiagonalElement(position: number): number | null {
    // Invert n*(n+1)/2 - 1 = position → n = floor((sqrt(8*(position+1)+1) - 1) / 2)
    const n = Math.floor((Math.sqrt(8 * (position + 1) + 1) - 1) / 2);
    if (n >= 1 && this.getDiagonalPosition(n) === position) return n;
    return null;
  }
}
