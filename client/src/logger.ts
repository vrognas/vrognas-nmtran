/**
 * Logging for the NMTRAN client extension. Module-level state; output
 * gated by the debug-enabled flag from `config.ts`.
 *
 * In non-debug mode, only `error` writes to console; everything else
 * is dropped. In debug mode, the configured `logLevel` from
 * `nmtran.debug.logLevel` controls the threshold.
 */

import { isDebugEnabled, getConfig } from './config';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

function shouldLog(level: LogLevel): boolean {
  if (!isDebugEnabled()) return level === 'error';
  const configLevel = getConfig('debug').logLevel;
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(configLevel);
}

function getEmoji(level: LogLevel): string {
  switch (level) {
    case 'error': return '❌';
    case 'warn':  return '⚠️';
    case 'info':  return 'ℹ️';
    case 'debug': return '🔍';
  }
}

function format(level: LogLevel, message: string, args: unknown[]): string {
  const time = new Date().toISOString().slice(11, 19);
  const prefix = `[${time}] ${getEmoji(level)} NMTRAN`;
  if (args.length === 0) return `${prefix}: ${message}`;
  const rendered = args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
    .join(' ');
  return `${prefix}: ${message} ${rendered}`;
}

export function logError(message: string, ...args: unknown[]): void {
  if (shouldLog('error')) console.error(format('error', message, args));
}

export function logWarn(message: string, ...args: unknown[]): void {
  if (shouldLog('warn')) console.warn(format('warn', message, args));
}

export function logInfo(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) console.log(format('info', message, args));
}

export function logDebug(message: string, ...args: unknown[]): void {
  if (shouldLog('debug')) console.log(format('debug', message, args));
}

// Convenience wrappers preserving the previous emoji conventions.
export function logActivation(message: string): void {
  logInfo(`🚀 ${message}`);
}

export function logServer(message: string, ...args: unknown[]): void {
  logInfo(`🗂️ ${message}`, ...args);
}

export function logCompletion(message: string): void {
  logInfo(`✨ ${message}`);
}
