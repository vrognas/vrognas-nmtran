import { describe, it, expect, beforeEach } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Hover, MarkupContent, Connection } from 'vscode-languageserver/node';
import { HoverService } from '../services/hoverService';
import { CompletionService } from '../services/completionService';
import { ParameterScanner } from '../services/parameterScanner';
import { createMockConnection, asMockConnection } from './mocks/mockConnection';

const mockConnection = asMockConnection(createMockConnection());

function getHoverValue(result: Hover | null): string {
  if (!result) return '';
  const contents = result.contents as MarkupContent;
  return contents.value || '';
}

describe('Reserved Diagnostic Items', () => {
  beforeEach(() => ParameterScanner.clearCache());

  describe('Hover', () => {
    it('shows description when hovering CWRES', () => {
      const svc = new HoverService(mockConnection);
      const content = `$TABLE TIME CWRES\n`;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      // Position cursor in the middle of "CWRES"
      const offset = content.indexOf('CWRES') + 2;
      const position = doc.positionAt(offset);
      const hover = svc.provideHover(doc, position);
      expect(hover).not.toBeNull();
      expect(getHoverValue(hover).toLowerCase()).toContain('conditional weighted');
    });

    it('shows description when hovering NPDE', () => {
      const svc = new HoverService(mockConnection);
      const content = `$TABLE ID NPDE\n`;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      const offset = content.indexOf('NPDE') + 1;
      const position = doc.positionAt(offset);
      const hover = svc.provideHover(doc, position);
      expect(hover).not.toBeNull();
      expect(getHoverValue(hover).toLowerCase()).toContain('probability distribution');
    });
  });

  describe('Completion', () => {
    it('suggests diagnostic items inside $TABLE', () => {
      const svc = new CompletionService(mockConnection as unknown as Connection);
      const content = `$TABLE TIME `;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      const position = { line: 0, character: content.length };
      const completions = svc.provideCompletions(doc, position);
      const labels = completions.map(c => c.label);
      expect(labels).toContain('CWRES');
      expect(labels).toContain('IPRED');
      expect(labels).toContain('NPDE');
    });

    it('filters by prefix when user is typing', () => {
      const svc = new CompletionService(mockConnection as unknown as Connection);
      const content = `$TABLE TIME CW`;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      const position = { line: 0, character: content.length };
      const completions = svc.provideCompletions(doc, position);
      const labels = completions.map(c => c.label);
      expect(labels).toContain('CWRES');
      expect(labels).toContain('CWRESI');
      expect(labels).not.toContain('IPRED'); // doesn't match "CW"
    });

    it('does not suggest diagnostic items outside $TABLE (e.g. in $PK)', () => {
      const svc = new CompletionService(mockConnection as unknown as Connection);
      const content = `$PK\nCL = THETA(1)\nV = `;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      const position = { line: 2, character: content.length };
      const completions = svc.provideCompletions(doc, position);
      const labels = completions.map(c => c.label);
      expect(labels).not.toContain('CWRES');
    });

    it('recognizes $TABLE abbreviations (e.g. $TAB)', () => {
      const svc = new CompletionService(mockConnection as unknown as Connection);
      const content = `$TAB TIME `;
      const doc = TextDocument.create('test://test.mod', 'nmtran', 1, content);
      const position = { line: 0, character: content.length };
      const completions = svc.provideCompletions(doc, position);
      const labels = completions.map(c => c.label);
      expect(labels).toContain('CWRES');
    });
  });
});
