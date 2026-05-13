/**
 * Lightweight per-operation timing. Wraps a function in a `performance.now()`
 * pair and logs a warning to the LSP console if the operation took longer
 * than `SLOW_OP_THRESHOLD_MS`. No telemetry — output goes only to the
 * server's developer console.
 *
 * Disabled outside `NODE_ENV=development` (production runs `fn()` directly
 * with no overhead).
 */

import { Connection } from 'vscode-languageserver';

const SLOW_OP_THRESHOLD_MS = 100;

export class PerformanceMonitor {
  private readonly enabled = process.env.NODE_ENV === 'development';

  constructor(private connection: Connection) {}

  async measure<T>(operation: string, fn: () => T | Promise<T>): Promise<T> {
    if (!this.enabled) return fn();

    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      if (duration > SLOW_OP_THRESHOLD_MS) {
        this.connection.console.warn(
          `Slow operation: ${operation} took ${duration.toFixed(2)}ms`,
        );
      }
    }
  }
}
