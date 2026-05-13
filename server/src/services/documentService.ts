/**
 * Document Service
 *
 * Manages document lifecycle and provides document-related services.
 * Centralized document management for better maintainability.
 * Uses LRU eviction to prevent unbounded memory growth.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection } from 'vscode-languageserver/node';

export class DocumentService {
  private documents = new Map<string, TextDocument>();
  private accessOrder: string[] = []; // LRU
  private readonly maxCacheSize: number;

  constructor(_connection: Connection, maxCacheSize = 50) {
    this.maxCacheSize = maxCacheSize;
  }

  /** Add / replace a document, evicting the LRU entry when over capacity. */
  setDocument(document: TextDocument): void {
    const uri = document.uri;
    this.updateAccessOrder(uri);

    while (this.documents.size >= this.maxCacheSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      if (oldest && oldest !== uri) this.documents.delete(oldest);
    }

    this.documents.set(uri, document);
  }

  private updateAccessOrder(uri: string): void {
    const idx = this.accessOrder.indexOf(uri);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(uri);
  }

  /** Retrieve a document and bump its LRU position. */
  getDocument(uri: string): TextDocument | undefined {
    const doc = this.documents.get(uri);
    if (doc) this.updateAccessOrder(uri);
    return doc;
  }

  removeDocument(uri: string): boolean {
    const removed = this.documents.delete(uri);
    if (removed) {
      const idx = this.accessOrder.indexOf(uri);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
    }
    return removed;
  }

  /** Constructor convenience — kept so `server.ts` doesn't import TextDocument directly. */
  createDocument(uri: string, languageId: string, version: number, content: string): TextDocument {
    return TextDocument.create(uri, languageId, version, content);
  }

  /** Used at shutdown for the dev-mode summary log. */
  getCacheStats(): { documentCount: number; totalSize: number } {
    let totalSize = 0;
    for (const doc of this.documents.values()) totalSize += doc.getText().length;
    return { documentCount: this.documents.size, totalSize };
  }
}