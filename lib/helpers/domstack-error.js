/** @typedef { 'DOM_STACK_ERROR_DUPLICATE_PAGE' | 'DOM_STACK_ERROR_DUPLICATE_SERVICE_WORKER' } DomStackErrorCode */

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
 * Domstack Duplicate Service Worker Error
 * @extends {Error}
 */
export class DomStackDuplicateServiceWorkerError extends Error {
  duplicates

  /**
   * Constructs a new DomStackDuplicateServiceWorkerError instance.
   *
   * @param {string} message - The error message
   * @param {{ files: string[] }} duplicates - Extra params
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
    return 'DOM_STACK_ERROR_DUPLICATE_SERVICE_WORKER'
  }
}

/** @typedef { 'DOM_STACK_WARNING_DUPLICATE_LAYOUT' } DomStackWarningCode */

/**
 * @typedef DomStackWarning
 * @property {DomStackWarningCode} code - The warning code
 * @property {string} message - A human readable message with details
 */
