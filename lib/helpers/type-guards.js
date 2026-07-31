/**
 * @param {unknown} value
 * @returns {value is object}
 */
export function isObject (value) {
  return value !== null && typeof value === 'object'
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject (value) {
  return isObject(value) && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {value is function}
 */
export function isFunction (value) {
  return value !== null && typeof value === 'function'
}
