- In all interactions and commit messages, be extremely concise and sacrifice grammar for the sake of concision.
- Do not write any code until you're fully ready to implement it.
- It's IMPORTANT for each implementation to begin with writing and reviewing tests BEFORE moving on to implementation (TDD test-driven development).
  Write minimalist tests. Don't overdo it - about three general end-to-end tests per implementation is enough.
- Before writing tests, write a concise implementation plan with numbered steps.
- At the end of each plan, give me a list of unresolved questions to answer, if any.
  Make the questions extremely concise.
  Sacrifice grammar for the sake of concision.
- After implementation, run all tests to ensure nothing is broken.
- After implementation, write concise documentation updates if necessary.
- After implementation, write a concise changelog entry summarizing the changes made.
- After implementation, update the version number according to semantic versioning rules.
- Follow all steps in the implementation plan methodically.
- After implementation, review the entire codebase for any necessary refactoring or cleanup.
- Before each implementation, review `docs/LESSONS_LEARNED.md` for any relevant insights.
- Before each implementation, review `docs/ARCHITECTURE.md` for any relevant architectural considerations.
- Before each implementation, review `AGENTS.md` for any relevant guidelines.
- After each implementation, review `docs/LESSONS_LEARNED.md` to add any new insights gained.
- After each implementation, review `docs/ARCHITECTURE.md` to update any architectural considerations.
- After each implementation, review `AGENTS.md` to update any relevant guidelines.
- Always prioritize code quality and maintainability.
- Commit often, with small and focused commits.
- Write concise commit messages that clearly describe the changes made.
- For simple queries, use under five tool calls, but for more complex queries you can use up to 15 tool calls.
- STOP and ask user if you find unexpected issues during implementation (breaking changes, missing dependencies, test failures).
- When creating PRs, always write your own title and body

## Project Overview

VSCode extension providing NMTRAN (NONMEM Translator) language support for pharmacometric modeling.

**Key files:**

- `server/src/constants.ts` - Valid control records
- `server/src/hoverInfo.ts` - Control record explanations
- `server/src/services/` - Language feature services
- `syntaxes/nmtran.tmLanguage.json` - Syntax highlighting

**Commands:**

```bash
npm run build      # Production build
npm run dev        # Watch mode
npm test           # All tests
npm run validate   # Lint + compile + test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.

## NMTRAN Language

NMTRAN is FORTRAN-based with special semantics for pharmacokinetic modeling:

- Control records start with `$` (e.g., `$THETA`, `$OMEGA`, `$PK`)
- Parameters: `THETA(n)`, `ETA(n)`, `EPS(n)` - must be sequential, no gaps
- BLOCK matrices with SAME keyword references
- Continuation lines use `&` character

**Reference**: https://nmhelp.tingjieguo.com

## Architecture

```
┌─────────────────┐         LSP          ┌─────────────────┐
│     Client      │ ◄──────────────────► │     Server      │
│  (VS Code API)  │                      │ (Language Intel)│
└─────────────────┘                      └─────────────────┘
```

**Client** (`client/src/`): VSCode integration, folding, public `NmtranApi`
**Server** (`server/src/`): Language intelligence via services + validators

| Service / module      | Responsibility                                       |
| --------------------- | ---------------------------------------------------- |
| DocumentService       | Document caching and lifecycle                       |
| DiagnosticsService    | Orchestrates validators, debounced 500ms (`.mod`/`.ctl` only) |
| HoverService          | Control record and parameter explanations            |
| DefinitionService     | Go-to-definition, find-references                    |
| CompletionService     | Auto-completion suggestions                          |
| FormattingService     | Document and range formatting                        |
| ParameterScanner      | Emits `ParameterLocation[]` for the document         |
| parsedModelService    | Builds `ParsedModel` for `nmtran/parsedModel` LSP request |
| priorScanner          | Parses `$THETAP` / `$OMEGAP` / `$SIGMAP` records     |
| nmtranExpression      | Tiny evaluator for typical-individual RHS values     |
| `validators/*`        | One file per validator (sequentialNumbering, parameterReferences, blockMatrixSyntax, sameKeywordUsage, parameterBounds, comIndices, infinityTokens) |
| `utils/errBinding`    | `ERR(n) → ETA / EPS` resolution (shared by hover, definition, parameter-references validator) |
| `utils/text`, `utils/patterns` | Shared regex helpers (`stripComment`, `stripRecordPrefix`, `stripBlockPrefix`, `splitTopLevelCommas`, `RECORD_PATTERNS`, `BLOCK_RE`, `SAME_RE`, `createParameterReferenceRegex`) |

**Data flow:** Document opened → cached → changes trigger debounced diagnostics (only for `.mod`/`.ctl`) → closed clears cache. Parsing via `nmtran/parsedModel` / `nmtran/parseModelText` works on any registered extension.

**Build:** `tsc -b` for type checking, `esbuild` bundles to `dist/` for production

## Common Tasks

**Add control record**: Update `constants.ts` and `hoverInfo.ts`
**Add service**: Follow DI pattern in `server/src/services/`, register in `server.ts`
**Add validator**: Create `server/src/validators/<name>.ts` exporting `validateX(document)` that returns `ValidationResult`; wire it in `services/diagnosticsService.ts` via `pushPositional`
**Fix control-record validation**: Modify `utils/validateControlRecords.ts`
**Fix parameter validation**: Modify the matching file under `server/src/validators/`

## Constraints

- Debounced validation (500ms)
- Document caching via DocumentService
- 80% test coverage requirement
- esbuild bundles to `dist/` (not TypeScript output)
- No telemetry collected

## Agent-Specific Instructions

- For repo-wide search, use `rg` (ripgrep) and `fd/fdfind`; avoid `grep/find`.
- Cap file reads at ~250 lines; prefer `rg -n -A3 -B3` for context.
- Use `jq` for JSON parsing.
- Fast-tools prompt: copy the block in `cdx/prompts/setup-fast-tools.md` if it is missing from this file.

## CRITICAL: Use ripgrep, not grep

NEVER use grep for project-wide searches (slow, ignores .gitignore). ALWAYS use rg.

- `rg "pattern"` — search content
- `rg --files | rg "name"` — find files
- `rg -t python "def"` — language filters

## File finding

- Prefer `fd` (or `fdfind` on Debian/Ubuntu). Respects .gitignore.

## JSON

- Use `jq` for parsing and transformations.

## Agent Instructions

- Replace commands: grep→rg, find→rg --files/fd, ls -R→rg --files, cat|grep→rg pattern file
- Cap reads at 250 lines; prefer `rg -n -A 3 -B 3` for context
- Use `jq` for JSON instead of regex
