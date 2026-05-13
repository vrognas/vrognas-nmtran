/**
 * NMTRAN VSCode Extension - Client Side
 * 
 * This is the "entry point" of the extension that VSCode directly talks to.
 * Main responsibilities:
 * 1. Register language features (like code folding)
 * 2. Start and manage the language server connection
 * 3. Handle extension lifecycle (activate/deactivate)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationService } from './config';
import { Logger } from './logger';
import { NMTRANFoldingProvider } from './features/foldingProvider';
import { LanguageServerManager } from './features/languageServer';
import { VerbatimDecorator } from './features/verbatimDecorator';
import { NmtranApi, NmtranParsedModel } from './parsedModelApi';

// Service instances
let languageServerManager: LanguageServerManager;

/**
 * Called when the extension is activated (when NMTRAN files are opened)
 */
export async function activate(context: vscode.ExtensionContext): Promise<NmtranApi> {
  const logger = Logger.getInstance();

  try {
    logger.activation('Starting activation...');
    logger.debug('Extension path:', context.extensionPath);
    logger.debug('Extension version:', getExtensionVersion(context));

    // Register language features
    await registerLanguageFeatures(context);

    // Start language server
    await startLanguageServer(context);

    // Setup configuration change handlers
    setupConfigurationHandlers(context);

    // Debug command: dumps the parsedModel response for the active file
    // into a new JSON document so devs can sanity-check the LSP output.
    context.subscriptions.push(
      vscode.commands.registerCommand('nmtran.showParsedModel', () =>
        showParsedModelCommand(),
      ),
    );

    logger.completion('Activation completed successfully');

    // Return the public API for companion extensions to consume.
    return {
      getParsedModel: async (uri: vscode.Uri): Promise<NmtranParsedModel | null> => {
        const result = await languageServerManager.sendParsedModelRequest(uri.toString());
        return (result as NmtranParsedModel | null) ?? null;
      },
      parseModelFromText: async (text: string): Promise<NmtranParsedModel | null> => {
        const result = await languageServerManager.sendParseModelTextRequest(text);
        return (result as NmtranParsedModel | null) ?? null;
      },
    };
  } catch (error) {
    logger.error('Extension activation failed:', error);
    throw error;
  }
}

/**
 * Register language features like folding
 */
async function registerLanguageFeatures(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('Registering language features...');
  
  // Register folding provider
  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    { language: 'nmtran', scheme: 'file' },
    new NMTRANFoldingProvider()
  );

  context.subscriptions.push(foldingProvider);
  logger.debug('Folding provider registered');

  // Register verbatim FORTRAN decorator (background highlight for "-prefixed lines)
  context.subscriptions.push(new VerbatimDecorator());
  logger.debug('Verbatim decorator registered');
}

/**
 * Start the language server
 */
async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
  languageServerManager = new LanguageServerManager();
  await languageServerManager.start(context);
}

/**
 * Setup configuration change handlers
 */
function setupConfigurationHandlers(context: vscode.ExtensionContext): void {
  const config = ConfigurationService.getInstance();

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('nmtran')) {
      config.refresh();
    }
  });

  context.subscriptions.push(configSubscription);
}

/**
 * Open the parsedModel response for the active NMTRAN file in a new
 * untitled JSON editor — handy for verifying server output during dev.
 */
async function showParsedModelCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'nmtran') {
    void vscode.window.showErrorMessage('NMTRAN: open a NMTRAN (.mod / .ctl / .lst) file first.');
    return;
  }
  const result = await languageServerManager.sendParsedModelRequest(
    editor.document.uri.toString(),
  );
  if (result === null) {
    void vscode.window.showErrorMessage(
      'NMTRAN: parsedModel request returned null — server not ready or document unknown.',
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    language: 'json',
    content: JSON.stringify(result, null, 2),
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Get extension version safely
 */
function getExtensionVersion(context: vscode.ExtensionContext): string {
  try {
    const packageJsonPath = path.join(context.extensionPath, 'package.json');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packageJson = require(packageJsonPath);
    return packageJson.version || 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

/**
 * Called when the extension is deactivated (VSCode closes or extension is disabled)
 * Properly shuts down the language server to free resources
 */
export async function deactivate(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('Deactivating extension...');
    
    if (languageServerManager?.isRunning()) {
      await languageServerManager.stop();
    }
    
    logger.info('Extension deactivated successfully');
  } catch (error) {
    logger.error('Error during deactivation:', error);
  }
}
