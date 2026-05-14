# Contributing to NMTRAN Extension

Thank you for your interest in contributing! Whether you're fixing bugs, adding features, or improving documentation, your contributions help make NMTRAN development better for the pharmacometrics community.

## Getting Started

### Prerequisites

- **Node.js**: v20.8.0+ ([Download](https://nodejs.org/))
- **VS Code**: v1.109.0+ ([Download](https://code.visualstudio.com/)) — or Positron 2026.04+ for the Positron build
- **Git**: For version control ([Download](https://git-scm.com/))

Optional: TypeScript and ESLint VSCode extensions for better development experience.

### Setup

```bash
# Fork on GitHub, then clone
git clone https://github.com/YOUR_USERNAME/vrognas-nmtran.git
cd vrognas-nmtran

# Install dependencies (includes client and server)
npm install

# Build extension
npm run build

# Run tests
npm test
```

### Development Workflow

```bash
npm run dev              # Watch mode (client + server)
npm run compile:watch    # TypeScript watch mode
npm run bundle:watch     # esbuild watch mode
npm run validate         # Lint + compile + test (run before commits)
```

**Launch Development Environment:**
1. Open project in VSCode/Positron
2. Press **F5** to launch Extension Development Host
3. Open NMTRAN files from `test/` folder to test features

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Production build (esbuild to dist/) |
| `npm run dev` | Watch mode for development |
| `npm test` | Run all tests (client + server) |
| `npm run test:server` | Vitest unit tests only |
| `npm run validate` | Lint + compile + test |
| `npm run lint` | ESLint code style check |

## Common Tasks

### Adding New Control Records

1. **Add to constants** (`server/src/constants.ts`):
   ```typescript
   export const allowedControlRecords = [
     // ... existing records
     '$NEWRECORD',
   ];
   ```

2. **Add hover explanation** (`server/src/hoverInfo.ts`):
   ```typescript
   case '$NEWRECORD':
     return 'Description of what this control record does';
   ```

3. **Run tests**: `npm test`

### Adding New Features

Follow the service-based architecture pattern:

```typescript
// server/src/services/newFeatureService.ts
export class NewFeatureService {
  constructor(private connection: Connection) {}

  provideFeature(document: TextDocument, position: Position) {
    // Implementation
  }
}
```

Register in `server/src/server.ts` and add tests in `server/src/test/`.

### Fixing Validation Issues

1. Check if record is in `server/src/constants.ts`
2. Check validation logic in `server/src/utils/validateControlRecords.ts`
3. Run tests: `npm test`

## Testing

### Automated Tests

```bash
npm test                           # Full test suite (vscode-test + server vitest)
npm run test:server                # Server unit tests (vitest)
cd server && npx vitest watch      # Vitest watch mode
cd server && npx vitest file.test.ts   # Specific test file
```

Coverage thresholds: 80% for branches, functions, lines, statements.

### Manual Testing

1. Press **F5** to launch Extension Development Host
2. Test with files in `test/` directory:
   - `demo.mod` - Basic PopPK model
   - `maximal.mod` - Complex model with many features
   - `test-data.mod` - Edge cases and validation scenarios
3. Test specific features:
   - Hover on control records (`$THETA`, `$OMEGA`)
   - Invalid records (`$INVALID`) should show red squiggle
   - Go to Definition on `THETA(3)`
   - Find References on parameters
   - Code folding on control record sections

## Debugging

### View Logs

**Language Server Logs** (hover, validation, diagnostics):
1. In Extension Development Host: `Cmd+Shift+P` / `Ctrl+Shift+P`
2. "Developer: Show Logs" → "NMTRAN Language Server"

**Extension/Client Logs** (activation, folding):
1. "Developer: Show Logs" → "Extension Host"

### Debug Breakpoints

Use "Debug Extension + Server" launch configuration for full breakpoint debugging:
- Client code: `client/src/extension.ts`, `client/src/features/`
- Server code: `server/src/server.ts`, `server/src/services/`

## File Organization

```
├── client/src/
│   ├── extension.ts          # Extension entry point, exposes NmtranApi
│   ├── parsedModelApi.ts     # Public API surface returned from activate()
│   └── features/
│       ├── foldingProvider.ts    # Code folding
│       ├── verbatimDecorator.ts  # Verbatim FORTRAN block highlighting
│       └── languageServer.ts     # LSP client wiring + LSP request helpers
├── server/src/
│   ├── server.ts             # LSP server main + custom request handlers
│   ├── constants.ts          # Valid control records, abbreviated-code blocks
│   ├── hoverInfo.ts          # Control record explanations
│   ├── parsedModel.ts        # Wire-format types + LSP method names
│   ├── services/             # Stateful services (ParameterScanner, Document,
│   │                           Diagnostics, Hover, Definition, Completion,
│   │                           Formatting, parsedModelService, priorScanner,
│   │                           nmtranExpression)
│   ├── validators/           # One file per validator (Tier-3 split):
│   │                           sequentialNumbering, parameterReferences,
│   │                           blockMatrixSyntax, sameKeywordUsage,
│   │                           parameterBounds, comIndices, infinityTokens
│   ├── utils/                # Shared text / regex / matrix / errBinding helpers
│   └── test/                 # Vitest tests
├── syntaxes/                 # TextMate grammar
├── snippets/                 # Code snippets
├── test/                     # Sample NMTRAN files
└── dist/                     # Bundled output (esbuild)
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension not loading | Run `npm run build`, check `dist/extension.js` exists |
| Hover not working | Verify record in `constants.ts`, test with `npm run test:server -- hoverService.test.ts` |
| False validation errors | Check spelling in `constants.ts`, verify regex in `validateControlRecords.ts` |
| TypeScript errors | Run `npm run compile` for detailed errors |
| Language server not responding | Check Language Server logs for crashes |

## Pull Request Process

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes following existing patterns
3. Add tests for new functionality
4. Run `npm run validate` before committing
5. Submit PR with clear description

## Release Process (Maintainers)

1. Run `npm run validate`
2. Update version in `package.json`
3. Update `CHANGELOG.md`
4. Commit: `git commit -m "chore: release X.Y.Z"`
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. GitHub Actions publishes to VS Code Marketplace **and Open VSX** (the
   registry Positron pulls from). Requires `VSCE_PAT` and `OVSX_PAT`
   secrets on the repo.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers learn
- Follow existing patterns
- Stay professional

## Getting Help

- [GitHub Discussions](https://github.com/vrognas/vrognas-nmtran/discussions) - Questions
- [GitHub Issues](https://github.com/vrognas/vrognas-nmtran/issues) - Bugs and features
- [CLAUDE.md](CLAUDE.md) - Technical design details

---

**Thank you for contributing!** Your efforts help pharmacometric modeling become more accessible for researchers worldwide.
