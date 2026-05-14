/**
 * NMTRAN Language Server.
 *
 * Wires LSP requests to per-feature services (hover, diagnostics, symbols,
 * completion, formatting, definition / references) plus two custom requests
 * for ParsedModel snapshots used by the positron-nonmem Fit Inspector.
 *
 * Handlers are kept thin: each wraps document lookup + error reporting
 * through the `withDoc` / `withErrorBoundary` helpers below. Stateful work
 * (debounced diagnostics) lives in module-level state here; lifecycle
 * (open/change/close) tracks it.
 */

import {
  createConnection,
  CodeAction,
  CodeActionKind,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { DocumentService } from './services/documentService';
import { DiagnosticsService } from './services/diagnosticsService';
import { HoverService } from './services/hoverService';
import { FormattingService } from './services/formattingService';
import { CompletionService } from './services/completionService';
import { DefinitionService } from './services/definitionService';
import { ParameterScanner } from './services/parameterScanner';
import { buildParsedModel } from './services/parsedModelService';

import { DEFAULT_SETTINGS, NMTRANSettings } from './types';
import { PARSED_MODEL_REQUEST, PARSE_MODEL_TEXT_REQUEST } from './parsedModel';
import { buildDocumentSymbols } from './services/documentSymbols';

const connection = createConnection(ProposedFeatures.all);

const isDev = process.env.NODE_ENV === 'development';
function devLog(msg: string): void {
  if (isDev) connection.console.log(msg);
}

devLog('>>> NMTRAN LANGUAGE SERVER STARTING UP <<<');
devLog(`Server started at ${new Date().toISOString()}`);

const services = {
  document: new DocumentService(connection),
  diagnostics: new DiagnosticsService(connection),
  hover: new HoverService(connection),
  formatting: new FormattingService(connection),
  completion: new CompletionService(connection),
  definition: new DefinitionService(connection),
};

const documentSettings: Map<string, Thenable<NMTRANSettings>> = new Map();

function getDocumentSettings(resource: string): Thenable<NMTRANSettings> {
  if (!documentSettings.has(resource)) {
    const result = Promise.all([
      connection.workspace.getConfiguration({ scopeUri: resource, section: 'nmtranServer' }),
      connection.workspace.getConfiguration({ scopeUri: resource, section: 'nmtran' }),
    ]).then(([serverConfig, nmtranConfig]) => ({
      maxNumberOfProblems: serverConfig?.maxNumberOfProblems ?? DEFAULT_SETTINGS.maxNumberOfProblems,
      formatting: {
        indentSize: Math.max(
          2,
          Math.min(
            4,
            nmtranConfig?.formatting?.indentSize ?? DEFAULT_SETTINGS.formatting?.indentSize ?? 2,
          ),
        ),
      },
    }));
    documentSettings.set(resource, result);
    return result;
  }
  return documentSettings.get(resource)!;
}

async function getIndentSize(uri: string): Promise<number> {
  const settings = await getDocumentSettings(uri);
  return settings.formatting?.indentSize || DEFAULT_SETTINGS.formatting?.indentSize || 2;
}

// =================================================================
// HANDLER WRAPPERS
// =================================================================

function logError(name: string, error: unknown): void {
  connection.console.error(`❌ Error in ${name}: ${error}`);
}

/** Sync handler: resolve doc, run fn, on missing-doc or throw return fallback. */
function withDoc<T>(uri: string, name: string, fn: (doc: TextDocument) => T, fallback: T): T {
  try {
    const doc = services.document.getDocument(uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for ${name}: ${uri}`);
      return fallback;
    }
    return fn(doc);
  } catch (error) {
    logError(`${name} handler`, error);
    return fallback;
  }
}

/** Async handler variant. */
async function withDocAsync<T>(
  uri: string,
  name: string,
  fn: (doc: TextDocument) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const doc = services.document.getDocument(uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for ${name}: ${uri}`);
      return fallback;
    }
    return await fn(doc);
  } catch (error) {
    logError(`${name} handler`, error);
    return fallback;
  }
}

/** For lifecycle handlers that don't need a doc lookup (open, close, configuration). */
function withErrorBoundary(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    logError(`${name} handler`, error);
  }
}

// =================================================================
// SERVER CAPABILITIES
// =================================================================

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  devLog('NMTRAN Language Server initializing...');
  devLog('Workspace folder: ' + (_params.workspaceFolders?.[0]?.uri || 'none'));

  return {
    capabilities: {
      textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental },
      hoverProvider: true,
      codeActionProvider: true,
      documentSymbolProvider: true,
      completionProvider: { triggerCharacters: ['$', ' '] },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      definitionProvider: true,
      referencesProvider: true,
    },
  };
});

// =================================================================
// LANGUAGE FEATURES
// =================================================================

connection.onHover(({ textDocument, position }) =>
  withDoc(textDocument.uri, 'hover', (doc) => services.hover.provideHover(doc, position), null),
);

connection.onCodeAction(({ textDocument, context }) =>
  withDoc(
    textDocument.uri,
    'code actions',
    () => {
      const codeActions: CodeAction[] = [];
      for (const diag of context.diagnostics) {
        if (!diag.message.startsWith('Did you mean')) continue;
        const fullRecord = diag.message.replace('Did you mean ', '').replace('?', '');
        codeActions.push({
          title: `Replace with ${fullRecord}`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          edit: { changes: { [textDocument.uri]: [{ range: diag.range, newText: fullRecord }] } },
        });
      }
      return codeActions;
    },
    [] as CodeAction[],
  ),
);

connection.onDocumentSymbol((params) =>
  withDoc(
    params.textDocument.uri,
    'document symbols',
    (doc) => buildDocumentSymbols(doc, ParameterScanner.scanDocument(doc)),
    [],
  ),
);

/**
 * Custom request: structured snapshot of the active model file's
 * declarations (THETA / OMEGA / SIGMA values, $INPUT columns, $DATA file).
 * Consumers like positron-nonmem use this to render context-aware views
 * without re-implementing NMTRAN parsing.
 */
connection.onRequest(PARSED_MODEL_REQUEST, (params: { textDocument: { uri: string } }) =>
  withDoc(params.textDocument.uri, 'parsedModel', (doc) => buildParsedModel(doc), null),
);

/**
 * Custom request: parse a control-stream string directly without going
 * through a workspace document. Used by positron-nonmem to parse the
 * embedded control stream from a `.lst` so the Fit Inspector reflects the
 * model AS RUN, not the current sibling .mod.
 *
 * Each call gets a unique synthetic URI so ParameterScanner's
 * `${uri}:${version}` cache never collides across distinct texts.
 */
let embeddedDocCounter = 0;
connection.onRequest(PARSE_MODEL_TEXT_REQUEST, (params: { text: string }) => {
  try {
    const uri = `embedded://lst/${++embeddedDocCounter}`;
    const doc = TextDocument.create(uri, 'nmtran', 1, params.text);
    return buildParsedModel(doc);
  } catch (error) {
    logError('parseModelText handler', error);
    return null;
  }
});

connection.onCompletion(({ textDocument, position }) =>
  withDoc(
    textDocument.uri,
    'completion',
    (doc) => services.completion.provideCompletions(doc, position),
    [],
  ),
);

connection.onDefinition(({ textDocument, position }) =>
  withDoc(
    textDocument.uri,
    'definition',
    (doc) => services.definition.provideDefinition(doc, position),
    null,
  ),
);

connection.onReferences(({ textDocument, position, context }) =>
  withDoc(
    textDocument.uri,
    'references',
    (doc) => services.definition.provideReferences(doc, position, context.includeDeclaration),
    null,
  ),
);

connection.onDocumentFormatting(({ textDocument }, token) =>
  withDocAsync(
    textDocument.uri,
    'formatting',
    async (doc) => {
      if (token.isCancellationRequested) return [];
      const indentSize = await getIndentSize(textDocument.uri);
      if (token.isCancellationRequested) return [];
      devLog(`Format document request for: ${textDocument.uri} (${indentSize}-space)`);
      return services.formatting.formatDocument(doc, indentSize);
    },
    [],
  ),
);

connection.onDocumentRangeFormatting(({ textDocument, range }, token) =>
  withDocAsync(
    textDocument.uri,
    'range formatting',
    async (doc) => {
      if (token.isCancellationRequested) return [];
      const indentSize = await getIndentSize(textDocument.uri);
      if (token.isCancellationRequested) return [];
      devLog(`Format range request for: ${textDocument.uri} (${indentSize}-space)`);
      return services.formatting.formatRange(doc, range, indentSize);
    },
    [],
  ),
);

connection.onDidChangeConfiguration(() => {
  documentSettings.clear();
  devLog('Configuration changed, cleared settings cache');
});

// =================================================================
// DOCUMENT LIFECYCLE
// =================================================================

connection.onDidOpenTextDocument((params) =>
  withErrorBoundary('document open', () => {
    const doc = services.document.createDocument(
      params.textDocument.uri,
      'nmtran',
      params.textDocument.version,
      params.textDocument.text,
    );
    services.document.setDocument(doc);
    services.diagnostics.validateDocument(doc);
  }),
);

connection.onDidChangeTextDocument((change) =>
  withErrorBoundary('document change', () => {
    let doc = services.document.getDocument(change.textDocument.uri);
    if (!doc) {
      connection.console.warn(`⚠️  Document not found in cache: ${change.textDocument.uri}`);
      return;
    }
    for (const contentChange of change.contentChanges) {
      if ('range' in contentChange) {
        doc = TextDocument.update(doc, [contentChange], change.textDocument.version);
      } else {
        doc = services.document.createDocument(
          change.textDocument.uri,
          'nmtran',
          change.textDocument.version,
          contentChange.text,
        );
      }
    }
    services.document.setDocument(doc);
    services.diagnostics.scheduleValidation(doc);
  }),
);

connection.onDidCloseTextDocument((params) =>
  withErrorBoundary('document close', () => {
    const uri = params.textDocument.uri;
    services.document.removeDocument(uri);
    ParameterScanner.clearCacheForUri(uri);
    services.definition.clearCacheForUri(uri);
    services.diagnostics.dispose(uri);
    documentSettings.delete(uri);

    connection.sendDiagnostics({ uri, diagnostics: [] });
  }),
);

// =================================================================
// SERVER LIFECYCLE
// =================================================================

connection.onShutdown(() => {
  services.diagnostics.disposeAll();

  if (isDev) {
    const stats = services.document.getCacheStats();
    devLog(`Shutting down. ${stats.documentCount} documents, ${stats.totalSize} chars`);
  }
});

connection.listen();
devLog('NMTRAN Language Server is ready');
