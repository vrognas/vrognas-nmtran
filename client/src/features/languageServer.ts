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

import { ConfigurationService } from '../config';
import { Logger } from '../logger';

export class LanguageServerManager {
  private client: LanguageClient | null = null;
  private autoShowTimeout: NodeJS.Timeout | null = null;
  private readonly config: ConfigurationService;
  private readonly logger: Logger;

  constructor() {
    this.config = ConfigurationService.getInstance();
    this.logger = Logger.getInstance();
  }

  public async start(context: vscode.ExtensionContext): Promise<void> {
    try {
      this.logger.info('Starting language server...');
      
      const serverOptions = this.createServerOptions(context);
      const clientOptions = this.createClientOptions();
      
      this.client = new LanguageClient(
        'NMTRANLanguageServer',
        'NMTRAN Language Server',
        serverOptions,
        clientOptions
      );

      await this.client.start();
      context.subscriptions.push(this.client);
      this.logger.info('Language server started successfully');
      
      this.setupAutoShowLogs();
      
    } catch (error) {
      this.logger.error('Failed to start language server:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.autoShowTimeout) {
      clearTimeout(this.autoShowTimeout);
      this.autoShowTimeout = null;
    }

    if (!this.client) {
      return;
    }

    try {
      this.logger.info('Stopping language server...');
      await this.client.stop();
      this.client = null;
      this.logger.info('Language server stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping language server:', error);
      throw error;
    }
  }

  private createServerOptions(context: vscode.ExtensionContext): ServerOptions {
    const serverModule = this.resolveServerPath(context);
    this.logger.server('Server module path:', serverModule);
    
    // Verify server file exists
    const serverExists = fs.existsSync(serverModule);
    this.logger.server('Server file exists:', serverExists);
    
    if (!serverExists) {
      throw new Error(`Language server not found at: ${serverModule}`);
    }

    const debugOptions = { 
      execArgv: ['--nolazy', `--inspect=${this.config.get('server').port}`] 
    };

    return {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: debugOptions
      }
    };
  }

  private createClientOptions(): LanguageClientOptions {
    return {
      documentSelector: [{ scheme: 'file', language: 'nmtran' }]
    };
  }

  private resolveServerPath(context: vscode.ExtensionContext): string {
    const serverPath = this.config.get('paths').serverModule;
    return context.asAbsolutePath(serverPath);
  }

  private setupAutoShowLogs(): void {
    if (!this.config.isDebugEnabled()) {
      return;
    }

    this.autoShowTimeout = setTimeout(() => {
      vscode.commands.executeCommand('workbench.action.output.show.NMTRAN Language Server')
        .then(undefined, (error) => {
          this.logger.debug('Could not show language server output:', error.message);
        });
    }, this.config.get('server').timeout);
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
      return await this.client.sendRequest('nmtran/parsedModel', {
        textDocument: { uri },
      });
    } catch (error) {
      this.logger.error('parsedModel request failed:', error);
      return null;
    }
  }
}