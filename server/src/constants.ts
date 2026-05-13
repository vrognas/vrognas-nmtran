/**
 * NMTRAN Control Records Dictionary
 * 
 * Complete list of valid NMTRAN control records for validation.
 * Add new control records here when NONMEM adds them.
 * Keep alphabetically sorted for easy maintenance.
 */
export const allowedControlRecords = [
  '$ABBREVIATED',
  '$AES',
  '$AESINITIAL',
  '$ANNEAL',
  '$BIND',
  '$CHAIN',
  '$CONTR',
  '$COVARIANCE',
  '$COVR',
  '$DATA',
  '$DEFAULT',
  '$DES',
  '$DESIGN',
  '$ERROR',
  '$ESTIMATION',
  '$ESTIMATE',
  '$ESTM',
  '$ETAS',
  '$PHIS',
  '$FORMAT',
  '$INDEX',
  '$INDXS',
  '$INFN',
  '$INPUT',
  '$LEVEL',
  '$MIX',
  '$MODEL',
  '$MSFI',
  '$NONPARAMETRIC',
  '$OLKJDF',
  '$OMEGA',
  '$OMEGAP',
  '$OMEGAPD',
  '$OMIT',
  '$OVARF',
  '$PK',
  '$PRED',
  '$PRIOR',
  '$PROBLEM',
  '$RCOV',
  '$RCOVI',
  '$SCATTERPLOT',
  '$SIGMA',
  '$SIGMAP',
  '$SIGMAPD',
  '$SIMULATION',
  '$SIMULATE',
  '$SIML',
  '$SIZES',
  '$SLKJDF',
  '$SUBROUTINES',
  '$SUPER',
  '$SVARF',
  '$TABLE',
  '$THETA',
  '$THI',
  '$THETAI',
  '$THETAP',
  '$THETAPV',
  '$THETAR',
  '$THR',
  '$TOL',
  '$TTDF',
  '$WARNINGS'
];

/**
 * Control records that introduce a block of NMTRAN abbreviated FORTRAN-ish
 * code (assignments, IF/THEN, function calls, etc.). Inside these blocks,
 * lexical conventions differ from the parameter-block records: identifiers
 * are user-defined, infinity tokens are illegal, etc.
 */
export const ABBREVIATED_CODE_BLOCKS = new Set([
  '$AES',
  '$AESINITIAL',
  '$CONTR',
  '$DES',
  '$ERROR',
  '$INFN',
  '$MIX',
  '$PK',
  '$PRED',
]);

/**
 * NMTRAN Reserved Variables
 *
 * Special variables with predefined meanings in NMTRAN abbreviated code.
 */
export const reservedVariables: Record<string, string> = {
  'ICALL': 'Reserved variable — execution context: 0=run init, 1=problem init, 2=analysis, 3=finalization, 4=simulation, 5=expectation, 6=data average',
  'NEWIND': 'Reserved variable — individual record indicator: 0=first record, 1=new individual, 2=continuation record',
  'Y': 'Mandatory left-hand quantity for $PRED — the predicted value or observation under the statistical model',
  'ERR': 'Reserved array — alternative to ETA(n)/EPS(n) for random intra-individual effects',
  'BAYES_EXTRA_REQUEST': 'Bayes extra request indicator (NONMEM ≥ 7.6.0)',
  'BAYES_EXTRA': 'Bayes extra information output (NONMEM ≥ 7.6.0)',
  'ITER_REPORT': 'Iteration reporting indicator (NONMEM ≥ 7.6.0)',
};

/**
 * NMTRAN Reserved Diagnostic Items
 *
 * Diagnostic output names that NMTRAN understands without user definition.
 * Usable directly in $TABLE. Six are always-available and documented; the
 * remaining 37 are reserved but not spelled out in one place in official guides.
 */
export const reservedDiagnosticItems: Record<string, string> = {
  // Always-available, documented
  'PRED': 'Population prediction (typical value, no ETAs)',
  'IPRED': 'Individual prediction (using Empirical Bayes ETAs)',
  'RES': 'Residual: DV − PRED',
  'IRES': 'Individual residual: DV − IPRED',
  'WRES': 'Weighted residual (FO approximation)',
  'IWRES': 'Individual weighted residual',
  // Legacy / alternate spellings
  'IPRD': 'Alternate name for IPRED',
  'IRS': 'Alternate name for IRES',
  'IWRS': 'Alternate name for IWRES',
  // Non-conditional, no eta-epsilon interaction (same as PRED/RES; NWRES == WRES when INTERACTION not set)
  'NPRED': 'Non-conditional population prediction (no eta-epsilon interaction). Same as PRED.',
  'NRES': 'Non-conditional residual (no eta-epsilon interaction). Same as RES.',
  'NWRES': 'Non-conditional weighted residual (no eta-epsilon interaction). Same as WRES when INTERACTION is not set in $EST.',
  // Non-conditional WITH eta-epsilon interaction — always equal to PRED/RES/WRES
  'PREDI': 'Non-conditional population prediction with eta-epsilon interaction. Always same as PRED.',
  'RESI': 'Non-conditional residual with eta-epsilon interaction. Always same as RES.',
  'WRESI': 'Non-conditional weighted residual with eta-epsilon interaction. Always same as WRES.',
  // Conditional estimation, no interaction
  'CPRED': 'Conditional population prediction (no eta-epsilon interaction).',
  'CRES': 'Conditional residual (no eta-epsilon interaction).',
  'CWRES': 'Conditional weighted residual (no eta-epsilon interaction).',
  // Conditional estimation WITH interaction
  'CPREDI': 'Conditional population prediction with eta-epsilon interaction.',
  'CRESI': 'Conditional residual with eta-epsilon interaction.',
  'CWRESI': 'Conditional weighted residual with eta-epsilon interaction.',
  // Conditional individual
  'CIPRED': 'Conditional individual prediction.',
  'CIRES': 'Conditional individual residual.',
  'CIWRES': 'Conditional individual weighted residual.',
  // Conditional individual WITH interaction
  'CIPREDI': 'Conditional individual prediction with eta-epsilon interaction.',
  'CIRESI': 'Conditional individual residual with eta-epsilon interaction.',
  'CIWRESI': 'Conditional individual weighted residual with eta-epsilon interaction.',
  // First-order individual variants (following the NI- pattern)
  'NIPRED': 'Non-conditional individual prediction (first-order, no interaction).',
  'NIRES': 'Non-conditional individual residual (first-order, no interaction).',
  'NIWRES': 'Non-conditional individual weighted residual (first-order, no interaction).',
  // I-suffix individual variants
  'IPREDI': 'Individual prediction with eta-epsilon interaction.',
  'IRESI': 'Individual residual with eta-epsilon interaction.',
  'IWRESI': 'Individual weighted residual with eta-epsilon interaction.',
  // Monte-Carlo / Expected — simulation-based diagnostics
  'EPRED': 'Monte-Carlo generated population prediction.',
  'ERES': 'Monte-Carlo generated residual.',
  'EWRES': 'Monte-Carlo generated weighted residual (the Monte-Carlo version of CWRESI).',
  'EIPRED': 'Monte-Carlo generated individual prediction.',
  'EIRES': 'Monte-Carlo generated individual residual.',
  'EIWRES': 'Monte-Carlo generated individual weighted residual.',
  'ECWRES': 'Monte-Carlo version of CWRES.',
  // Specialized diagnostics
  'NPDE': 'Monte-Carlo generated normalized probability distribution error.',
  'NPD': 'Non-decorrelated (correlated) NPDE value.',
  'OBJI': 'Objective function value for each individual.',
};

/**
 * NMTRAN Reserved Functions and Vectors (NONMEM 7.4+)
 *
 * Reserved function names FUNCA through FUNCZ and vector names VECTRA through VECTRZ.
 */
export const reservedFunctions = [
  // Reserved functions A-Z
  ...Array.from({length: 26}, (_, i) => `FUNC${String.fromCharCode(65 + i)}`),
  // Reserved vectors A-Z  
  ...Array.from({length: 26}, (_, i) => `VECTR${String.fromCharCode(65 + i)}`)
];

/**
 * NMTRAN Protective Functions (NONMEM 7.4+)
 * 
 * Functions that protect against domain violations and floating point errors.
 */
export const protectiveFunctions = [
  'PLOG', 'PEXP', 'PSQRT', 'PSIN', 'PCOS', 'PTAN'
];

/**
 * NMTRAN Generated Files
 * 
 * Files automatically generated by NMTRAN during translation process.
 */
export const generatedFiles = [
  'FDATA', 'FCON', 'FSTREAM', 'FREPORT', 'FLIB', 'LINK'
];

/**
 * FORTRAN Format Codes (NONMEM v7.6.0+)
 * 
 * Format specifiers used in $DATA record format specifications for numeric data formatting.
 * 
 * @example
 * // Format specification: (3(F3.1,2X),E6.2)
 * // Reads: 3 groups of [fixed-point number width 3 with 1 decimal, 2 spaces], then scientific notation width 6 with 2 decimals
 * 
 * Format codes:
 * - E: Scientific notation (exponential) - e.g., E13.4 = field width 13, 4 decimal places
 * - F: Fixed-point decimal notation - e.g., F8.3 = field width 8, 3 decimal places  
 * - X: Horizontal spacing/skip - e.g., 2X = skip 2 character positions
 * - D: Double precision exponential - similar to E but for double precision
 * - G: General format (chooses E or F based on magnitude) - e.g., G12.4
 * - I: Integer format - e.g., I4 = integer field width 4
 */
export const formatCodes = [
  'E', 'F', 'X', 'D', 'G', 'I'
];
