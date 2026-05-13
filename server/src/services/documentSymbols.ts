/**
 * Document outline builder — converts a scanned NMTRAN document into the
 * `DocumentSymbol[]` tree LSP clients render in the "Outline" view. Each
 * `$RECORD` becomes a top-level symbol covering the lines from its
 * declaration through to the line before the next `$RECORD`; when a
 * pre-scanned `ParameterLocation[]` is provided, individual THETA / ETA /
 * EPS declarations nest underneath `$THETA` / `$OMEGA` / `$SIGMA` as
 * Variable children with their inline-comment label (if any) as detail.
 */

import { DocumentSymbol, SymbolKind, TextDocument } from 'vscode-languageserver/node';
import type { ParameterLocation } from './ParameterScanner';
import {
  locateControlRecordsInText,
  getFullControlRecordName,
  extractControlRecordDetail,
} from '../utils/validateControlRecords';

const PARAM_TYPE_MAP: Record<string, ParameterLocation['type']> = {
  '$THETA': 'THETA',
  '$OMEGA': 'ETA',
  '$SIGMA': 'EPS',
};

export function buildDocumentSymbols(
  doc: TextDocument,
  parameterLocations?: ParameterLocation[],
): DocumentSymbol[] {
  const text = doc.getText();
  const matches = locateControlRecordsInText(text);
  const symbols: DocumentSymbol[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const fullName = getFullControlRecordName(match[0]);

    // selectionRange: just the $KEYWORD itself.
    const selectionStart = doc.positionAt(match.index);
    const selectionEnd = doc.positionAt(match.index + match[0].length);

    // range: from the $KEYWORD line to the line before the next $KEYWORD (or EOF).
    const rangeStart = { line: selectionStart.line, character: 0 };
    let rangeEnd: { line: number; character: number };
    const nextMatch = matches[i + 1];
    if (nextMatch) {
      const nextLine = doc.positionAt(nextMatch.index).line;
      const endLine = Math.max(nextLine - 1, rangeStart.line);
      const endLineStart = doc.offsetAt({ line: endLine, character: 0 });
      const nextNewline = text.indexOf('\n', endLineStart);
      let endLineLength =
        nextNewline === -1 ? text.length - endLineStart : nextNewline - endLineStart;
      if (endLineLength > 0 && text[endLineStart + endLineLength - 1] === '\r') {
        endLineLength--;
      }
      rangeEnd = { line: endLine, character: endLineLength };
    } else {
      rangeEnd = doc.positionAt(text.length);
    }

    // detail: rest of the keyword line, trimmed of comment + ellipsised.
    const lineEnd = text.indexOf('\n', match.index);
    const restOfLineRaw =
      lineEnd === -1
        ? text.slice(match.index + match[0].length)
        : text.slice(match.index + match[0].length, lineEnd);
    const restOfLine = restOfLineRaw.replace(/\r$/, '');
    const detail = extractControlRecordDetail(restOfLine);

    const symbol = DocumentSymbol.create(
      fullName,
      detail || undefined,
      SymbolKind.Module,
      { start: rangeStart, end: rangeEnd },
      { start: selectionStart, end: selectionEnd },
    );

    // Children: individual THETA / ETA / EPS declarations for parameter records.
    const expectedType = parameterLocations ? PARAM_TYPE_MAP[fullName] : undefined;
    if (expectedType && parameterLocations) {
      const children: DocumentSymbol[] = [];
      for (const loc of parameterLocations) {
        if (loc.type !== expectedType) continue;
        if (loc.line < rangeStart.line || loc.line > rangeEnd.line) continue;

        const childName = `${loc.type}(${loc.index})`;

        // Inline `;<comment>` as the child's detail (Pirana-style label).
        const paramLineStart = doc.offsetAt({ line: loc.line, character: 0 });
        const paramLineEnd = text.indexOf('\n', paramLineStart);
        const paramLineRaw =
          paramLineEnd === -1 ? text.slice(paramLineStart) : text.slice(paramLineStart, paramLineEnd);
        const paramLine = paramLineRaw.replace(/\r$/, '');
        const commentMatch = paramLine.match(/;(.+)/);
        const childDetail = commentMatch?.[1]?.trim() || undefined;

        const childRangeStart = { line: loc.line, character: 0 };
        const childRangeEnd = { line: loc.line, character: paramLine.length };
        const childSelStart = { line: loc.line, character: loc.startChar ?? 0 };
        const childSelEnd = { line: loc.line, character: loc.endChar ?? paramLine.length };

        children.push(
          DocumentSymbol.create(
            childName,
            childDetail,
            SymbolKind.Variable,
            { start: childRangeStart, end: childRangeEnd },
            { start: childSelStart, end: childSelEnd },
          ),
        );
      }
      if (children.length > 0) symbol.children = children;
    }

    symbols.push(symbol);
  }

  return symbols;
}
