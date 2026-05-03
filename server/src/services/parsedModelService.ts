/**
 * parsedModelService — builds a ParsedModel snapshot from a TextDocument.
 *
 * Reuses ParameterScanner for THETA/ETA/EPS location discovery; reads
 * the actual numeric values at those ranges and folds in $INPUT/$DATA
 * tokens. Out of scope for the initial cut: PRED/PK/ERROR equation
 * lifting, BLOCK off-diagonals, $TABLE columns, $ESTIMATION metadata.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParameterScanner, ParameterLocation } from './ParameterScanner';
import {
  ParsedModel,
  ThetaDecl,
  OmegaSigmaDecl,
  Equation,
} from '../parsedModel';
import { evaluate, EvalContext } from './nmtranExpression';
import { ABBREVIATED_CODE_BLOCKS } from '../constants';

export function buildParsedModel(doc: TextDocument): ParsedModel {
  // Split on either LF or CRLF so individual line strings never carry a
  // trailing \r. Without this, regexes anchored with `$` fail to match on
  // CRLF files because `.` doesn't consume \r and `$` (no `m` flag) won't
  // match before \r.
  const lines = doc.getText().split(/\r?\n/);
  const locations = ParameterScanner.scanDocument(doc);

  const thetas = locations.filter((l) => l.type === 'THETA').map((l) => buildTheta(l, lines));
  const omegas = locations.filter((l) => l.type === 'ETA').map((l) => buildOmegaSigma(l, lines));
  const sigmas = locations.filter((l) => l.type === 'EPS').map((l) => buildOmegaSigma(l, lines));

  const equations = extractEquations(lines, { thetas, omegas, sigmas });

  return {
    dataFile: extractDataFile(lines),
    inputColumns: extractInputColumns(lines),
    thetas,
    omegas,
    sigmas,
    equations,
  };
}

/** First non-comment $DATA token, or null if no $DATA record. */
function extractDataFile(lines: string[]): string | null {
  for (const raw of lines) {
    const code = stripComment(raw);
    const m = /^\s*\$DATA\s+(\S+)/i.exec(code);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Whitespace-separated tokens after $INPUT (first occurrence only). */
function extractInputColumns(lines: string[]): string[] {
  for (const raw of lines) {
    const code = stripComment(raw);
    const m = /^\s*\$INPUT\s+(.*)$/i.exec(code);
    if (m && m[1]) return m[1].trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

function buildTheta(loc: ParameterLocation, lines: string[]): ThetaDecl {
  const text = sliceLocation(loc, lines);
  const fix = hasFixRange(loc, lines);
  if (text.startsWith('(')) {
    const parts = splitBoundParts(text.slice(1, -1)).map((p) => p.trim());
    const nums = parts.map(parseFloatOrUndef);
    if (parts.length === 1) {
      return { index: loc.index, init: nums[0]!, fix };
    }
    if (parts.length === 2) {
      return { index: loc.index, init: nums[1]!, lower: nums[0]!, fix };
    }
    return {
      index: loc.index,
      init: nums[1] ?? NaN,
      lower: nums[0]!,
      upper: nums[2]!,
      fix,
    };
  }
  return { index: loc.index, init: parseFloat(text), fix };
}

function buildOmegaSigma(loc: ParameterLocation, lines: string[]): OmegaSigmaDecl {
  return {
    index: loc.index,
    value: parseFloat(sliceLocation(loc, lines)),
    fix: hasFixRange(loc, lines),
  };
}

function sliceLocation(loc: ParameterLocation, lines: string[]): string {
  const line = lines[loc.line] ?? '';
  if (loc.startChar !== undefined && loc.endChar !== undefined) {
    return line.slice(loc.startChar, loc.endChar);
  }
  return line.trim();
}

/** A FIX keyword landed on or near this parameter (ParameterScanner records it in additionalRanges). */
function hasFixRange(loc: ParameterLocation, lines: string[]): boolean {
  if (!loc.additionalRanges?.length) return false;
  for (const r of loc.additionalRanges) {
    const lineNum = r.line ?? loc.line;
    const text = (lines[lineNum] ?? '').slice(r.startChar, r.endChar);
    if (/^FIX(ED)?$/i.test(text)) return true;
  }
  return false;
}

function stripComment(line: string): string {
  const idx = line.indexOf(';');
  return idx === -1 ? line : line.slice(0, idx);
}

/** Split bound expression on top-level commas; preserves empty middle-component (low,,up). */
function splitBoundParts(content: string): string[] {
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

function parseFloatOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = parseFloat(t);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Walk lines in source order, track which abbreviated-code block we're in,
 * and capture `name = rhs` assignments. Each captured equation gets
 * pre-evaluated against prior bindings so consumers can render values
 * without re-implementing the evaluator.
 */
/**
 * Collapse NMTRAN `&`-continuation lines into single logical lines.
 * A non-comment line ending in `&` continues onto the next; we keep
 * joining until we hit a line whose code-portion doesn't end in `&`.
 * The returned `line` is the first physical line of the join chain so
 * downstream consumers can still anchor diagnostics / hovers correctly.
 */
function joinContinuations(lines: string[]): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let i = 0;
  while (i < lines.length) {
    const startLine = i;
    let buf = lines[i] ?? '';
    while (true) {
      const code = stripComment(buf).trimEnd();
      if (!code.endsWith('&')) break;
      // Drop the trailing `&` (and the comment, since continuation discards
      // anything after the `&` token), splice in the next physical line.
      const trimmed = code.slice(0, -1).trimEnd();
      i++;
      if (i >= lines.length) {
        buf = trimmed; // trailing `&` with no successor — accept as-is
        break;
      }
      buf = trimmed + ' ' + (lines[i] ?? '');
    }
    out.push({ text: buf, line: startLine });
    i++;
  }
  return out;
}

function extractEquations(
  lines: string[],
  decls: { thetas: ThetaDecl[]; omegas: OmegaSigmaDecl[]; sigmas: OmegaSigmaDecl[] },
): Equation[] {
  const ctx: EvalContext = {
    thetas: new Map(decls.thetas.map((t) => [t.index, t.init])),
    omegas: new Map(decls.omegas.map((o) => [o.index, o.value])),
    sigmas: new Map(decls.sigmas.map((s) => [s.index, s.value])),
    bindings: new Map(),
  };

  const equations: Equation[] = [];
  let currentBlock: string | null = null;
  // IF(...) THEN ... ENDIF blocks are runtime-conditional — assignments
  // inside them depend on input data and shouldn't be lifted as
  // unconditional values. Track nesting depth and skip captures while > 0.
  let ifDepth = 0;

  // Collapse `&`-continuation lines into single logical lines first. The
  // line number recorded on the resulting Equation points at the first
  // physical line of the multi-line statement.
  const logical = joinContinuations(lines);

  for (const { text: raw, line: lineNum } of logical) {
    const code = stripComment(raw).trimEnd();
    if (!code.trim()) continue;

    // A line may start with a $RECORD keyword AND carry an inline assignment
    // afterwards (e.g. `$PRED Y = THETA(1) + ETA(1) + EPS(1)`). Capture the
    // record (if any) and use whatever follows as the assignment text.
    const recordMatch = /^\s*(\$\w+)\s*(.*)$/.exec(code);
    let assignmentText: string;
    if (recordMatch && recordMatch[1] !== undefined && recordMatch[2] !== undefined) {
      const blockName = recordMatch[1].toUpperCase();
      currentBlock = ABBREVIATED_CODE_BLOCKS.has(blockName) ? blockName : null;
      assignmentText = recordMatch[2];
      ifDepth = 0; // crossing a record boundary closes any dangling IF context
    } else {
      assignmentText = code;
    }

    if (!currentBlock) continue;

    // IF/THEN/ENDIF tracking. Single-line `IF(...) X = Y` form has no THEN,
    // so it doesn't open a block — it's also not captured by the assignment
    // regex below because the line starts with `IF`, not an identifier+`=`.
    const stripped = assignmentText.trim();
    if (/^IF\s*\(.+\)\s*THEN\b/i.test(stripped)) {
      ifDepth++;
      continue;
    }
    if (/^ENDIF\b/i.test(stripped) || /^END\s*IF\b/i.test(stripped)) {
      if (ifDepth > 0) ifDepth--;
      continue;
    }
    if (ifDepth > 0) continue;

    if (!assignmentText.trim()) continue;

    // Bare `name = rhs` — single identifier LHS, no indexing, no compound assignment.
    const assign = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(assignmentText);
    if (!assign || !assign[1] || assign[2] === undefined) continue;
    const name = assign[1];
    // Collapse runs of whitespace so joined-from-continuation rhs strings
    // read cleanly (`A +    B` -> `A + B`). Evaluator already ignores
    // whitespace; this is purely for display.
    const rhs = assign[2].replace(/\s+/g, ' ');
    const value = evaluate(rhs, ctx);
    equations.push({ name, rhs, block: currentBlock, line: lineNum, value });
    if (value !== undefined) ctx.bindings.set(name.toUpperCase(), value);
  }

  return equations;
}
