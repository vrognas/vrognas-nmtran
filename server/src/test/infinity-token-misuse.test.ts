import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateInfinityTokenUsage } from '../validators/infinityTokens';

// INF / INFINITY / INFIN / INFTY are lexical tokens valid only inside $THETA bound triples.
// Using them as identifiers in abbreviated code produces NMTRAN ERROR 208 (UNDEFINED VARIABLE).

function createDocument(content: string): TextDocument {
  return TextDocument.create('test://test.mod', 'nmtran', 1, content);
}

describe('Infinity Token Misuse Validation', () => {
  it('flags bare INF in $PRED', () => {
    const content = `
$THETA 1
$OMEGA 0.1
$PRED
A = INF
Y = A
`;
    const doc = createDocument(content);
    const result = validateInfinityTokenUsage(doc);
    expect(result.isValid).toBe(false);
    const err = result.errors.find(e => e.message.includes('INF'));
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/only valid.*\$THETA/i);
  });

  it('flags INFINITY, INFIN, INFTY in abbreviated code', () => {
    const content = `
$THETA 1
$OMEGA 0.1
$PK
CL = INFINITY
V = INFIN
KA = INFTY
`;
    const doc = createDocument(content);
    const result = validateInfinityTokenUsage(doc);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it('does not flag INF tokens inside $THETA bound triples', () => {
    const content = `
$THETA (-INF,1,INF) (-INFTY,2,INFTY) (-INFIN,3,INFIN) (-INFINITY,4,INFINITY)
$PRED
Y = A
`;
    const doc = createDocument(content);
    const result = validateInfinityTokenUsage(doc);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('does not match identifiers that merely start with INF (e.g. INFO, INFN, INFNTY)', () => {
    // Word-boundary must prevent false positives.
    const content = `
$PRED
INFO = 1
INFN = 2
INFNTY = 3
Y = INFO + INFN + INFNTY
`;
    const doc = createDocument(content);
    const result = validateInfinityTokenUsage(doc);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches signed forms (-INF, +INF) in abbreviated code', () => {
    const content = `
$ERROR
Y = -INF
W = +INFINITY
`;
    const doc = createDocument(content);
    const result = validateInfinityTokenUsage(doc);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});
