import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateComIndices } from '../validators/comIndices';

// $ABBREV COMRES=N / COMSAV=N declare the size of the COM() array.
// References to COM(i) where i > COMRES+COMSAV overflow into other data.

function createDocument(content: string): TextDocument {
  return TextDocument.create('test://test.mod', 'nmtran', 1, content);
}

describe('COM Index Validation', () => {
  it('flags COM index that exceeds declared COMRES+COMSAV', () => {
    const content = `
$ABBREV COMRES=1 COMSAV=1
$PRED
COM(1) = LOG(DV)
COM(5) = 0
`;
    const doc = createDocument(content);
    const result = validateComIndices(doc);
    expect(result.isValid).toBe(false);
    const err = result.errors.find(e => e.message.includes('COM(5)'));
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/COMRES\+COMSAV/i);
  });

  it('accepts COM indices within declared limit', () => {
    const content = `
$ABBREV COMRES=2 COMSAV=1
$PRED
COM(1) = 1
COM(2) = 2
COM(3) = 3
`;
    const doc = createDocument(content);
    const result = validateComIndices(doc);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('handles $ABBR short form and only COMRES (no COMSAV)', () => {
    const content = `
$ABBR COMRES=2
$PRED
COM(2) = X
COM(3) = Y
`;
    const doc = createDocument(content);
    const result = validateComIndices(doc);
    expect(result.isValid).toBe(false);
    const err = result.errors.find(e => e.message.includes('COM(3)'));
    expect(err).toBeDefined();
  });

  it('does not flag COM usage when no $ABBREV declaration exists', () => {
    // Without declaration, we do not know the intended limit; stay silent.
    const content = `
$PRED
COM(5) = 0
`;
    const doc = createDocument(content);
    const result = validateComIndices(doc);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
