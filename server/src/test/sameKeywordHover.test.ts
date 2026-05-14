/**
 * Test SAME keyword resolution in hover functionality
 */

import { HoverService } from '../services/hoverService';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Hover, MarkupContent } from 'vscode-languageserver/node';
import { createMockConnection, asMockConnection } from './mocks/mockConnection';
import { ParameterScanner } from '../services/parameterScanner';

// Mock connection
const mockConnection = asMockConnection(createMockConnection());

/**
 * Extract the markdown value from a hover result
 */
function getHoverValue(result: Hover | null): string {
  if (!result) return '';
  const contents = result.contents as MarkupContent;
  return contents.value || '';
}

describe('SAME Keyword Hover', () => {
  let hoverService: HoverService;

  beforeEach(() => {
    ParameterScanner.clearCache();
    hoverService = new HoverService(mockConnection);
  });

  test('should resolve SAME keyword to previous parameter value', () => {
    const content = `$PK
  KPCL  = VIS3*ETA(1)+VIS8*ETA(2)

$OMEGA  BLOCK(1) 0.0165           ; IOV CL
$OMEGA  BLOCK(1)  SAME         ; IOV CL`;

    const document = TextDocument.create('test.mod', 'nmtran', 1, content);

    // Test hovering over ETA(2) which should show resolved SAME value
    const position = { line: 1, character: 30 }; // Position inside ETA(2)
    const result = hoverService.provideHover(document, position);

    expect(result).toBeTruthy();
    expect(result?.contents).toHaveProperty('kind', 'markdown');

    // Should show the resolved value from the previous ETA parameter with reference
    const hoverText = getHoverValue(result);
    expect(hoverText).toContain('ETA(2)');
    expect(hoverText).toContain('0.0165 SAME as ETA(1)');
  });

  test('should handle multiple SAME keywords in sequence', () => {
    const content = `$PK
  CL = ETA(1) + ETA(2) + ETA(3)

$OMEGA  BLOCK(1) 0.5
$OMEGA  BLOCK(1) SAME
$OMEGA  BLOCK(1) SAME`;

    const document = TextDocument.create('test.mod', 'nmtran', 1, content);

    // Test hovering over ETA(3) which should resolve to original value
    const position = { line: 1, character: 25 }; // Position of ETA(3)
    const result = hoverService.provideHover(document, position);

    expect(result).toBeTruthy();
    const hoverText = getHoverValue(result);
    expect(hoverText).toContain('ETA(3)');
    expect(hoverText).toContain('0.5 SAME as ETA(1)');
  });

  test('should handle SAME with FIXED keywords', () => {
    const content = `$PK
  CL = ETA(1) + ETA(2)

$OMEGA  BLOCK(1) FIX 0.25
$OMEGA  BLOCK(1) SAME`;

    const document = TextDocument.create('test.mod', 'nmtran', 1, content);

    // Test hovering over ETA(2) which should show both resolved value and FIXED
    const position = { line: 1, character: 16 }; // Position of ETA(2)
    const result = hoverService.provideHover(document, position);

    expect(result).toBeTruthy();
    const hoverText = getHoverValue(result);
    expect(hoverText).toContain('ETA(2)');
    expect(hoverText).toContain('0.25 SAME as ETA(1)');
  });

  test('should handle moxonidine.mod scenario with ETA(5)', () => {
    // Simulating the moxonidine.mod scenario
    const content = `$PK
  KPCL  = VIS3*ETA(4)+VIS8*ETA(5)

$OMEGA  BLOCK(2) FIX 0.0444
  0.027 0.0241    ; IIV (CL-V)
$OMEGA  BLOCK(1) 3.0           ; IIV KA

$OMEGA  BLOCK(1) 0.0165           ; IOV CL
$OMEGA  BLOCK(1)  SAME         ; IOV CL`;

    const document = TextDocument.create('moxonidine.mod', 'nmtran', 1, content);

    // Test hovering over ETA(5) which should show "0.0165 SAME as ETA(4)"
    const position = { line: 1, character: 30 }; // Position of ETA(5) in the $PK section
    const result = hoverService.provideHover(document, position);

    expect(result).toBeTruthy();
    const hoverText = getHoverValue(result);
    expect(hoverText).toContain('ETA(5)');
    expect(hoverText).toContain('0.0165 SAME as ETA(4)');
  });
});