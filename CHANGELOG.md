# Changelog

All notable changes to vscode-nmtran are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

## [0.4.34] - 2026-05-13

### Changed

Tier-B next-layer rework — `DefinitionService` no longer duplicates
`ParameterScanner`'s position-finding work. Routes through scanner output
directly; no behavior change. **-910 LOC** net (1111 deletions, 201 insertions).

* **Killed the parallel `scanCache`** in `DefinitionService` — the scanner
  already caches per-(uri,version); the wrapper just shadowed it.
* **Killed the `enhanceLocationsWithValuePositions` fill-in pass** plus its
  helper stack: `getParameterPositionInLine`,
  `calculateParameterPositionInBlock`, `findDiagonalElementPosition`,
  `findDiagonalElementInText`, `findParameterValuePosition`,
  `findThetaInitialValue`, `extractThetaExpressions`,
  `findInitialValueInBoundedExpression`, `findOmegaParameterValue`,
  `findSameKeywordPosition`. All ten functions duplicated logic the
  scanner already runs while emitting `ParameterLocation`.
* **Killed `countParametersInLine`** — replaced its callers with
  `allParams.filter(p => p.line === lineNum && p.type === type).length`.
* **`findSameReferenceLocation` rewritten** to walk backwards for the
  preceding non-SAME `$OMEGA BLOCK(n)` line, then look up its first
  emitted ETA in scanner output — instead of re-running the diagonal-
  finder on raw text.
* **`getParameterAtPosition` simplified.** Single decision tree: explicit
  `THETA(n)`/`ETA(n)`/`EPS(n)` reference → param whose value range covers
  the cursor → first param on the line → `$RECORD` header fallback to the
  first emitted param of that type. Replaces the old definition-line /
  continuation-line split plus the cursor-position helper.
* **`DefinitionService` LOC: ~1180 → ~410.** No client-visible change to
  Go-to-Definition or Find-References output.

Test churn: 4 `block-highlighting.test.ts` cases that poked deleted
private methods replaced with 3 public-API tests covering the same
spacing variants through `provideDefinition`. 3 stub tests in
`definitionService.test.ts` (BLOCK(3) diagonals, SAME reference, bounded
THETA) gained real assertions. Net: 255 → 251 server tests, all green;
e2e 5/5.

## [0.4.33] - 2026-05-13

### Changed

Tier-A next-layer cleanups — six focused refactor commits, no behavior
change. 260 → 255 server tests (5 dropped tests targeted code that was
deleted along with its callers).

* **`PerformanceMonitor` trimmed 160 → 33 LOC.** Only `.measure()` was
  reached from production (one call site in `definitionService`); the
  ring-buffer indexing was half-implemented and never wrapped;
  `getStats` / `logStats` / `setEnabled` / `clear` all unused. Dropped
  the unused `metadata` arg from the call site too.
* **`DocumentService.getLines` + `linesCache` + `getAllDocumentUris`**
  removed — both methods imported only by their own test file;
  `linesCache` existed solely to back `getLines`.
* **`HoverService` SAME resolvers collapsed.** Two near-identical
  recursive walkers (`resolveSameKeyword` returning a formatted string,
  `resolveSameKeywordWithReference` returning `{value, originalIndex}`)
  merged into one `resolveSameOrigin` returning the latter; the caller
  formats the final string itself.
* **Misc service cleanups + `reservedVariables` migrated to
  `constants.ts`.** Dropped the `createParameterUsageRegex` alias in
  `definitionService` (use `createParameterReferenceRegex` directly);
  removed the dead `_baseParameterCount` parameter from
  `getParameterIndexFromCursorPosition`; `findUserVariableReferences`
  now uses `stripComment` (consistent with the post-Tier-2 sweep).
  `hoverService` dropped its inline `createControlRecordRegex` /
  `createParameterUsageRegex` factories (the latter duplicated the
  shared `createParameterReferenceRegex`). `reservedVariables` was a
  dead `string[]` constant; it's now a `Record<string, string>` with
  the 7 NONMEM-7.6 entries, consumed by `getReservedVariableHover`.
* **`ScannerState` trimmed.** `blockMatrixSize`,
  `blockDiagonalsSeen`, `blockElements` were written-only after the
  Tier-3 validator extraction. Dropped; `BlockMatrixState` is now a
  `Pick<ScannerState, …>` of the two fields it really shares.
* **`validateControlRecords.ts` split.** Moved
  `validateContinuationMarkers` to `validators/continuationMarkers.ts`
  next to its siblings (return type now uses the shared
  `ValidationResult`). Moved `buildDocumentSymbols` to
  `services/documentSymbols.ts`. The leftover utility module now only
  does what its name says.

## [0.4.32] - 2026-05-13

### Changed

* **Diagnostics gate narrowed to `.mod` / `.ctl` only** (refines the
  0.4.31 `.lst`-only fix into an allow-list). The `nmtran` language
  is registered for many auxiliary NONMEM formats (`.lst`, `.modt`,
  `.ctl_dde`, `.dde`, `.scm`, `.res`, `.ext`, `.cov`, `.cor`, `.phi`,
  `.cnv`, `.grd`, `.shk`, `.shm`, `.smt`, `.rmt`, `.phm`, `.coi`) so
  they get syntax highlighting / hover / definition / completion /
  folding, but only true source files get user-surface validation.
  IMPORTANT: this gate is only for diagnostics — the public
  `nmtran/parsedModel` and `nmtran/parseModelText` LSP requests
  continue to work on every registered extension, so consumer
  extensions (e.g. positron-nonmem) can still parse `.lst` and other
  output files programmatically.

## [0.4.31] - 2026-05-13

### Fixed

* **No diagnostics in `.lst` files**: `.lst` (and similar NONMEM listing
  files) are registered as `nmtran` for syntax highlighting, but their
  content is narrative output — strings like "$ABBR DERIV2=NO" in
  prose were triggering "Did you mean $ABBREVIATED?" false-positives
  on read-only output. DiagnosticsService now early-returns for
  `.lst` URIs and clears any stale diagnostics on the document.

## [0.4.30] - 2026-05-13

### Changed

* **diagnosticsService**: collapsed 7 near-identical
  `if (!result.isValid) { for (const e of result.errors) { … push(Diagnostic literal) } }`
  blocks into two helpers (`toPositionalDiagnostic`,
  `toFileDiagnostic`) and a `pushPositional(diagnostics, result,
  severity?)` wrapper. Each validator call is now one line, severity
  is a parameter rather than a copy/paste, and
  `validateContinuationMarkers`'s inline-typed result flows through
  the same path via structural typing. -90 LOC net.
* **ParameterScanner.updateStateForControlRecord**: merged the
  OMEGA and SIGMA branches — they differed only in whether the
  parameter-array counter advances as ETA or EPS. One ternary covers
  the difference; the surrounding block-state setup runs once. -15 LOC.

260 server tests + 5 vscode-test e2e tests unchanged.

## [0.4.29] - 2026-05-13

### Changed

Tier-3 refactor: split the `ParameterScanner` god-class into a scanner
+ one module per validator. ParameterScanner.ts went from ~1250 LOC to
~760 LOC and now does one job — produce a `ParameterLocation[]`.

New layout under `server/src/`:

* `validators/types.ts` — shared `ValidationError` / `ValidationResult`.
* `validators/sequentialNumbering.ts` — pure check over the scanner output.
* `validators/parameterReferences.ts` — THETA(n)/ETA(n)/EPS(n)/ERR(n)
  cross-reference + unused-decl check.
* `validators/blockMatrixSyntax.ts` — `$OMEGA BLOCK(n)` / `$SIGMA
  BLOCK(n)` element-count + SAME validation.
* `validators/sameKeywordUsage.ts` — SAME outside BLOCK context.
* `validators/parameterBounds.ts` — THETA bound triples + OMEGA/SIGMA
  variance values (with their `extractBoundExpressions` / `isInfinity`
  / `parseNumericValue` / `extractSimpleParameterValues` helpers
  inlined per-validator).
* `validators/comIndices.ts` — `COM(i)` vs `$ABBREV COMRES+COMSAV`.
* `validators/infinityTokens.ts` — `INF`/`INFINITY`/`INFIN`/`INFTY`
  misuse outside `$THETA` bounds.
* `utils/errBinding.ts` — `resolveErrBinding` (also called by
  hoverService and definitionService for ERR → ETA/EPS resolution).

The diagnostics service now imports each validator by name; tests do
too. `ParameterScanner.scanDocument` and `ParameterScanner.clearCache`
remain the only externally-reached methods on the class. Two
stateful `RegExp.prototype` iteration loops became `for-of matchAll(...)`
along the way. 260 server tests + 5 vscode-test e2e tests unchanged.

## [0.4.28] - 2026-05-13

### Changed

Two follow-up consolidations after the Tier-2 sweep:

* **Shared NMTRAN regex patterns** moved to `server/src/utils/patterns.ts`.
  `ParameterScanner` and `definitionService` each had a private
  `PARAMETER_PATTERNS` constant with the same five regexes (`THETA` /
  `OMEGA` / `SIGMA` / `BLOCK` / `SAME`) and the same parameter-
  reference pattern (kept as a source string in one file, pre-
  compiled in the other). Both now spread from `RECORD_PATTERNS` +
  `BLOCK_RE` / `SAME_RE` and mint fresh `/g` instances via the
  shared `createParameterReferenceRegex()` factory. Existing
  `PARAMETER_PATTERNS.THETA` call sites (50+ across the two files)
  work unchanged.
* **`splitTopLevelCommas`** added to `utils/text.ts` and replaces
  `parsedModelService.splitBoundParts` and
  `ParameterScanner.splitBoundComponents`. Behavior unified on the
  preserve-empties contract so the NMTRAN `(lower,,upper)` (omitted
  init) form parses to 3 components either side, and a malformed
  `(low,init,up,)` now reports as 4 components in
  `validateSingleParameterBound` rather than being silently coerced
  to 3.

## [0.4.27] - 2026-05-13

### Changed

Tier-2 consolidations: duplicated text helpers and parallel regex math
collapsed to a single source of truth each.

* **`stripComment` shared helper** — three identical local copies
  (priorScanner / parsedModelService / definitionService) plus 17+
  inline `line.indexOf(';') / .substring(0, idx)` patterns across
  ParameterScanner, definitionService, and validateControlRecords now
  delegate to `server/src/utils/text.ts`. The two `indexOf(';')` sites
  that survive use the index as a *position* (offset-tracking
  boundary), not for stripping.
* **`stripRecordPrefix` / `stripBlockPrefix` shared helpers** — four
  call sites that peeled the `$RECORD` / `BLOCK(n)` prefix now
  compose from `utils/text.ts` instead of inlining the regexes. The
  position-tracking variants (those that need the match info) stay
  inline.
* **Dead PARAMETER_PATTERNS constants removed** —
  `CONTROL_RECORD`, `COMMENT`, `COMMENT_END`, `COMMENT_START`,
  `BLOCK_INLINE`, `OMEGA_BLOCK_PREFIX`, `SIGMA_BLOCK_PREFIX`,
  `BLOCK_PREFIX` were defined but no longer reached after the strip
  sweep.
* **Diagonal-position math** — `ParameterScanner.isBlockDiagonalPosition`
  (1-indexed boolean) was a parallel impl of
  `NMTRANMatrixParser.isDiagonalElement` (0-indexed `number | null`).
  Same triangular-number relationship, two implementations. Collapsed
  to one via delegation. priorScanner's stateful `blockRow` counter
  is a different concern (row-stream rather than random-access) and
  stays.

## [0.4.26] - 2026-05-13

### Removed

Dead-code sweep of the utility / factory layer. ~1550 LOC of source and
tests removed; remaining 260 server tests still green (down from 337
— the 77 dropped tests all targeted code that had no production
callers).

* **`server/src/parsers/parameterParser.ts`** — abandoned earlier-attempt
  parser, zero callers. File + `parsers/` directory removed.
* **`server/src/utils/parameterParser.ts`** (`ParameterParserFactory`) —
  parallel-universe parser, imported only by its own test file. 7
  static methods removed along with 144 LOC of tests.
* **`NMTRANMatrixParser`** trimmed to the two methods actually called
  from production code (`getDiagonalPosition`,
  `isDiagonalElement`). The 6 dead methods (`parseBlockValues`,
  `extractDiagonalElements`, `getTriangularMatrixSize`,
  `parseMatrixBlock`, `validateBlockMatrix`, `getMatrixCoordinates`)
  and the `MatrixElement` / `DiagonalPosition` interfaces are gone.
* **`ParameterValidator`** — `validateParameterLine` flagged "invalid
  characters" for `_`, `*`, `/`, `=`, `&` etc., which appear in
  essentially every realistic NMTRAN file; warnings went to the LSP
  console without blocking processing. `validateScannerState` checked
  invariants the calling code already guarantees. `validateNumericValue`
  had no callers. Both calls in `scanDocument`'s hot loop removed.
* **`ParameterFactory`** — `createLocation` and `resetBlockState` had
  no callers; `createScannerState` was inlined as a module-private
  function in `ParameterScanner.ts`. `factories/` directory removed.
* **`ErrorHandler`** — once `ParameterValidator` was gone, all callers
  were gone too. Speculative API (`logError`, `logDebug`,
  `handleException`, `createSafeResult`, `createSafeAsyncResult`,
  `wrap`, both static and instance variants) deleted.
* **`utils/validation.ts`** — four exported helpers
  (`isValidLineNumber`, `isValidCharPosition`, `isValidParameterIndex`,
  `sanitizeFilePath`) with no callers and an explicit coverage exclude
  hiding the fact.

## [0.4.25] - 2026-05-13

### Changed

* **`priorScanner.ts` cleanup** (pure refactor): replaced
  `kindForKeyword`'s unreachable chained-if dispatch with a lookup-table;
  dropped `extractCommentRaw` (1:1 wrapper for `extractComment`);
  removed the redundant `stripComment` call in `extractComment`; dropped
  the unused `KindState.blockHeaderLine` field; merged
  `consumeBlockRow`'s bounds check and `noUncheckedIndexedAccess` guard
  into one. No behavior change; 337 server tests still green.
* **LSP method-name constants** (`PARSED_MODEL_REQUEST`,
  `PARSE_MODEL_TEXT_REQUEST`) now exported from
  `client/src/parsedModelApi.ts` and used by `LanguageServerManager`.
  Eliminates magic-string drift within the client; the client and
  server still maintain parallel constants (no shared package yet) so
  cross-side drift must continue to be policed manually.

## [0.4.24] - 2026-05-13

### Added

* **`$PRIOR` fields exposed on client API**: `NmtranPriorDecl` interface
  and `thetaPriors`, `thetaPriorVariances`, `omegaPriors`, `omegaPriorDfs`,
  `sigmaPriors`, `sigmaPriorDfs` arrays added to `NmtranParsedModel` in
  `client/src/parsedModelApi.ts`. The server has been returning these
  since 0.4.23, but the client-side TypeScript type was stale so typed
  consumers couldn't see them.

### Changed

* **`nmtran/parseModelText` handler now generates unique URIs per call**
  (`embedded://lst/<counter>` instead of a fixed `embedded://lst`). This
  removes the 0.4.22 workaround in `ParameterScanner.scanDocument` that
  bypassed the cache for synthetic URIs — the scanner is back to
  unconditional caching keyed on `${uri}:${version}`. Cross-service
  coupling via URI-prefix convention is gone; the existing regression
  test was updated to match the new contract (distinct URIs per call).
* **`PARSE_MODEL_TEXT_REQUEST` constant** added next to
  `PARSED_MODEL_REQUEST` in `server/src/parsedModel.ts`; server handler
  uses the constant.

### Fixed

* **TypeScript strict-mode errors in `priorScanner.ts`** introduced in
  0.4.23 — `tsc -b` failed under `noUncheckedIndexedAccess`. All array
  index accesses now guarded; behavior unchanged (337 server tests still
  green).
* **`parseModelFromText` JSDoc**: corrected misleading "currently always
  returns a non-null object" — the server handler's `try/catch` returns
  null on parse exceptions, so the null path is real.

## [0.4.23] - 2026-05-12

### Added

* **$PRIOR records surfaced in `ParsedModel`** — new fields
  `thetaPriors`, `thetaPriorVariances`, `omegaPriors`, `omegaPriorDfs`,
  `sigmaPriors`, `sigmaPriorDfs` (each `PriorDecl[]`, sorted by 1-based
  parameter index). Empty arrays when the corresponding record is
  absent (most models). New module `server/src/services/priorScanner.ts`
  parses the six records — `$THETAP` / `$THETAPV` / `$OMEGAP` /
  `$OMEGAPD` / `$SIGMAP` / `$SIGMAPD` — independently of the main
  ParameterScanner so the prior parse is decoupled from the
  cross-reference machinery.

  Supported syntactic forms (per NM 7 docs + Gisleskog et al. 2002):
  - Scalar / vector: `$THETAP 1.0 FIX ; A` and `$THETAP (2.0 FIX) (2.0 FIX) (2.0 FIX) (2.0 FIX)`.
  - `BLOCK(N)` form for `$THETAPV` / `$OMEGAP` / `$SIGMAP` — lower-triangular
    rows; we surface the diagonal element of each row.
  - `BLOCK(N) SAME` advances the index counter so the matching `$OMEGAPD`
    aligns correctly with the OMEGA index range.
  - Multiple `$OMEGAPD` / `$SIGMAPD` scalars per record line — each
    becomes its own block's degrees-of-freedom.

  `$OMEGAPD` / `$SIGMAPD` scalars are expanded per-parameter so consumers
  can look up `omegaPriorDfs[i]` for any OMEGA(i) directly without
  re-deriving block boundaries. The Nth `$OMEGAPD` scalar applies to the
  Nth `$OMEGAP` block in source order.

  TNPRI form (normal-on-OMEGA via `$PRIOR TNPRI`) is NOT yet supported —
  it requires an external MSF reference and is rare in practice
  (Gisleskog et al. 2002, J Pharmacokinet Pharmacodyn).

  10 tests covering scalar / BLOCK / SAME / multi-value-per-line /
  $SIGMA forms + a 10-prior / 13-block real-world fixture.

## [0.4.22] - 2026-05-12

### Fixed

* **`parseModelFromText` cache collision**: `ParameterScanner.scanDocument`
  keyed its cache on `${uri}:${version}`, but the `nmtran/parseModelText`
  LSP handler hard-codes URI `embedded://lst` + version `1` for every
  call. Distinct embedded contents therefore shared the same cache key
  and the first-parsed result was served for every subsequent embedded
  call — positron-nonmem's Fit Inspector would show stale parameter
  counts (e.g. previously-opened `.lst` with 4 thetas / 4 omegas BLOCK
  would stick when the user switched to a `.lst` with 7 thetas + 1
  omega). Fix: skip the cache for synthetic `embedded://` URIs — they're
  single-shot parses anyway and don't benefit from caching. Two new
  regression tests pin both the cache-collision case and a smaller
  scenario exercising commented-`; $THETA` interleaved with active
  decls.

## [0.4.21] - 2026-05-06

### Added

* **`parseModelFromText(text)` API** added to the `activate()` return
  value (`NmtranApi`). Backed by a new `nmtran/parseModelText` LSP
  request that runs `buildParsedModel` over a synthetic in-memory
  document. Used by positron-nonmem to parse the embedded control
  stream out of a `.lst` so the Fit Inspector reflects the model AS
  RUN, not whatever the sibling `.mod` says now (the latter changes
  when the modeler iterates after a run, leaking forward into the
  inspector view of past runs).

## [0.4.20] - 2026-05-05

### Added

* **Inline `;<comment>` extracted as a `comment` field** on each
  `ThetaDecl` / `OmegaSigmaDecl` from the `nmtran/parsedModel` LSP
  request. Pirana convention: `$THETA 4.79 ; CL` → `comment: "CL"`.
  Multi-decl-per-line correctly assigns the comment only to the LAST
  decl on the line (NMTRAN spec: `;` runs to EOL). PsN runrecord `;;`
  excluded. Unblocks positron-nonmem's Fit Inspector parameter labels.

## [0.4.19] - 2026-05-03

### Fixed

* **`$OMEGA / $SIGMA BLOCK(n) SAME` no longer reports `null`** in
  `parsedModel.omegas` / `parsedModel.sigmas`. SAME lines have a
  non-numeric token at the parameterScanner-recorded location, so
  `parseFloat` returned NaN and serialised as `null`. Now post-processed:
  any non-finite-valued decl whose source line carries a `SAME` keyword
  inherits the most recent finite-valued decl's value. Multiple SAMEs
  in a row all resolve to the same anchor block.

## [0.4.18] - 2026-05-03

### Added

* **`line` field on `ThetaDecl` / `OmegaSigmaDecl`**. Each parameter declaration
  now carries the 0-based source line of its number token, alongside the
  existing `line` on `Equation`. Enables consumers (e.g. positron-nonmem's
  Variables-pane) to implement go-to-definition for `THETA(n)` /
  `OMEGA(n,n)` / `SIGMA(n,n)` rows without re-running ParameterScanner.

## [0.4.17] - 2026-05-03

### Added

* **`&` line-continuation support in `parsedModel.equations`**. Multi-line
  assignments like
  ```
  IOVCL = OCC1*ETA(3) + OCC2*ETA(4) +&
          OCC5*ETA(7) + ...
  ```
  are now collapsed into single logical lines before extraction, so the
  evaluator sees the full rhs and the captured `rhs` reads cleanly (whitespace
  runs collapsed). The `line` field on the resulting Equation points at the
  first physical line of the multi-line statement.

## [0.4.16] - 2026-05-03

### Added

* **F12 / Find References on user-defined variables** (LHS bindings inside
  `$PRED` / `$PK` / `$ERROR` / `$DES` / `$MIX` / `$AES` / `$AESINITIAL` /
  `$INFN` / `$CONTR` blocks). Cursor on `CL` in `V = CL + 1` now jumps to
  the line where `CL = …` is declared. "Find All References" lists every
  non-comment occurrence in the document. NONMEM indexed arrays
  (`THETA(n)` / `ETA(n)` / `EPS(n)` / `OMEGA(i,j)` / `SIGMA(i,j)`) keep
  using the existing parameter path; the user-variable fallback only fires
  when the parameter path returns null. Reserved keywords
  (`IF`/`THEN`/`ENDIF`/`AND`/…) are excluded.

## [0.4.15] - 2026-05-03

### Added

* **Intrinsic functions in the equation evaluator**: `LOG` (natural log per NONMEM),
  `LOG10`, `EXP`, `SQRT`, `ABS`, `SIN/COS/TAN` and inverse trigs, `MIN`, `MAX`,
  `MOD`, `INT`. Protective variants (`PLOG`, `PEXP`, etc.) map to the same
  behaviour. Lets `BCMS = LOG(0.120*1000/1628)` and similar real-model
  expressions resolve in `parsedModel.equations`.

### Fixed

* **Skip assignments inside `IF(...) THEN ... ENDIF` blocks**. Previously the
  evaluator captured every `name = rhs` line, including ones nested inside
  conditional blocks — so `F_FLAG` ended up with `value: 1` from the inner
  `F_FLAG = 1` line even though the unconditional value is 0. Tracker now
  ignores assignments while `ifDepth > 0`. Single-line `IF(...) X = Y` was
  already (incidentally) skipped because the line starts with `IF`, not a
  bare identifier.

## [0.4.14] - 2026-05-03

### Fixed

* **CRLF line endings broke `$INPUT` and `$DATA` extraction in `parsedModel`**:
  the regexes used `(.*)$` without the `m` flag — `.` doesn't consume `\r` and
  `$` (no `m`) won't match before `\r`, so on Windows-saved files the line
  silently failed. `buildParsedModel` now splits with `/\r?\n/` so individual
  line strings never carry trailing `\r`.

## [0.4.13] - 2026-05-03

### Fixed

* **Inline-after-record assignments**: `$PRED Y = THETA(1) + ETA(1) + EPS(1)` on a
  single line is now extracted correctly. Previous extractor consumed the `$PRED`
  token then `continue`d, missing the inline `Y = ...` payload. Affects any
  abbreviated-code block written compactly on one line.

## [0.4.12] - 2026-05-03

### Added

* **`NMTRAN: Show Parsed Model (Debug)` command**: dumps the `nmtran/parsedModel`
  response for the active file into a new JSON editor. Lets developers smoke-test
  the parser against real `.mod` files without going through a consumer extension.

## [0.4.11] - 2026-05-03

### Added

* **`equations` field on `ParsedModel`**: top-level `name = rhs` assignments inside
  `$PRED`/`$PK`/`$ERROR`/`$DES`/`$MIX` blocks are extracted and pre-evaluated under
  the typical-individual convention (THETA(n)→init, ETA(n)→0, EPS(n)→0,
  cross-equation references resolved in source order). Equations whose RHS uses
  unsupported syntax (function calls, `.GT.`/`.LT.` comparisons, IF/THEN, indexed
  LHS) carry `value: undefined` instead of failing.
* **Public extension API**: `activate()` now returns `{ getParsedModel(uri) }` so
  companion extensions can consume the parsed snapshot via
  `vscode.extensions.getExtension('vrognas.nmtran')?.activate()`.

## [0.4.10] - 2026-05-03

### Added

* **`nmtran/parsedModel` LSP request**: returns a structured snapshot of the active document's
  declared parameters — `{thetas, omegas, sigmas, dataFile, inputColumns}` with values, bounds,
  and FIX flags. Lets companion extensions (e.g. positron-nonmem) render context-aware views
  without re-implementing NMTRAN parsing. Diagonal-only for OMEGA/SIGMA in this cut; BLOCK
  off-diagonals and PRED/PK/ERROR equation lifting follow.

## [0.4.9] - 2026-04-22

### Added

* **`F_FLAG` reserved variable**: the likelihood/observation switch `F_FLAG` now highlights as `support.variable.reserved.other.nmtran`.
* **`PHI(x)` function**: the cumulative standard normal distribution function now highlights as `entity.name.function.nmtran` when called (`PHI(...)`); bare `PHI` and identifiers containing `PHI` (e.g. `MYPHI`) are not matched.
* **Grammar tokenizer tests**: new `grammar-reserved-words.test.ts` exercises the TextMate grammar via `vscode-textmate` + `vscode-oniguruma`, enabling real tokenizer-based assertions for scope names.

## [0.4.8] - 2026-04-21

### Added

* **COM(i) index diagnostic**: references to `COM(i)` are now validated against the `COMRES` + `COMSAV` size declared via `$ABBREV` / `$ABBR`. `COM(i)` references beyond the declared sum are flagged as errors, catching silent overflows into adjacent NMPRD data. No diagnostic is emitted when no declaration exists (declared-only enforcement).

## [0.4.7] - 2026-04-20

### Added

* **Reserved NONMEM diagnostic items**: 43 reserved diagnostic output names (`PRED`, `IPRED`, `CWRES`, `NPDE`, `OBJI`, etc.) now have dedicated syntax scope `support.variable.diagnostic.nmtran`, hover descriptions explaining each item, and context-aware completion suggestions inside `$TABLE` blocks (including abbreviations like `$TAB`). The full list includes all conditional/interaction/Monte-Carlo variants that NONMEM accepts without user definition.
* **`ETAS(...)` range syntax highlighting**: `$TABLE` eta-range forms like `ETAS(1:LAST)`, `ETAS(1 TO 10 BY 3)`, `ETAS(4:1 BY -2)`, and number-list forms now receive a dedicated scope (`support.function.eta-range.nmtran`).

## [0.4.6] - 2026-04-20

### Added

* **Infinity tokens**: all four NMTRAN infinity forms — `INF`, `INFINITY`, `INFIN`, `INFTY` — are now recognized in `$THETA` bound triples (previously only `INF`/`INFINITY`). `INFIN` and `INFTY` are prefix-matched forms accepted by NMTRAN 7.6.0.
* **Dedicated infinity scope**: a new `constant.numeric.infinity.nmtran` scope colors all four infinity tokens (optionally signed) so themes can distinguish them from regular constants.
* **Infinity misuse diagnostic**: using `INF`/`INFINITY`/`INFIN`/`INFTY` as identifiers in abbreviated-code blocks (`$PK`, `$PRED`, `$ERROR`, `$DES`, `$MIX`, `$AES`, `$AESINITIAL`, `$INFN`, `$CONTR`) is now flagged as an error, matching NMTRAN `ERROR 208 UNDEFINED VARIABLE`. Word-boundary matching prevents false positives on similar identifiers like `INFO`, `INFN`, `INFNTY`.

## [0.4.5] - 2026-04-20

### Added

* **Verbatim FORTRAN highlighting**: lines beginning with `"` now embed `source.fortran` for Fortran syntax highlighting (requires a Fortran grammar extension such as Modern Fortran; falls back to plain text otherwise). Verbatim lines also get a subtle background tint — lighter in dark mode, darker in light mode — to make embedded Fortran visually distinct from surrounding NMTRAN code.

## [0.4.4] - 2026-04-19

### Fixed

* **Case-insensitive parameter references**: lowercase `theta(n)`, `eta(n)`, `eps(n)`, `err(n)` are now detected as uses, matching NONMEM's case-insensitivity. Previously only uppercase matched, causing spurious "defined but never referenced" warnings on models using lowercase style.

## [0.4.3] - 2026-04-19

### Added

* **File extensions**: `.ctl_dde`, `.dde`, and `.res` are now recognized as NMTRAN files.

## [0.4.2] - 2026-04-19

### Fixed

* **BLOCK matrix off-diagonals**: negative covariance elements in `$OMEGA BLOCK(n)` / `$SIGMA BLOCK(n)` matrices are no longer flagged as "should generally be positive". Only diagonal elements (variances) require positive values; off-diagonals (covariances) are permitted to be negative. Fix also validates compact-form BLOCK values (e.g. `$OMEGA BLOCK(2) 0.1 0.05 0.2`), which were previously not validated at all.

## [0.4.1] - 2026-04-19

### Fixed

* **ERR(n) semantics**: `ERR(n)` now correctly resolves to `ETA(n)` in individual-data models (no `$SIGMA`) and `EPS(n)` in population models (`$SIGMA` present), per NONMEM Help Ch.8 ($ERROR). Previously always treated as `EPS(n)`, producing spurious "ERR(n) referenced but only 0 EPS parameters defined" on valid individual-data models. Applies to diagnostics, go-to-definition, and hover.
* **Grammar**: zero-count diagnostic now reads `"referenced but no X parameters defined"` instead of `"only 0 X parameters defined"`.

## [0.4.0] - 2026-04-15

### Added

* **Parameter children in outline**: `$THETA`, `$OMEGA`, `$SIGMA` symbols now show nested parameter children (THETA(1), ETA(1), EPS(1)) with inline comment labels as detail text

### Changed

* **Enhanced outline view**: migrated from `SymbolInformation` to `DocumentSymbol` API; outline now shows detail text (e.g. problem title, data file, estimation method), full-block ranges enable follow-cursor highlighting, sticky scroll, and breadcrumbs

## [0.3.1] - 2026-04-15

### Fixed

* **Minimap section headers**: control records no longer render as section headers in the minimap; removed redundant `$KEYWORD` folding markers since `FoldingRangeProvider` already handles folding

## [0.3.0] - 2026-04-09

### Added

* **Getting Started walkthrough**: 6-step onboarding walkthrough covering syntax highlighting, hover docs, go-to-definition, diagnostics, snippets, and formatting configuration

## [0.2.19] - 2026-03-26

### Changed

* **ParameterScanner caching**: version-keyed static scan cache eliminates redundant full-document scans across features
* **HoverService optimization**: scan once per hover instead of 3+ times; pass results through call chain
* **FormattingService**: format only the requested range instead of full document
* **PerformanceMonitor**: replace O(n) `shift()` with circular buffer
* **Reduced IPC logging**: removed 50+ verbose log messages per validation cycle; guard remaining logs behind debug check

### Fixed

* **Global regex state contamination**: factory functions for `/g`-flag regexes in HoverService; consistent `lastIndex` reset in ParameterScanner
* **DefinitionService cache**: evict stale version entries; clean up on document close
* **Resource leaks**: register LanguageClient as disposable, remove unused `.clientrc` file watcher, clear timeouts on shutdown
* **ErrorHandler**: removed `fn.toString()` heuristic that breaks with esbuild bundling
* **Settings cache**: stop invalidating settings on every format request
* **Logger**: hoist levels array to static constant

## [0.2.18] - 2026-02-05

### Fixed

* **Memory Leaks**: Fixed potential memory leaks in client and server
  - Configuration change handler now properly disposed via context.subscriptions
  - Document settings cache now cleared when documents close

## [0.2.17] - 2026-02-04

### Changed

* **Test Framework Migration**: Migrated server tests from Jest to Vitest
  - Replaced Jest with Vitest v3.0.0 for faster test execution
  - Added @vitest/coverage-v8 for coverage reporting
  - Created `vitest.config.ts` with 80% coverage thresholds
  - Removed Jest dependencies (`jest`, `ts-jest`, `@types/jest`)

* **Test Type Safety**: Added typed mock infrastructure
  - Created `mocks/mockConnection.ts` with `MockConnection` type and factory
  - Replaced all `any` typed mocks with proper TypeScript types
  - Added `getHoverValue()` helper for type-safe hover content extraction
  - Zero ESLint warnings in test files (was 24)

### Added

* **DocumentService Tests**: New comprehensive test suite for document caching
  - LRU eviction behavior tests
  - Cache statistics tests

### Fixed

* **Package Size**: Improved `.vscodeignore` to exclude dev files from vsix
  - Excluded tsconfig files, tsbuildinfo, vitest config
  - Excluded package-lock.json files and test runners
  - Reduced package to 15 essential files

## [0.2.16] - 2026-02-03

### Changed

* **TypeScript Configuration**: Consolidated tsconfig with shared base config
  - Created `tsconfig.base.json` with unified strict settings
  - Upgraded target from ES2020 to ES2022
  - Added stricter checks: `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`
  - Added `forceConsistentCasingInFileNames`, `incremental`, `esModuleInterop`
  - Client and server now extend base config for consistency

### Fixed

* **Dead Code Removal**: Removed unused variables and methods flagged by stricter checks

## [0.2.15] - 2026-02-03

### Fixed

* **Snippet Syntax**: Fixed VSCode warning about confusing snippet variables and placeholders
  - Corrected extra brace in Surge model snippet (`THETA({${3:...})` → `THETA(${3:...})`)
  - Fixed `$TM_FILENAME_BASE` variable syntax in FOCEI snippet
  - Escaped literal `$TABLE` in Xpose TABLEs snippet comment

## [0.2.14] - 2026-02-03

### Changed

* **ESLint Migration**: Upgraded from ESLint v8 to v9 with flat config format (eslint.config.mjs)
* **eslint**: Updated from v8.57.0 to v9.18.0
* **typescript-eslint**: Migrated from separate @typescript-eslint/* packages to unified typescript-eslint v8.38.0

### Fixed

* **Security Vulnerabilities**: Resolved all npm audit vulnerabilities across root, client, and server packages

### Security

* **brace-expansion**: Patched ReDoS vulnerability
* **diff**: Patched DoS vulnerability in parsePatch/applyPatch
* **js-yaml**: Patched prototype pollution vulnerability

### Changed

* **Package Exclusions**: Improved .vscodeignore to exclude dev files from vsix package

## [0.2.13] 2 Aug, 2025

### Added

* **NONMEM 7.6.0 Support**: Added function highlighting for new NONMEM 7.6.0 functions (PLOG, PEXP, PSQRT, PSIGN, PSIND, PCOSD, PSIND1, PCOSD1)
* **Parameter Bounds Validation**: Comprehensive validation for THETA, OMEGA, and SIGMA parameter bounds syntax
* **Continuation Marker Validation**: Proper validation of `&` continuation characters in NMTRAN code
* **BLOCK Matrix Validation**: Enhanced validation for BLOCK matrix syntax in OMEGA and SIGMA records
* **NMTRAN Parameter Examples**: Added comprehensive parameter syntax reference examples for documentation
* **ERR/EPS Equivalence**: Full support for ERR() as synonym for EPS() parameters throughout the extension

### Enhanced

* **Syntax Highlighting**: Improved highlighting for generated subroutines (ADVAN/TRANS combinations)
* **Performance Optimization**: Enhanced ERR/EPS equivalence processing for better responsiveness
* **FormattingService**: Refactored for improved maintainability and code organization
* **Error Handling**: Added structured error context and enhanced parameter validation utilities
* **Test Coverage**: Comprehensive test suites for NONMEM 7.6.0 features, edge cases, and validation scenarios
* **Code Organization**: Better utility class structure and improved parameter scanning architecture

### Fixed

* **Parameter Bounds**: Resolved OMEGA/SIGMA parameter bounds validation edge cases
* **THETA Hover**: Fixed hover functionality for THETA parameters in complex syntax scenarios
* **TypeScript Compliance**: Resolved strict mode compliance issues for reliable builds
* **Test Reliability**: Fixed various test cases and TypeScript compilation errors
* **Build Management**: Added dist/ directory to .gitignore for cleaner repository state
* **Code Quality**: Fixed unused parameter lint error in ParameterScanner service

### Updated

* **Reserved Variables**: Updated for NONMEM 7.6.0 compatibility
* **Documentation**: Enhanced CLAUDE.md, MAINTENANCE.md, and ARCHITECTURE.md with current practices
* **Development Tools**: Improved pre-release scripts and build configuration

## [0.2.12] 31 Jul, 2025

### Enhanced

* **Architecture Overhaul**: Refactored extension to service-based architecture with proper dependency injection
* **Modern Bundling**: Implemented ESBuild bundling for improved performance and reliable dependency packaging
* **Configuration Management**: Added centralized configuration service with user-configurable debug settings
* **Structured Logging**: Professional logging service with configurable levels and consistent formatting
* **Code Quality**: Comprehensive improvements across maintainability, readability, performance, and testability
* **Modular Design**: Extracted features into dedicated services (folding, language server, parameter parsing)
* **TypeScript Strict Mode**: Enhanced type safety with proper null checking and strict compilation
* **Error Handling**: Improved error handling and recovery throughout the extension

### Fixed

* **TypeScript Compilation**: Fixed strict mode errors in parameter parser for reliable GitHub CI builds
* **Dependency Updates**: Updated TypeScript ESLint packages to v8.x for better code quality enforcement
* **Import Statements**: Converted legacy require() calls to modern ES6 imports for better bundling
* **ESLint Configuration**: Enhanced rules to properly handle unused variables and caught errors

### Updated

* **@typescript-eslint/eslint-plugin**: Updated from v6.21.0 to v8.38.0
* **@typescript-eslint/parser**: Updated from v6.21.0 to v8.38.0  
* **@types/vscode**: Updated from v1.80.0 to v1.102.0
* **@types/node**: Updated from v20.19.9 to v22.10.2

## [0.2.11] 31 Jul, 2025

### Fixed

* Bugfix

## [0.2.10] 31 Jul, 2025

### Fixed

* **Extension Activation**: Fixed TypeScript compilation error that prevented extension from activating properly
* **Go to Definition**: Resolved "Cannot find module 'vscode-languageclient/node'" error that blocked parameter navigation features

## [0.2.9] 30 Jul, 2025

### Enhanced

* **Improved Parameter Navigation**: Enhanced precision and reliability for THETA, ETA, and EPS parameter navigation
* **Precise Value Positioning**: Go to Definition now points to exact parameter values (e.g., initial values in bounded THETA syntax)
* **SAME Constraint Support**: Multiple definition locations for OMEGA SAME constraints showing both declaration and referenced value
* **Performance Optimization**: Added document parsing cache with automatic cleanup for faster repeated operations
* **Type Safety**: Improved TypeScript typing with ParameterInfo, CharacterRange, and ParameterType definitions
* **Code Quality**: Unified ETA/OMEGA and EPS/SIGMA handling, removed unused code, consolidated patterns

## [0.2.8] 29 Jul, 2025

### Added

* **NMTRAN Parameter Navigation**: Go to Definition and Find All References support for THETA, ETA, and EPS parameters
* Right-click on `THETA(1)` → "Go to Definition" jumps to corresponding `$THETA` line
* Right-click on `THETA(1)` or `$THETA` definition → "Find All References" shows all parameter usages
* Support for BLOCK syntax in `$OMEGA` and `$SIGMA` parameter counting

## [0.2.6] 29 Jul, 2025

* Smoother user experience with debounced diagnostics (500ms delay) to prevent excessive validation
* Significantly better performance with large NMTRAN files through LSP incremental sync
* Added TypeScript strict features: Better code quality and fewer runtime errors
* Better memory management with proper cleanup

## [0.2.5] 26 Jul, 2025

* Bugfix auto-release

## [0.2.4] 26 Jul, 2025

* Initiate Claude Code
* Refactor server to service-based architecture
* Add ESLint with TypeScript support and clean up server code

## [0.2.3] 19 Dec, 2024

### Changed

* Refactored validation logic for better maintainability
* Updated snippet placeholder syntax for improved usability
* Enhanced performance through code optimizations
* Improved overall code maintainability

## [0.2.2] 10 Oct, 2024

### Changed

* Optimized performance for better extension responsiveness

## [0.2.1] 10 Oct, 2024

### Added

* Additional code snippets for common NM-TRAN patterns
* Syntax highlighting support for `VARCALC` option in `$TABLE` records

## [0.2.0] 5 Sep, 2024

### Changed

* Syntax-highlighting overhaul
* Added test and demo model code
* Updates to documentation
* New logo

## [0.1.6] 1 Sep, 2024

### Changed

* Minor bug fixes and stability improvements

## [0.1.5] 13 Jul, 2023

### Added

* Expanded collection of code snippets for common NM-TRAN patterns

## [0.1.4] 13 Jul, 2023

### Added

* More snippets

## [0.1.3] 13 Jul, 2023

### Fixed

* Updated underlying framework for better stability and performance

## [0.1.2] 13 Jul, 2023

### Added

* Code folding support for control records

## [0.1.1] 13 Jul, 2023

### Added

* Added snippets demonstration GIF to documentation

### Removed

* Removed changelog section from README to maintain single source of truth

## [0.1.0] 13 Jul, 2023

### Added

* Code snippets for PREDPP subroutines (ADVANs)

## [0.0.4] 13 Jul, 2023

### Added

* Word pattern matching for improved syntax highlighting

### Fixed

* Enhanced exponentiation operator highlighting
* Improved auto-closing behavior for symbol pairs

### Removed

* Removed duplicate extension category from marketplace listing

## [0.0.3] 12 Jul, 2023

### Changed

* Updated README with improved documentation and examples

## [0.0.2] 12 Jul, 2023

### Added

* Added extension logo for marketplace presence

## [0.0.1] 12 Jul, 2023

### Added

* Initial release of the extension
