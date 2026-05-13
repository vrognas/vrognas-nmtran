/**
 * Tests for DocumentService
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DocumentService } from '../services/documentService';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createMockConnection, asMockConnection } from './mocks/mockConnection';

describe('DocumentService', () => {
  let documentService: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConnection = asMockConnection(createMockConnection());
    documentService = new DocumentService(mockConnection, 3); // Small cache for testing LRU
  });

  describe('setDocument and getDocument', () => {
    it('should store and retrieve a document', () => {
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, '$THETA 1.0');
      documentService.setDocument(doc);

      const retrieved = documentService.getDocument('test://test.mod');
      expect(retrieved).toBe(doc);
    });

    it('should return undefined for non-existent document', () => {
      const retrieved = documentService.getDocument('test://nonexistent.mod');
      expect(retrieved).toBeUndefined();
    });

    it('should update existing document', () => {
      const doc1 = TextDocument.create('test://test.mod', 'nmtran', 1, '$THETA 1.0');
      const doc2 = TextDocument.create('test://test.mod', 'nmtran', 2, '$THETA 2.0');

      documentService.setDocument(doc1);
      documentService.setDocument(doc2);

      const retrieved = documentService.getDocument('test://test.mod');
      expect(retrieved?.version).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest document when cache is full', () => {
      const doc1 = TextDocument.create('test://doc1.mod', 'nmtran', 1, '$THETA 1');
      const doc2 = TextDocument.create('test://doc2.mod', 'nmtran', 1, '$THETA 2');
      const doc3 = TextDocument.create('test://doc3.mod', 'nmtran', 1, '$THETA 3');
      const doc4 = TextDocument.create('test://doc4.mod', 'nmtran', 1, '$THETA 4');

      documentService.setDocument(doc1);
      documentService.setDocument(doc2);
      documentService.setDocument(doc3);
      documentService.setDocument(doc4); // Should evict doc1

      expect(documentService.getDocument('test://doc1.mod')).toBeUndefined();
      expect(documentService.getDocument('test://doc2.mod')).toBeDefined();
      expect(documentService.getDocument('test://doc3.mod')).toBeDefined();
      expect(documentService.getDocument('test://doc4.mod')).toBeDefined();
    });

    it('should update access order on get', () => {
      const doc1 = TextDocument.create('test://doc1.mod', 'nmtran', 1, '$THETA 1');
      const doc2 = TextDocument.create('test://doc2.mod', 'nmtran', 1, '$THETA 2');
      const doc3 = TextDocument.create('test://doc3.mod', 'nmtran', 1, '$THETA 3');

      documentService.setDocument(doc1);
      documentService.setDocument(doc2);
      documentService.setDocument(doc3);

      // Access doc1 to move it to end of LRU
      documentService.getDocument('test://doc1.mod');

      // Add doc4, should evict doc2 (now oldest)
      const doc4 = TextDocument.create('test://doc4.mod', 'nmtran', 1, '$THETA 4');
      documentService.setDocument(doc4);

      expect(documentService.getDocument('test://doc1.mod')).toBeDefined();
      expect(documentService.getDocument('test://doc2.mod')).toBeUndefined();
    });
  });

  describe('removeDocument', () => {
    it('should remove existing document', () => {
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, '$THETA 1.0');
      documentService.setDocument(doc);

      const removed = documentService.removeDocument('test://test.mod');
      expect(removed).toBe(true);
      expect(documentService.getDocument('test://test.mod')).toBeUndefined();
    });

    it('should return false for non-existent document', () => {
      const removed = documentService.removeDocument('test://nonexistent.mod');
      expect(removed).toBe(false);
    });
  });

  describe('createDocument', () => {
    it('should create a new TextDocument', () => {
      const doc = documentService.createDocument('test://new.mod', 'nmtran', 1, '$THETA 1.0');

      expect(doc.uri).toBe('test://new.mod');
      expect(doc.languageId).toBe('nmtran');
      expect(doc.version).toBe(1);
      expect(doc.getText()).toBe('$THETA 1.0');
    });
  });

  describe('getCacheStats', () => {
    it('should return correct cache statistics', () => {
      const doc1 = TextDocument.create('test://doc1.mod', 'nmtran', 1, '$THETA 1');
      const doc2 = TextDocument.create('test://doc2.mod', 'nmtran', 1, '$THETA 2.0');

      documentService.setDocument(doc1);
      documentService.setDocument(doc2);

      const stats = documentService.getCacheStats();
      expect(stats.documentCount).toBe(2);
      expect(stats.totalSize).toBe('$THETA 1'.length + '$THETA 2.0'.length);
    });

    it('should return zero stats when empty', () => {
      const stats = documentService.getCacheStats();
      expect(stats.documentCount).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });
});
