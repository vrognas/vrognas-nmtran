/**
 * Language Server Manager
 * 
 * Manages the lifecycle of the NMTRAN language server.
 * Handles server startup, configuration, and connection management.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

import { getConfig, isDebugEnabled } from '../config';
import { logDebug, logError, logInfo, logServer } from '../logger';
import { PARSED_MODEL_REQUEST, PARSE_MODEL_TEXT_REQUEST } from '../parsedModelApi';

export class LanguageServerManager {
  private client: LanguageClient | null = null;
  private autoShowTimeout: NodeJS.Timeout | null = null;

  public async start(context: vscode.ExtensionContext): Promise<void> {
    try {
      logInfo('Starting language server...');

      const serverOptions = this.createServerOptions(context);
      const clientOptions = this.createClientOptions();

      this.client = new LanguageClient(
        'NMTRANLanguageServer',
        'NMTRAN Language Server',
        serverOptions,
        clientOptions,
      );

      await this.client.start();
      context.subscriptions.push(this.client);
      logInfo('Language server started successfully');

      this.setupAutoShowLogs();
    } catch (error) {
      logError('Failed to start language server:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.autoShowTimeout) {
      clearTimeout(this.autoShowTimeout);
      this.autoShowTimeout = null;
    }
    if (!this.client) return;

    try {
      logInfo('Stopping language server...');
      await this.client.stop();
      this.client = null;
      logInfo('Language server stopped successfully');
    } catch (error) {
      logError('Error stopping language server:', error);
      throw error;
    }
  }

  private createServerOptions(context: vscode.ExtensionContext): ServerOptions {
    const serverModule = context.asAbsolutePath(getConfig('paths').serverModule);
    logServer('Server module path:', serverModule);

    const serverExists = fs.existsSync(serverModule);
    logServer('Server file exists:', serverExists);
    if (!serverExists) {
      throw new Error(`Language server not found at: ${serverModule}`);
    }

    const debugOptions = {
      execArgv: ['--nolazy', `--inspect=${getConfig('server').port}`],
    };

    return {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
    };
  }

  private createClientOptions(): LanguageClientOptions {
    return { documentSelector: [{ scheme: 'file', language: 'nmtran' }] };
  }

  private setupAutoShowLogs(): void {
    if (!isDebugEnabled()) return;

    this.autoShowTimeout = setTimeout(() => {
      vscode.commands
        .executeCommand('workbench.action.output.show.NMTRAN Language Server')
        .then(undefined, (error) => {
          logDebug('Could not show language server output:', error.message);
        });
    }, getConfig('server').timeout);
  }

  public isRunning(): boolean {
    return this.client !== null && this.client.isRunning();
  }

  /**
   * Forward a `nmtran/parsedModel` request to the running server and
   * return the structured snapshot. Returns null if the server isn't up
   * yet or if the document isn't known to the server. The request method
   * name and response shape are part of the published extension API
   * (`exports.getParsedModel`); see `parsedModelApi.ts`.
   */
  public async sendParsedModelRequest(uri: string): Promise<unknown | null> {
    if (!this.client || !this.client.isRunning()) return null;
    try {
      return await this.client.sendRequest(PARSED_MODEL_REQUEST, {
        textDocument: { uri },
      });
    } catch (error) {
      logError('parsedModel request failed:', error);
      return null;
    }
  }

  /**
   * Forward a `nmtran/parseModelText` request — parse a control-stream
   * string directly without involving a workspace document. Used by
   * positron-nonmem to parse the embedded control stream out of a
   * `.lst` (so the Fit Inspector reflects the model AS RUN, not the
   * current sibling .mod).
   */
  public async sendParseModelTextRequest(text: string): Promise<unknown | null> {
    if (!this.client || !this.client.isRunning()) return null;
    try {
      return await this.client.sendRequest(PARSE_MODEL_TEXT_REQUEST, { text });
    } catch (error) {
      logError('parseModelText request failed:', error);
      return null;
    }
  }
}
