import { ParameterScanner } from '../services/parameterScanner';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('SAME Keyword Handling', () => {
  beforeEach(() => {
    ParameterScanner.clearCache();
  });

  it('should count SAME as one parameter', () => {
    const content = `$OMEGA  BLOCK(1) 0.0165
$OMEGA  BLOCK(1)  SAME`;
    
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const locations = ParameterScanner.scanDocument(doc);
    
    // Should find 2 parameters: ETA(1) and ETA(2)
    expect(locations).toHaveLength(2);
    
    // ETA(2) should be on line 1 (0-indexed)
    const eta2 = locations.find(loc => loc.type === 'ETA' && loc.index === 2);
    expect(eta2).toBeDefined();
    expect(eta2?.line).toBe(1);
    
    // The character positions should point to "SAME"
    expect(eta2?.startChar).toBe(18);
    expect(eta2?.endChar).toBe(22);
  });
  
  it('should handle multiple SAME keywords', () => {
    const content = `$OMEGA  BLOCK(1) 0.0165
$OMEGA  BLOCK(1)  SAME
$OMEGA  BLOCK(1)  0.495
$OMEGA  BLOCK(1)  SAME`;
    
    const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
    const locations = ParameterScanner.scanDocument(doc);
    
    expect(locations).toHaveLength(4);
    
    // Check that SAME keywords are properly located
    const eta2 = locations.find(loc => loc.type === 'ETA' && loc.index === 2);
    const eta4 = locations.find(loc => loc.type === 'ETA' && loc.index === 4);
    
    expect(eta2?.line).toBe(1);
    expect(eta4?.line).toBe(3);
  });
});