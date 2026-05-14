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

/**
 * Split a document's text into lines, normalising CRLF and LF endings.
 * Use this instead of `text.split('\n')` so trailing `\r` characters
 * don't leak into per-line regex / position math on Windows-encoded files.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Identifier characters per NMTRAN abbreviated-code lexer
 * (`[A-Za-z0-9_]`). Used by word-at-cursor lookups.
 */
function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

/** Walk left from `offset` while characters are identifier chars; returns the start index. */
export function findWordStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && isIdentChar(text[i - 1] || '')) i--;
  return i;
}

/** Walk right from `offset` while characters are identifier chars; returns the exclusive end index. */
export function findWordEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && isIdentChar(text[i] || '')) i++;
  return i;
}

/** Strip a leading `\s*$RECORD\s*` prefix. */
export function stripRecordPrefix(line: string): string {
  return line.replace(/^\s*\$\w+\s*/i, '');
}

/** Strip a leading `BLOCK(n)\s*` prefix. */
export function stripBlockPrefix(line: string): string {
  return line.replace(/^BLOCK\(\d+\)\s*/i, '');
}

/**
 * Split `content` on commas that are NOT inside parentheses. Empty
 * components are preserved — `"low,,up"` → `["low", "", "up"]` — because
 * NMTRAN `(lower,,upper)` (omitted init) is syntactically meaningful.
 */
export function splitTopLevelCommas(content: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of content) {
    if (ch === '(') {
      depth++;
      buf += ch;
    } else if (ch === ')') {
      depth--;
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}
