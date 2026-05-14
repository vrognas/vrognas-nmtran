/**
 * Hover descriptions for NMTRAN control records.
 *
 * Lookup table — keyed by canonical full-name records ($THETA, $ESTIMATION,
 * etc.) plus their common abbreviations ($ESTM, $SUBS, ...). Used by the
 * hover service to render an inline explanation for any `$RECORD` token
 * the cursor lands on.
 */

const CONTROL_RECORD_DOCS: Record<string, string> = {
  $ABBREVIATED: 'Provides instructions about abbreviated code',
  $AES: 'Marks the beginning of abbreviated code for the AES routine',
  $AESINITIAL: 'Marks the beginning of abbreviated code for the AES routine',
  $ANNEAL: 'Sets starting diagonal Omega values to facilitate EM search methods',
  $BIND: 'Define data values used by `$PK`, `$DES`, and `$AES`',
  $CHAIN: 'Supplies initial estimates for an entire problem run.',
  $CONTR: 'Defines values for certain user-supplied routines',
  $COVARIANCE:
    'This step outputs: standard errors, covariance matrix, inverse covariance matrix, and the correlation form of the covariance matrix.',
  $COVR: 'Synonym for $COVARIANCE.',
  $DATA: 'Describes the NMTRAN data set.',
  $DEFAULT: 'Specifies certain defaults for NONMEM.',
  $DES: 'Used to compute differential equations.',
  $DESIGN: 'Instructions for Clinical Trial Design Evaluation and Optimization',
  $ERROR: 'Used to calculate the model result and intra-individual error in observed values.',
  $ESTIMATION: 'Obtains parameter estimate.',
  $ESTM: 'Obtains parameter estimate. More commonly coded as `$ESTIMATION`.',
  $ESTIMATE: 'Obtains parameter estimate. More commonly coded as `$ESTIMATION`',
  $ETAS: 'Specifies initial values for ETAs.',
  $PHIS: 'Specifies initial values for PHIs.',
  $FORMAT: 'Specifies significant digits for the NONMEM report file',
  $INDEX: 'Defines values for the PRED/PREDPP INDXS array',
  $INDXS: 'Defines values for the PRED/PREDPP INDXS array',
  $INFN:
    'Used to describe initialization processing for a NONMEM run, or NONMEM problem, or finalization processing for a NONMEM problem. It is used with PREDPP.',
  $INPUT:
    'Required. The items define the data item types that appear in the NMTRAN data records, and define the order of their appearance.',
  $LEVEL: 'Specifies nested random levels above subject ID.',
  $MIX:
    'Used to describe the mixture probabilities of a mixture model. It is evaluated with individual records.',
  $MODEL:
    'Specifies the MODEL subroutine of PREDPP. Required with a general ADVAN (5,6,7,8,9,13,14,15,16,17,18).',
  $MSFI: 'Gives the name of an input Model Specification File.',
  $NONPARAMETRIC:
    'Optional. When present, the `$ESTIMATION` record must also be present and must specify `METHOD=1` or `POSTHOC`.',
  $OLKJDF:
    'Specifies LKJ decorrelation degrees of freedom for each OMEGA block. OLKJDF is an option of the `$ESTIMATION` record. `$OLKJDF` is a separate record that allows the user to specify LKJ decorrelation degrees of freedom for each OMEGA block.',
  $OMEGA: 'Supplies initial estimates for the NONMEM OMEGA Matrix',
  $OMEGAP: 'Gives prior information for elements of the OMEGA matrix',
  $OMEGAPD: 'Gives degrees of freedom (also called the dispersion factor) for OMEGA priors',
  $OMIT:
    'Optional. If a label of a data item type listed in the `$INPUT` record, or a synonym for such a data item type, appears in the `$OMIT` record, then data items of this type are excluded from template matching.',
  $OVARF:
    'Specifies the weighting to the standard deviations of OMEGA. The `$OVARF` is a separate record that allows the user to specify the weighting (inverse variance) to the standard deviations LKJ decorrelation degrees of freedom for each OMEGA block. Used with NUTS method.',
  $PK:
    'Used to model the values of basic and additional pharmacokinetic parameters. It is used with PREDPP. Basic PK parameters are typically the rate constants ("micro-constants") for use in kinetic formulas. $PK can compute instead parameters such as clearance and volume, and a translator ("TRANS") subroutine can be used to convert these to rate constants.',
  $PRED: 'Used to model values for the DV data items. It is NOT used with PREDPP.',
  $PRIOR:
    'Optional. Specifies the use of the PRIOR feature of NONMEM. Note that `$PRIOR` is a control record, not a block of abbreviated code. Therefore, only those options that are listed here may be used. E.g., verbatim code may not be used. Options and arguments may be in any order, and may be on more than one line.',
  $PROBLEM:
    'Required. Identifies the start of a NONMEM problem specification. The text becomes a heading for the NONMEM printout.',
  $RCOV:
    'Used to load the variance-covariance matrix of estimates results from a previous problem, and use it for subsequent use in assessing total standard errors of table items without having to re-calculate the variance with a `$COVARIANCE` step.',
  $RCOVI:
    'Used to load the the variance-covariance information from the inverse-covariance file from a previous problem, and use it for subsequent use in assessing total standard errors of table items without having to re-calculate the variance with a `$COVARIANCE` step.',
  $SCATTERPLOT: 'Requests that NONMEM generate one or more scatterplots',
  $SIGMA: 'Supplies initial estimates for the NONMEM SIGMA Matrix',
  $SIGMAP: 'Gives prior information for elements of the SIGMA matrix',
  $SIGMAPD: 'Gives degrees of freedom (also called the dispersion factor) for SIGMA priors',
  $SIMULATION: 'Optional. Requests that the NONMEM Simulation Step be implemented.',
  $SIMULATE:
    'Optional. Requests that the NONMEM Simulation Step be implemented. More commonly coded as `$SIMULATION`.',
  $SIML:
    'Optional. Requests that the NONMEM Simulation Step be implemented. More commonly coded as `$SIMULATION`.',
  $SIZES:
    'Optional. Defines Array sizes for NONMEM and PREDPP. If present, it must precede the first `$PROBLEM` or `$SUPER` record.',
  $SLKJDF:
    'Specifies LKJ decorrelation degrees of freedom for each SIGMA block. SLKJDF is an option of the `$ESTIMATION` record. `$SLKJDF` is a separate record that allows the user to specify LKJ decorrelation degrees of freedom for each SIGMA block.',
  $SUBROUTINES:
    'Optional. Describes the choice of subroutines for the NONMEM executable (also called the NONMEM load module).',
  $SUBS:
    'Optional. Describes the choice of subroutines for the NONMEM executable (also called the NONMEM load module). More commonly coded as `$SUBROUTINES`.',
  $SUPER: 'Optional. Identifies the start of a NONMEM Superproblem.',
  $SVARF: 'Specifies the weighting to the standard deviations of SIGMA.',
  $TABLE:
    'Requests that a NONMEM table be produced. Up to 10 `$TABLE` records may be included in a given problem.',
  $THETA:
    'Gives initial estimates and bounds for elements of the THETA matrix. Thetas are numbered in the order in which they are defined.',
  $THETAI: 'Gives Instructions for Transforming Initial Thetas.',
  $THI: 'Gives Instructions for Transforming Initial Thetas. More commonly coded as `$THETAI`.',
  $THETAP: 'Gives prior information for elements of the THETA matrix',
  $THETAPV: 'Gives variance information for THETA priors.',
  $THETAR: 'Gives Instructions for Transforming Final Thetas',
  $THR: 'Gives Instructions for Transforming Final Thetas. More commonly coded as `$THETAR`.',
  $TOL:
    'Used to specify compartment-specific NRD values. It is used with PREDPP’s general non-linear models (ADVAN6, ADVAN8, ADVAN9, ADVAN13, ADVAN14, ADVAN15, ADVAN16, ADVAN17, ADVAN18, and SS6 and SS9). NRD stands for "Number of Required Digits," although the precise meaning depends on the particular ADVAN or SS routine that uses it.',
  $TTDF: 'Specifies t-distribution degrees of freedom for theta',
  $WARNINGS: 'Control Display of NMTRAN Warning, Data Warning and Data Error messages',
};

/**
 * Return the hover-text for a control record. When the caller passes both
 * the literal text and the resolved full name (because the user typed an
 * abbreviation), the full name wins so abbreviations get the same docs as
 * their canonical form.
 */
export function explainControlRecordHover(
  controlRecord: string,
  fullControlRecord: string,
): string {
  const key = controlRecord !== fullControlRecord ? fullControlRecord : controlRecord;
  return CONTROL_RECORD_DOCS[key] ?? `${key} not recognized.`;
}
