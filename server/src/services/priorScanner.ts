/**
 * priorScanner — extract `$PRIOR`-subroutine declarations from an
 * NM-TRAN control stream.
 *
 * Supported records (NWPRI scheme per the NM 7 docs; TNPRI is currently
 * NOT supported — it requires an MSF reference and is rare in practice
 * per Gisleskog et al. 2002, J Pharmacokinet Pharmacodyn):
 *
 *   `$THETAP`    prior MEANS for THETA (normal prior)
 *   `$THETAPV`   prior variance-covariance for THETA; diagonal-form or
 *                BLOCK(n) — we keep the diagonal elements only (the
 *                inspector surfaces per-parameter PV; off-diagonal
 *                correlation would need its own UI we don't have yet)
 *   `$OMEGAP`    prior MODE for OMEGA (inverse-Wishart prior); same
 *                shape as `$OMEGA` (singletons + BLOCK(n) + SAME)
 *   `$OMEGAPD`   prior DEGREES OF FREEDOM for OMEGA — scalar per
 *                $OMEGAP block; weights the prior's informativeness
 *   `$SIGMAP`    analogous to `$OMEGAP`
 *   `$SIGMAPD`   analogous to `$OMEGAPD`
 *
 * Returned shape: per-kind `Map<paramIndex, PriorEntry>`. For
 * `$OMEGAPD`/`$SIGMAPD` the df is expanded to one entry per parameter
 * index covered by the corresponding block — consumer can look up by
 * any OMEGA(i) directly without re-deriving block boundaries.
 *
 * Pure / vscode-free / no IO — single text in, six Maps out.
 */

export interface PriorEntry {
  value: number;
  fix: boolean;
  line: number;
  comment?: string;
}

export interface ParsedPriors {
  thetaPriors: Map<number, PriorEntry>;
  thetaPriorVariances: Map<number, PriorEntry>;
  omegaPriors: Map<number, PriorEntry>;
  /** Per-OMEGA-index df: the df of the block this index lives in. */
  omegaPriorDfs: Map<number, PriorEntry>;
  sigmaPriors: Map<number, PriorEntry>;
  /** Per-SIGMA-index df. */
  sigmaPriorDfs: Map<number, PriorEntry>;
}

type Kind = 'thetaP' | 'thetaPV' | 'omegaP' | 'omegaPD' | 'sigmaP' | 'sigmaPD';

const RECORD_RE = /^\s*\$([A-Za-z]+)\b/;
const BLOCK_RE = /\bBLOCK\s*\(\s*(\d+)\s*\)/i;
const SAME_RE = /\bSAME\b/i;
const FIX_RE = /\b(FIX|FIXED)\b/i;
const NUMERIC_TOKEN_RE = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;

function kindForKeyword(kw: string): Kind | null {
  const up = kw.toUpperCase();
  // Match longest first — $THETAPV / $OMEGAPD before $THETAP / $OMEGAP.
  if (up === 'THETAPV' || up === 'THP') return up === 'THETAPV' ? 'thetaPV' : null;
  if (up === 'THETAPV') return 'thetaPV';
  if (up === 'THETAP') return 'thetaP';
  if (up === 'OMEGAPD') return 'omegaPD';
  if (up === 'OMEGAP') return 'omegaP';
  if (up === 'SIGMAPD') return 'sigmaPD';
  if (up === 'SIGMAP') return 'sigmaP';
  return null;
}

/**
 * Per-kind context — tracks the current record's block-form state +
 * the global counter for the kind, so a `BLOCK(3)` records its 3
 * diagonal values across 3 successive index slots.
 */
interface KindState {
  /** 1-based next parameter index to assign. */
  nextIdx: number;
  /** When inside a BLOCK(n), the number of rows still to consume. */
  blockRemaining: number;
  /** Current block's row counter (1-based; reset on each new BLOCK). */
  blockRow: number;
  /** FIX flag inherited from the BLOCK header line. */
  blockFix: boolean;
  /** Line number of the BLOCK header (for diagnostics). */
  blockHeaderLine: number;
}

/** Records the block-membership of each parameter for *P kinds — needed to map *PD scalars to per-parameter dfs. */
interface BlockMembership {
  /** Per-block: 1-based start index, size, and the line number of the header. */
  blocks: { startIdx: number; size: number; line: number }[];
}

/**
 * Extract priors from the lines of an NM-TRAN control stream. Returns
 * empty maps for kinds whose records are absent.
 */
export function extractPriors(text: string): ParsedPriors {
  const lines = text.split(/\r?\n/);
  const out: ParsedPriors = {
    thetaPriors: new Map(),
    thetaPriorVariances: new Map(),
    omegaPriors: new Map(),
    omegaPriorDfs: new Map(),
    sigmaPriors: new Map(),
    sigmaPriorDfs: new Map(),
  };
  const omegaBlocks: BlockMembership = { blocks: [] };
  const sigmaBlocks: BlockMembership = { blocks: [] };
  // Distinct counters per kind — $THETAP, $THETAPV, $OMEGAP, $SIGMAP
  // each have their own 1-based parameter index. $OMEGAPD and $SIGMAPD
  // are scalar-per-block; we record them in insertion order and align
  // to *P blocks at the end.
  const stateByKind: Record<Kind, KindState> = {
    thetaP: { nextIdx: 1, blockRemaining: 0, blockRow: 0, blockFix: false, blockHeaderLine: -1 },
    thetaPV: { nextIdx: 1, blockRemaining: 0, blockRow: 0, blockFix: false, blockHeaderLine: -1 },
    omegaP: { nextIdx: 1, blockRemaining: 0, blockRow: 0, blockFix: false, blockHeaderLine: -1 },
    sigmaP: { nextIdx: 1, blockRemaining: 0, blockRow: 0, blockFix: false, blockHeaderLine: -1 },
    omegaPD: { nextIdx: 1, blockRemaining: 0, blockRow: 0, blockFix: false, blockHeaderLine: -1 },
    sigmaPD: { nextIdx: 1, blockRemaining: 0, blockRow: 0, blockFix: false, blockHeaderLine: -1 },
  };
  // Collected $OMEGAPD / $SIGMAPD scalars in source order; expanded to
  // per-parameter dfs after the walk.
  const omegaDfScalars: PriorEntry[] = [];
  const sigmaDfScalars: PriorEntry[] = [];
  // Mode tracks "we are currently inside a $XXXP record's body"; cleared
  // on any new record header (whether $PRIOR-related or not).
  let mode: Kind | null = null;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const raw = lines[lineNum] ?? '';
    const trimmed = raw.trim();
    if (trimmed.startsWith(';') || trimmed.length === 0) continue;

    const recordMatch = trimmed.match(RECORD_RE);
    if (recordMatch) {
      const kw = recordMatch[1] ?? '';
      const newKind = kindForKeyword(kw);
      mode = newKind;
      if (newKind === null) continue;
      // Reset block context per record header.
      const st = stateByKind[newKind];
      const blockMatch = trimmed.match(BLOCK_RE);
      const isBlock = blockMatch !== null;
      const isSame = SAME_RE.test(trimmed);
      const isFix = FIX_RE.test(trimmed);
      st.blockRemaining = 0;
      st.blockRow = 0;
      st.blockFix = isFix;
      st.blockHeaderLine = lineNum;

      // Record block membership for *P kinds (used to expand *PD scalars).
      const blockSize = isBlock && blockMatch ? parseInt(blockMatch[1] ?? '1', 10) : 1;
      if (newKind === 'omegaP') {
        omegaBlocks.blocks.push({ startIdx: st.nextIdx, size: blockSize, line: lineNum });
      } else if (newKind === 'sigmaP') {
        sigmaBlocks.blocks.push({ startIdx: st.nextIdx, size: blockSize, line: lineNum });
      }

      if (isBlock) {
        st.blockRemaining = blockSize;
        st.blockRow = 0;
        // Any values on the header line itself are taken as the first
        // block row's values (rare but legal: `$OMEGAP BLOCK(2) 0.1 0 0.2`).
        const afterHeader = (trimmed
          .replace(/^\$\w+/, '')
          .replace(/BLOCK\s*\([^)]*\)/i, '')
          .replace(/\bFIX(ED)?\b/i, '')
          .replace(/\bSAME\b/i, '')
          .split(';')[0] ?? '')
          .trim();
        if (afterHeader.length > 0) {
          consumeBlockRow(afterHeader, lineNum, st, newKind, out, stripComment(raw));
        }
        // SAME with no values on the header — block rows are implicit
        // copies of the previous block; we don't track them for priors
        // since they share the previous block's values (NM resolves
        // internally). Advance nextIdx past the block-size to keep
        // index alignment with the .ext column count.
        if (isSame && afterHeader.length === 0) {
          st.nextIdx += blockSize;
          st.blockRemaining = 0;
        }
        continue;
      }
      // Non-BLOCK form on header line — `$THETAP 1.0 FIX ; A`.
      // NM-TRAN also accepts MULTIPLE values per record line, with or
      // without parens:
      //   `$THETAP (2.0 FIX) (2.0 FIX) (2.0 FIX) (2.0 FIX)` — 4 priors
      //   `$OMEGAPD 3 5 10` — 3 block DFs in one record
      // We extract all numeric tokens from the body and assign each to
      // successive indices.
      const afterHeader = (trimmed.replace(/^\$\w+/, '').split(';')[0] ?? '').trim();
      const cleaned = afterHeader.replace(/\bFIX(ED)?\b/gi, '').trim();
      const comment = extractComment(raw);
      const nums = parseNumbers(cleaned);
      if (newKind === 'omegaPD' || newKind === 'sigmaPD') {
        // *PD records are scalar-per-block — multiple scalars on one
        // record line each become their own block's df.
        for (const v of nums) {
          const entry: PriorEntry = {
            value: v,
            fix: isFix,
            line: lineNum,
            ...(comment ? { comment } : {}),
          };
          if (newKind === 'omegaPD') omegaDfScalars.push(entry);
          else sigmaDfScalars.push(entry);
        }
        continue;
      }
      // Singleton *P / *PV — one or more numeric values. Comment (when
      // present) attaches to the LAST value (NM-TRAN spec: `;` runs to
      // EOL so it follows every value before it on the line).
      for (let k = 0; k < nums.length; k++) {
        const n = nums[k];
        if (n === undefined) continue;
        const isLast = k === nums.length - 1;
        const entry: PriorEntry = {
          value: n,
          fix: isFix,
          line: lineNum,
          ...(isLast && comment ? { comment } : {}),
        };
        priorMapFor(newKind, out).set(st.nextIdx, entry);
        st.nextIdx += 1;
      }
      continue;
    }

    // Non-record line — body of a BLOCK record.
    if (mode === null) continue;
    const st = stateByKind[mode];
    if (st.blockRemaining > 0) {
      consumeBlockRow(trimmed, lineNum, st, mode, out, stripComment(raw));
    }
  }

  // Expand *PD scalars to per-parameter dfs using the recorded *P block
  // boundaries (Nth *PD matches Nth *P record).
  expandDfsToParams(omegaDfScalars, omegaBlocks, out.omegaPriorDfs);
  expandDfsToParams(sigmaDfScalars, sigmaBlocks, out.sigmaPriorDfs);

  return out;
}

function priorMapFor(kind: Kind, out: ParsedPriors): Map<number, PriorEntry> {
  if (kind === 'thetaP') return out.thetaPriors;
  if (kind === 'thetaPV') return out.thetaPriorVariances;
  if (kind === 'omegaP') return out.omegaPriors;
  if (kind === 'sigmaP') return out.sigmaPriors;
  // *PD use omegaPriorDfs / sigmaPriorDfs but get populated via
  // expandDfsToParams; this branch is unreachable for them.
  if (kind === 'omegaPD') return out.omegaPriorDfs;
  return out.sigmaPriorDfs;
}

/**
 * Consume one row of a BLOCK(n) body. For row K, only the diagonal
 * element (the K-th value on the row) is captured into the per-index
 * map — off-diagonals are skipped (the inspector renders one PV per
 * parameter; full covariance would need its own UI).
 */
function consumeBlockRow(
  bodyText: string,
  lineNum: number,
  st: KindState,
  kind: Kind,
  out: ParsedPriors,
  rawLine: string,
): void {
  st.blockRow += 1;
  const nums = parseNumbers(bodyText);
  if (nums.length === 0) return;
  // BLOCK row K has K lower-triangular values; the diagonal is the K-th.
  const diagIdx = st.blockRow - 1;
  if (diagIdx >= nums.length) {
    st.blockRemaining = Math.max(0, st.blockRemaining - 1);
    return;
  }
  const diagonal = nums[diagIdx];
  if (diagonal === undefined) {
    st.blockRemaining = Math.max(0, st.blockRemaining - 1);
    return;
  }
  const comment = extractCommentRaw(rawLine);
  const entry: PriorEntry = {
    value: diagonal,
    fix: st.blockFix,
    line: lineNum,
    ...(comment ? { comment } : {}),
  };
  // *PD never appears in BLOCK form — only *P / *PV use this path.
  if (kind === 'omegaPD' || kind === 'sigmaPD') return;
  priorMapFor(kind, out).set(st.nextIdx, entry);
  st.nextIdx += 1;
  st.blockRemaining = Math.max(0, st.blockRemaining - 1);
}

function expandDfsToParams(
  scalars: PriorEntry[],
  blocks: BlockMembership,
  out: Map<number, PriorEntry>,
): void {
  // Nth *PD scalar applies to the Nth *P block. If counts differ
  // (malformed model), expand only the overlap.
  const n = Math.min(scalars.length, blocks.blocks.length);
  for (let i = 0; i < n; i++) {
    const block = blocks.blocks[i];
    const df = scalars[i];
    if (!block || !df) continue;
    for (let k = 0; k < block.size; k++) {
      out.set(block.startIdx + k, df);
    }
  }
}

function parseNumbers(text: string): number[] {
  const matches = text.match(NUMERIC_TOKEN_RE);
  if (!matches) return [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

function extractComment(rawLine: string): string | undefined {
  const code = stripComment(rawLine);
  const semi = rawLine.indexOf(';', code.length);
  if (semi === -1) return undefined;
  // Skip `;;` (PsN runrecord) — these don't label decls.
  if (rawLine[semi + 1] === ';') return undefined;
  const t = rawLine.slice(semi + 1).trim();
  return t.length > 0 ? t : undefined;
}

function extractCommentRaw(rawLine: string): string | undefined {
  return extractComment(rawLine);
}

function stripComment(line: string): string {
  const idx = line.indexOf(';');
  return idx === -1 ? line : line.slice(0, idx);
}
