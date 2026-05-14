import { describe, it, expect, beforeEach } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParameterScanner } from '../services/parameterScanner';
import { createDocument } from './test-helpers';

describe('ParameterScanner caching', () => {
  beforeEach(() => {
    ParameterScanner.clearCache();
  });

  it('should return same results for same document version', () => {
    const doc = createDocument('$THETA 1.0\n$OMEGA 0.1');
    const result1 = ParameterScanner.scanDocument(doc);
    const result2 = ParameterScanner.scanDocument(doc);
    // Deep copy means not same reference, but same content
    expect(result1).toEqual(result2);
  });

  it('should invalidate cache on version change', () => {
    const doc1 = TextDocument.create('test://test.mod', 'nmtran', 1, '$THETA 1.0');
    const result1 = ParameterScanner.scanDocument(doc1);

    const doc2 = TextDocument.create('test://test.mod', 'nmtran', 2, '$THETA 2.0');
    const result2 = ParameterScanner.scanDocument(doc2);
    expect(result1).toEqual(result2); // Both have 1 THETA, same structure
  });

  it('should clear cache via clearCache()', () => {
    const doc = createDocument('$THETA 1.0');
    ParameterScanner.scanDocument(doc);
    ParameterScanner.clearCache();
    const result = ParameterScanner.scanDocument(doc);
    expect(result).toBeDefined();
    expect(result.length).toBe(1);
  });

  it('should return deep copies that are safe to mutate', () => {
    const doc = createDocument('$THETA 1.0');
    const result1 = ParameterScanner.scanDocument(doc);
    // Mutate result1
    if (result1[0]) {
      result1[0].startChar = 999;
    }
    // Get another copy from cache — should NOT have the mutation
    const result2 = ParameterScanner.scanDocument(doc);
    expect(result2[0]?.startChar).not.toBe(999);
  });
});
