import { DomStackDataError } from '../helpers/domstack-error.js'

/**
 * A readonly subscription list checked against a consumer's data contract.
 * @template {object} D
 * @typedef {readonly Extract<keyof D, string>[]} DataDeps
 */

/**
 * Read and validate a dataDeps declaration.
 *
 * @param {unknown} value
 * @param {string} label
 * @returns {string[]}
 */
export function resolveDataDeps (value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new DomStackDataError(`${label} dataDeps must be an array of strings`, { reason: 'INVALID_DECLARATION', consumer: label })
  }

  /** @type {Set<string>} */
  const dependencies = new Set()
  for (const key of value) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new DomStackDataError(`${label} dataDeps must contain non-empty strings`, { reason: 'INVALID_DECLARATION', consumer: label })
    }
    dependencies.add(key)
  }
  return [...dependencies].sort()
}

/**
 * Remove reserved dependency metadata from a vars object.
 *
 * @template {Record<string, any>} T
 * @param {T | null | undefined} vars
 * @param {string} label
 * @returns {{ vars: Omit<T, 'dataDeps'>, dataDeps: string[] }}
 */
export function extractDataDeps (vars, label) {
  const source = vars ?? /** @type {T} */ ({})
  const dataDeps = resolveDataDeps(source['dataDeps'], label)
  if (!Object.hasOwn(source, 'dataDeps')) return { vars: source, dataDeps }

  const { dataDeps: _dataDeps, ...contentVars } = source
  return {
    vars: contentVars,
    dataDeps,
  }
}

/**
 * Give a consumer only the global-data keys it declared.
 *
 * The small proxy is an access guard, not an observation mechanism.
 * It throws when user code attempts to read a real global-data key that it did not
 * declare, while symbols and unrelated missing properties keep normal object behavior.
 *
 * @param {Record<string, unknown>} globalData
 * @param {string[]} dependencies
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
export function createSubscribedData (globalData, dependencies, label) {
  const selected = Object.create(null)

  for (const key of dependencies) {
    if (!Object.hasOwn(globalData, key)) {
      throw new DomStackDataError(`${label} subscribes to missing global data key "${key}"`, { reason: 'MISSING_KEY', consumer: label, key })
    }
    selected[key] = globalData[key]
  }

  const frozen = Object.freeze(selected)
  const declared = new Set(dependencies)
  return new Proxy(frozen, {
    get: (target, property, receiver) => {
      if (
        typeof property === 'string' &&
        Object.hasOwn(globalData, property) &&
        !declared.has(property)
      ) {
        throw new DomStackDataError(`${label} accessed undeclared global data key "${property}"`, { reason: 'UNDECLARED_KEY', consumer: label, key: property })
      }
      return Reflect.get(target, property, receiver)
    },
    has: (target, property) => {
      if (
        typeof property === 'string' &&
        Object.hasOwn(globalData, property) &&
        !declared.has(property)
      ) {
        throw new DomStackDataError(`${label} checked undeclared global data key "${property}"`, { reason: 'UNDECLARED_KEY', consumer: label, key: property })
      }
      return Reflect.has(target, property)
    },
  })
}
