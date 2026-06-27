/** @typedef { 'DOM_STACK_ERROR_DUPLICATE_PAGE' | 'DOM_STACK_ERROR_OUTPUT_CONFLICT' } DomStackErrorCode */

/**
 * @typedef DomStackOutputConflictErrorClaim
 * @property {'page'} type - The kind of output producer.
 * @property {string} path - Human-readable source or output path for the producer.
 */

/**
 * Domstack Duplicate Page Error
 * @extends {Error}
 */
export class DomStackDuplicatePageError extends Error {
  duplicates
  /**
   * Error code
   * @type {DomStackErrorCode}
   */

  /**
   * Constructs a new DomStackAggregateError instance.
   *
   * @param {string} message - The error message
   * @param {{ a: string, b: string }} duplicates - Extra params
   * @param {ErrorOptions} [opts] - The opts object from the Error class
   */
  constructor (message, duplicates, opts) {
    super(message, opts)
    this.duplicates = duplicates
  }

  /**
   * @returns {DomStackErrorCode}
   */
  get code () {
    return 'DOM_STACK_ERROR_DUPLICATE_PAGE'
  }
}

/**
 * DomStack Output Conflict Error
 * @extends {Error}
 */
export class DomStackOutputConflictError extends Error {
  /** @type {{ outputPath: string, a: DomStackOutputConflictErrorClaim, b: DomStackOutputConflictErrorClaim }} */
  conflict

  /**
   * @param {string} message - The error message
   * @param {{ outputPath: string, a: DomStackOutputConflictErrorClaim, b: DomStackOutputConflictErrorClaim }} conflict - Conflict metadata
   * @param {ErrorOptions} [opts] - The opts object from the Error class
   */
  constructor (message, conflict, opts) {
    super(message, opts)
    this.conflict = conflict
  }

  /**
   * @returns {DomStackErrorCode}
   */
  get code () {
    return 'DOM_STACK_ERROR_OUTPUT_CONFLICT'
  }
}

/** @typedef { 'DOM_STACK_WARNING_DUPLICATE_LAYOUT' } DomStackWarningCode */

/**
 * @typedef DomStackWarning
 * @property {DomStackWarningCode} code - The warning code
 * @property {string} message - A human readable message with details
 */
