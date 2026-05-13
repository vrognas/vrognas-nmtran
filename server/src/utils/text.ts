/**
 * Tiny text helpers shared across NMTRAN parsers. Each does one thing
 * so callers can chain (`stripBlockPrefix(stripRecordPrefix(line))`)
 * when they need to peel multiple layers.
 *
 * Position-tracking callers (those that need char offsets back, not
 * just the stripped string) should keep using regex `match` directly
 * — these helpers throw away that information by design.
 */

/** Return the portion of `line` before the first `;`, or `line` unchanged when no `;` present. */
export function stripComment(line: string): string {
  const idx = line.indexOf(';');
  return idx === -1 ? line : line.slice(0, idx);
}

/** Strip a leading `\s*$RECORD\s*` prefix. */
export function stripRecordPrefix(line: string): string {
  return line.replace(/^\s*\$\w+\s*/i, '');
}

/** Strip a leading `BLOCK(n)\s*` prefix. */
export function stripBlockPrefix(line: string): string {
  return line.replace(/^BLOCK\(\d+\)\s*/i, '');
}
