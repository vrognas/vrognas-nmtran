/**
 * Configuration access for the NMTRAN extension.
 *
 * Loads from `vscode.workspace.getConfiguration('nmtran')` lazily on
 * first read and caches the result; `refresh()` re-reads on
 * configuration-change events.
 */

import * as vscode from 'vscode';

export interface ExtensionConfig {
  debug: {
    enabled: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
  };
  server: {
    port: number;
    timeout: number;
  };
  paths: {
    serverModule: string;
  };
}

let cached: ExtensionConfig | null = null;

function load(): ExtensionConfig {
  const vsConfig = vscode.workspace.getConfiguration('nmtran');
  return {
    debug: {
      enabled: process.env.NODE_ENV === 'development' || vsConfig.get('debug.enabled', false),
      logLevel: vsConfig.get('debug.logLevel', 'info'),
    },
    server: {
      port: vsConfig.get('server.debugPort', 6009),
      timeout: vsConfig.get('server.timeout', 2000),
    },
    paths: {
      serverModule: 'dist/server.js',
    },
  };
}

function ensure(): ExtensionConfig {
  if (!cached) cached = load();
  return cached;
}

export function getConfig<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K] {
  return ensure()[key];
}

export function isDebugEnabled(): boolean {
  return ensure().debug.enabled;
}

export function refreshConfig(): void {
  cached = load();
}
