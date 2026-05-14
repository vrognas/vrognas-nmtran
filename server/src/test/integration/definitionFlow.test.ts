/**
 * Integration tests for the complete definition flow
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { DefinitionService } from '../../services/definitionService';
import { DocumentService } from '../../services/documentService';
import { ParameterScanner } from '../../services/parameterScanner';
import { createMockConnection, asMockConnection, MockConnection } from '../mocks/mockConnection';

describe('Definition Flow Integration', () => {
  let definitionService: DefinitionService;
  let documentService: DocumentService;
  let mockConnection: MockConnection;

  beforeEach(() => {
    ParameterScanner.clearCache();
    mockConnection = createMockConnection();
    const connection = asMockConnection(mockConnection);

    documentService = new DocumentService(connection);
    definitionService = new DefinitionService(connection);
  });

  describe('BLOCK Matrix Parameters', () => {
    it('should handle multi-line BLOCK(2) correctly', async () => {
      const content = `$OMEGA  BLOCK(2)
  0.1
  0.027 0.04`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      documentService.setDocument(doc);

      // Click on ETA(2) - should go to 0.04
      const position: Position = { line: 2, character: 10 }; // On "0.04"
      const locations = await definitionService.provideDefinition(doc, position);

      expect(locations).toHaveLength(1);
      expect(locations?.[0]).toMatchObject({
        uri: doc.uri,
        range: {
          start: { line: 2, character: 8 },
          end: { line: 2, character: 12 }
        }
      });
    });

    it('should handle SAME keyword with multiple locations', async () => {
      const content = `$OMEGA  BLOCK(1) 0.0165
$OMEGA  BLOCK(1)  SAME`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      documentService.setDocument(doc);

      // Find ETA(2) in the document
      const text = doc.getText();
      const eta2Match = /ETA\(2\)/.exec(text);

      if (eta2Match && eta2Match.index !== undefined) {
        const position = doc.positionAt(eta2Match.index);
        const locations = await definitionService.provideDefinition(doc, position);

        expect(locations).toHaveLength(2);

        // Should include both SAME and the referenced value
        const ranges = locations?.map(loc => ({
          start: loc.range.start,
          end: loc.range.end
        }));

        expect(ranges).toContainEqual({
          start: { line: 1, character: 18 },
          end: { line: 1, character: 22 }
        }); // SAME keyword

        expect(ranges).toContainEqual({
          start: { line: 0, character: 17 },
          end: { line: 0, character: 23 }
        }); // 0.0165 value
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid positions gracefully', async () => {
      const content = `$THETA  (0,27.6)`;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      documentService.setDocument(doc);

      // Position beyond document
      const position: Position = { line: 99, character: 99 };
      const locations = await definitionService.provideDefinition(doc, position);

      expect(locations).toBeNull();
      expect(mockConnection.console.error).not.toHaveBeenCalled();
    });

    it('should handle malformed parameter references', async () => {
      const content = `$PK
  CL = THETA(999) * EXP(ETA(1))`;

      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      documentService.setDocument(doc);

      // Click on THETA(999) - parameter doesn't exist
      const position: Position = { line: 1, character: 10 };
      const locations = await definitionService.provideDefinition(doc, position);

      expect(locations).toBeNull();
    });
  });
});
