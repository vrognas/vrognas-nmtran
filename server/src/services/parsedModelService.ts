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

/** Abbreviated-code blocks where top-level `name = rhs` lines are extracted. */
const EQUATION_BLOCKS = new Set([
  '$PRED',
  '$PK',
  '$ERROR',
  '$DES',
  '$MIX',
  '$AES',
  '$AESINITIAL',
  '$INFN',
  '$CONTR',
]);

export function buildParsedModel(doc: TextDocument): ParsedModel {
  const lines = doc.getText().split('\n');
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

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const raw = lines[lineNum] ?? '';
    const code = stripComment(raw).trimEnd();
    const trimmed = code.trim();
    if (!trimmed) continue;

    const recordMatch = /^\$(\w+)/.exec(trimmed);
    if (recordMatch && recordMatch[1]) {
      const blockName = '$' + recordMatch[1].toUpperCase();
      currentBlock = EQUATION_BLOCKS.has(blockName) ? blockName : null;
      continue;
    }

    if (!currentBlock) continue;

    // Bare `name = rhs` — single identifier LHS, no indexing, no compound assignment.
    const assign = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(code);
    if (!assign || !assign[1] || assign[2] === undefined) continue;
    const name = assign[1];
    const rhs = assign[2];
    const value = evaluate(rhs, ctx);
    equations.push({ name, rhs, block: currentBlock, line: lineNum, value });
    if (value !== undefined) ctx.bindings.set(name.toUpperCase(), value);
  }

  return equations;
}
