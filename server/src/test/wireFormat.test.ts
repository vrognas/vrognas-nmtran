/**
 * Wire-format equivalence check.
 *
 * The server's `parsedModel.ts` and the client's `parsedModelApi.ts`
 * define mirror types intentionally — see the JSDoc in each. They must
 * stay structurally identical so positron-nonmem (which depends on the
 * client API) keeps deserialising server responses cleanly.
 *
 * This test compiles bidirectional assignability between every server
 * decl and its client counterpart. Drift fails the build before tests
 * even run; the runtime body is a no-op.
 */

import { describe, it, expect } from 'vitest';
import type {
  ParsedModel,
  ThetaDecl,
  OmegaSigmaDecl,
  Equation,
  PriorDecl,
} from '../parsedModel';
import type {
  NmtranParsedModel,
  NmtranThetaDecl,
  NmtranOmegaSigmaDecl,
  NmtranEquation,
  NmtranPriorDecl,
} from '../../../client/src/parsedModelApi';

// Bidirectional assignability. If a field is added on one side and not
// the other, one of the function bodies fails to compile.
function _serverToClient(s: ParsedModel): NmtranParsedModel {
  return s;
}
function _clientToServer(c: NmtranParsedModel): ParsedModel {
  return c;
}
function _thetaSC(s: ThetaDecl): NmtranThetaDecl {
  return s;
}
function _thetaCS(c: NmtranThetaDecl): ThetaDecl {
  return c;
}
function _omegaSC(s: OmegaSigmaDecl): NmtranOmegaSigmaDecl {
  return s;
}
function _omegaCS(c: NmtranOmegaSigmaDecl): OmegaSigmaDecl {
  return c;
}
function _equationSC(s: Equation): NmtranEquation {
  return s;
}
function _equationCS(c: NmtranEquation): Equation {
  return c;
}
function _priorSC(s: PriorDecl): NmtranPriorDecl {
  return s;
}
function _priorCS(c: NmtranPriorDecl): PriorDecl {
  return c;
}

describe('wire-format equivalence', () => {
  it('server ParsedModel and client NmtranParsedModel are mutually assignable', () => {
    // The real check happens at compile time. Reference the helpers so
    // unused-export linting doesn't strip them.
    expect(_serverToClient).toBeDefined();
    expect(_clientToServer).toBeDefined();
    expect(_thetaSC).toBeDefined();
    expect(_thetaCS).toBeDefined();
    expect(_omegaSC).toBeDefined();
    expect(_omegaCS).toBeDefined();
    expect(_equationSC).toBeDefined();
    expect(_equationCS).toBeDefined();
    expect(_priorSC).toBeDefined();
    expect(_priorCS).toBeDefined();
  });
});
