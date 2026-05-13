/**
 * NMTRAN Language Server - Modernized Architecture
 *
 * This is the smart part that provides all the NMTRAN language features:
 * - Hover explanations (when you hover over $THETA, shows what it means)
 * - Error checking (highlights invalid control records in red)
 * - Quick fixes (suggests $ESTIMATION when you type $EST)
 * - Document outline (shows all control records in sidebar)
 *
 * ARCHITECTURE:
 * - Service-based architecture for better maintainability
 * - Proper error handling throughout
 * - Centralized document management
 * - Separated concerns (hover, diagnostics, symbols)
 */

import {
  createConnection,
  CodeAction,
  CodeActionKind,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Import our services
import { DocumentService } from './services/documentService';
import { DiagnosticsService } from './services/diagnosticsService';
import { HoverService } from './services/hoverService';
import { FormattingService } from './services/formattingService';
import { CompletionService } from './services/completionService';
import { DefinitionService } from './services/definitionService';
import { ParameterScanner } from './services/ParameterScanner';
import { buildParsedModel } from './services/parsedModelService';

// Import types and utilities
import { DEFAULT_SETTINGS, NMTRANSettings } from './types';
import { PARSED_MODEL_REQUEST, PARSE_MODEL_TEXT_REQUEST } from './parsedModel';
import { buildDocumentSymbols } from './services/documentSymbols';

// =================================================================
// SERVER SETUP
// =================================================================

const connection = createConnection(ProposedFeatures.all);

// Log server startup (only in debug mode)
if (process.env.NODE_ENV === 'development') {
  connection.console.log('>>> NMTRAN LANGUAGE SERVER STARTING UP <<<');
  connection.console.log(`Server started at ${new Date().toISOString()}`);
}

// Initialize services
const services = {
  document: new DocumentService(connection),
  diagnostics: new DiagnosticsService(connection),
  hover: new HoverService(connection),
  formatting: new FormattingService(connection),
  completion: new CompletionService(connection),
  definition: new DefinitionService(connection)
};

// Settings management - currently only used for maxNumberOfProblems in diagnostics
const documentSettings: Map<string, Thenable<NMTRANSettings>> = new Map();

// Debounced diagnostics to prevent excessive validation during rapid text changes
const diagnosticsTimeouts: Map<string, NodeJS.Timeout> = new Map();
const DIAGNOSTICS_DEBOUNCE_MS = 500;

/**
 * Schedules debounced diagnostics validation for a document
 * Prevents excessive validation during rapid text changes
 */
function scheduleDebouncedDiagnostics(uri: string, doc: TextDocument): void {
  // Clear existing timeout for this document
  const existingTimeout = diagnosticsTimeouts.get(uri);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Schedule new validation after debounce period
  const timeout = setTimeout(() => {
    try {
      services.diagnostics.validateDocument(doc);
      diagnosticsTimeouts.delete(uri);
    } catch (error) {
      connection.console.error(`❌ Error in debounced diagnostics: ${error}`);
    }
  }, DIAGNOSTICS_DEBOUNCE_MS);

  diagnosticsTimeouts.set(uri, timeout);
}

function getDocumentSettings(resource: string): Thenable<NMTRANSettings> {
  if (!documentSettings.has(resource)) {
    const result = Promise.all([
      connection.workspace.getConfiguration({
        scopeUri: resource,
        section: 'nmtranServer'
      }),
      connection.workspace.getConfiguration({
        scopeUri: resource,
        section: 'nmtran'
      })
    ]).then(([serverConfig, nmtranConfig]) => {
      return {
        maxNumberOfProblems: serverConfig?.maxNumberOfProblems ?? DEFAULT_SETTINGS.maxNumberOfProblems,
        formatting: {
          indentSize: Math.max(2, Math.min(4, nmtranConfig?.formatting?.indentSize ?? DEFAULT_SETTINGS.formatting?.indentSize ?? 2))
        }
      };
    });
    documentSettings.set(resource, result);
    return result;
  }
  return documentSettings.get(resource)!;
}


// =================================================================
// SERVER CAPABILITIES
// =================================================================

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  // _params prefixed with underscore to indicate intentionally unused
  // (required by LSP interface but our simple implementation doesn't need it)

  if (process.env.NODE_ENV === 'development') {
    connection.console.log('NMTRAN Language Server initializing...');
    connection.console.log('Workspace folder: ' + (_params.workspaceFolders?.[0]?.uri || 'none'));
  }


  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental
      },
      hoverProvider: true,
      codeActionProvider: true,
      documentSymbolProvider: true,
      completionProvider: {
        triggerCharacters: ['$', ' ']
      },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      definitionProvider: true,
      referencesProvider: true
    }
  };
});

// =================================================================
// LANGUAGE FEATURES
// =================================================================

/**
 * Provides hover information for NMTRAN control records
 * Shows explanations when users hover over control records like $THETA, $OMEGA, etc.
 */
connection.onHover(({ textDocument, position }) => {
  try {
    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found: ${textDocument.uri}`);
      return null;
    }

    return services.hover.provideHover(doc, position);
  } catch (error) {
    connection.console.error(`❌ Error in hover handler: ${error}`);
    return null;
  }
});

/**
 * Provides code actions (quick fixes) for NMTRAN files
 * Suggests replacing abbreviated control records with full names (e.g., $EST → $ESTIMATION)
 */
connection.onCodeAction(({ textDocument, range: _range, context }) => {
  // _range prefixed with underscore to indicate intentionally unused
  // (required by LSP interface but we use diagnostics range instead)
  try {
    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for code actions: ${textDocument.uri}`);
      return null;
    }

    const codeActions: CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.message.startsWith("Did you mean")) {
        const fullRecord = diag.message.replace("Did you mean ", "").replace("?", "");

        const replaceAction: CodeAction = {
          title: `Replace with ${fullRecord}`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          edit: {
            changes: {
              [textDocument.uri]: [
                {
                  range: diag.range,
                  newText: fullRecord
                }
              ]
            }
          }
        };

        codeActions.push(replaceAction);
      }
    }

    return codeActions;
  } catch (error) {
    connection.console.error(`❌ Error in code action handler: ${error}`);
    return [];
  }
});

/**
 * Provides document outline (symbols) for NMTRAN files
 * Lists all control records in the sidebar for easy navigation
 */
connection.onDocumentSymbol((params) => {
  try {
    const doc = services.document.getDocument(params.textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for symbols: ${params.textDocument.uri}`);
      return null;
    }
    const parameterLocations = ParameterScanner.scanDocument(doc);
    return buildDocumentSymbols(doc, parameterLocations);
  } catch (error) {
    connection.console.error(`❌ Error in document symbol handler: ${error}`);
    return [];
  }
});

/**
 * Custom request: structured snapshot of the active model file's
 * declarations (THETA / OMEGA / SIGMA values, $INPUT columns, $DATA file).
 * Consumers like positron-nonmem use this to render context-aware views
 * without re-implementing NMTRAN parsing.
 */
connection.onRequest(PARSED_MODEL_REQUEST, (params: { textDocument: { uri: string } }) => {
  try {
    const doc = services.document.getDocument(params.textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for parsedModel: ${params.textDocument.uri}`);
      return null;
    }
    return buildParsedModel(doc);
  } catch (error) {
    connection.console.error(`❌ Error in parsedModel handler: ${error}`);
    return null;
  }
});

/**
 * Custom request: parse a control-stream string directly without
 * going through a workspace document. Used by positron-nonmem to parse
 * the embedded control stream from a `.lst` so the Fit Inspector
 * reflects the model AS RUN, not the current sibling .mod.
 *
 * Each call gets a unique synthetic URI so ParameterScanner's
 * `${uri}:${version}` cache never collides across distinct texts.
 */
let embeddedDocCounter = 0;
connection.onRequest(
  PARSE_MODEL_TEXT_REQUEST,
  (params: { text: string }) => {
    try {
      const uri = `embedded://lst/${++embeddedDocCounter}`;
      const doc = TextDocument.create(uri, 'nmtran', 1, params.text);
      return buildParsedModel(doc);
    } catch (error) {
      connection.console.error(`❌ Error in parseModelText handler: ${error}`);
      return null;
    }
  },
);

/**
 * Provides code completion suggestions for NMTRAN files
 * Suggests control records and common parameter names
 */
connection.onCompletion(({ textDocument, position }) => {
  try {
    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for completion: ${textDocument.uri}`);
      return [];
    }

    return services.completion.provideCompletions(doc, position);
  } catch (error) {
    connection.console.error(`❌ Error in completion handler: ${error}`);
    return [];
  }
});

/**
 * Provides definition locations for NMTRAN parameters
 * When user clicks "Go to Definition" on THETA(3), shows where it's defined
 */
connection.onDefinition(({ textDocument, position }) => {
  try {

    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for definition: ${textDocument.uri}`);
      return null;
    }

    return services.definition.provideDefinition(doc, position);
  } catch (error) {
    connection.console.error(`❌ Error in definition handler: ${error}`);
    return null;
  }
});

/**
 * Provides reference locations for NMTRAN parameters
 * When user clicks "Find All References" on ETA(2), shows all usages
 */
connection.onReferences(({ textDocument, position, context }) => {
  try {
    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for references: ${textDocument.uri}`);
      return null;
    }

    return services.definition.provideReferences(doc, position, context.includeDeclaration);
  } catch (error) {
    connection.console.error(`❌ Error in references handler: ${error}`);
    return null;
  }
});

/**
 * Provides document formatting for NMTRAN files
 * Formats control records and ensures proper indentation
 */
connection.onDocumentFormatting(async ({ textDocument }, token) => {
  try {
    // Check for cancellation
    if (token.isCancellationRequested) {
      return [];
    }

    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for formatting: ${textDocument.uri}`);
      return [];
    }

    const settings = await getDocumentSettings(textDocument.uri);

    // Check for cancellation after async operation
    if (token.isCancellationRequested) {
      return [];
    }

    const indentSize = settings.formatting?.indentSize || DEFAULT_SETTINGS.formatting?.indentSize || 2;
    if (process.env.NODE_ENV === 'development') {
      connection.console.log(`Format document request for: ${textDocument.uri}`);
      connection.console.log(`Using ${indentSize}-space indentation`);
    }

    return services.formatting.formatDocument(doc, indentSize);
  } catch (error) {
    connection.console.error(`❌ Error in formatting handler: ${error}`);
    return [];
  }
});

/**
 * Provides range formatting for NMTRAN files
 * Formats only the selected range of text
 */
connection.onDocumentRangeFormatting(async ({ textDocument, range }, token) => {
  try {
    // Check for cancellation
    if (token.isCancellationRequested) {
      return [];
    }

    const doc = services.document.getDocument(textDocument.uri);
    if (!doc) {
      connection.console.error(`❌ Document not found for range formatting: ${textDocument.uri}`);
      return [];
    }

    const settings = await getDocumentSettings(textDocument.uri);

    // Check for cancellation after async operation
    if (token.isCancellationRequested) {
      return [];
    }

    const indentSize = settings.formatting?.indentSize || DEFAULT_SETTINGS.formatting?.indentSize || 2;
    if (process.env.NODE_ENV === 'development') {
      connection.console.log(`Format range request for: ${textDocument.uri}`);
      connection.console.log(`Using ${indentSize}-space indentation`);
    }

    return services.formatting.formatRange(doc, range, indentSize);
  } catch (error) {
    connection.console.error(`❌ Error in range formatting handler: ${error}`);
    return [];
  }
});

/**
 * Handles configuration changes
 * Clears settings cache to ensure fresh configuration is loaded
 */
connection.onDidChangeConfiguration((_change) => {
  // Clear document settings cache when configuration changes
  documentSettings.clear();
  if (process.env.NODE_ENV === 'development') {
    connection.console.log('Configuration changed, cleared settings cache');
  }
});

// =================================================================
// DOCUMENT LIFECYCLE
// =================================================================

// Listen for document open events
connection.onDidOpenTextDocument((params) => {
  try {
    const doc = services.document.createDocument(
      params.textDocument.uri,
      'nmtran',
      params.textDocument.version,
      params.textDocument.text
    );

    services.document.setDocument(doc);
    services.diagnostics.validateDocument(doc);
  } catch (error) {
    connection.console.error(`❌ Error handling document open: ${error}`);
  }
});

// Listen for document change events (incremental)
connection.onDidChangeTextDocument((change) => {
  try {
    // Get the current document from cache
    let doc = services.document.getDocument(change.textDocument.uri);

    if (!doc) {
      connection.console.warn(`⚠️  Document not found in cache: ${change.textDocument.uri}`);
      return;
    }

    // Apply incremental changes
    for (const contentChange of change.contentChanges) {
      if ('range' in contentChange) {
        // Incremental change
        doc = TextDocument.update(doc, [contentChange], change.textDocument.version);
      } else {
        // Full document change (fallback)
        doc = services.document.createDocument(
          change.textDocument.uri,
          'nmtran',
          change.textDocument.version,
          contentChange.text
        );
      }
    }

    services.document.setDocument(doc);
    scheduleDebouncedDiagnostics(change.textDocument.uri, doc);
  } catch (error) {
    connection.console.error(`❌ Error handling document change: ${error}`);
  }
});

// Listen for document close events
connection.onDidCloseTextDocument((params) => {
  try {
    services.document.removeDocument(params.textDocument.uri);

    // Clear parameter scan caches for closed document
    ParameterScanner.clearCacheForUri(params.textDocument.uri);
    services.definition.clearCacheForUri(params.textDocument.uri);

    // Clear cached settings for closed document
    documentSettings.delete(params.textDocument.uri);

    // Clear any pending diagnostics timeout
    const timeout = diagnosticsTimeouts.get(params.textDocument.uri);
    if (timeout) {
      clearTimeout(timeout);
      diagnosticsTimeouts.delete(params.textDocument.uri);
    }

    // Clear diagnostics for closed document
    connection.sendDiagnostics({
      uri: params.textDocument.uri,
      diagnostics: []
    });
  } catch (error) {
    connection.console.error(`❌ Error handling document close: ${error}`);
  }
});

// =================================================================
// SERVER LIFECYCLE
// =================================================================

// Handle shutdown gracefully
connection.onShutdown(() => {
  // Clear all pending diagnostics timeouts
  for (const timeout of diagnosticsTimeouts.values()) {
    clearTimeout(timeout);
  }
  diagnosticsTimeouts.clear();

  if (process.env.NODE_ENV === 'development') {
    const stats = services.document.getCacheStats();
    connection.console.log(`Shutting down. ${stats.documentCount} documents, ${stats.totalSize} chars`);
  }
});


// Start listening for requests
connection.listen();

// Startup confirmation
if (process.env.NODE_ENV === 'development') {
  connection.console.log('NMTRAN Language Server is ready');
}

