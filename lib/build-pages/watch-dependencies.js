import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../helpers/stable-json-stringify.js'

/**
 * @typedef {'page' | 'template' | 'pages-file'} WatchConsumerType
 *
 * @typedef {object} WatchConsumer
 * @property {WatchConsumerType} type
 * @property {string} key
 * @property {string | undefined} [ownerPath]
 * @property {string[]} globalDataKeys
 *
 * @typedef {object} WatchDependencyState
 * @property {Record<string, WatchConsumer>} consumers
 * @property {Record<string, string | null>} globalDataFingerprints
 */

/**
 * Store declarative global-data subscriptions and compare top-level data values.
 */
export class WatchDependencyTracker {
  /** @type {WatchDependencyState} */
  #state
  /** @type {boolean} */
  #enabled

  /**
   * @param {WatchDependencyState | null | undefined} previousState
   * @param {{ fullBuild: boolean, enabled?: boolean }} options
   */
  constructor (previousState, { fullBuild, enabled = true }) {
    this.#enabled = enabled
    this.#state = fullBuild || !previousState
      ? createWatchDependencyState()
      : structuredClone(previousState)
  }

  get state () {
    return this.#state
  }

  /**
   * Replace the declared subscriptions for one consumer.
   *
   * @param {WatchConsumerType} type
   * @param {string} key
   * @param {string[]} globalDataKeys
   * @param {{ ownerPath?: string }} [metadata]
   */
  registerConsumer (type, key, globalDataKeys, metadata = {}) {
    if (!this.#enabled) return
    this.#state.consumers[consumerId(type, key)] = {
      type,
      key,
      ownerPath: metadata.ownerPath,
      globalDataKeys: [...globalDataKeys].sort(),
    }
  }

  /**
   * Store fingerprints for the current global-data result and return changed keys.
   *
   * Values that cannot be serialized without losing observable data receive a null fingerprint and are treated as
   * changed on every build.
   *
   * @param {Record<string, unknown>} globalData
   * @param {Record<string, string | null> | null | undefined} previousFingerprints
   * @returns {Set<string>}
   */
  updateGlobalDataFingerprints (globalData, previousFingerprints) {
    if (!this.#enabled) return new Set()

    /** @type {Record<string, string | null>} */
    const current = {}
    for (const [key, value] of Object.entries(globalData)) {
      current[key] = fingerprint(value)
    }

    const changed = new Set()
    const allKeys = new Set([
      ...Object.keys(previousFingerprints ?? {}),
      ...Object.keys(current),
    ])

    for (const key of allKeys) {
      const previous = previousFingerprints?.[key]
      const next = current[key]
      if (previous == null || next == null || previous !== next) changed.add(key)
    }

    this.#state.globalDataFingerprints = current
    return changed
  }

  /**
   * Find consumers subscribed to any changed global-data key.
   *
   * The previous successful state is authoritative for invalidation.
   * A consumer whose declaration changes is already selected by its source-file event.
   *
   * @param {WatchDependencyState | null | undefined} previousState
   * @param {Set<string>} changedGlobalDataKeys
   * @returns {WatchConsumer[]}
   */
  getInvalidatedConsumers (previousState, changedGlobalDataKeys) {
    if (!this.#enabled || !previousState || changedGlobalDataKeys.size === 0) return []

    return Object.values(previousState.consumers).filter(consumer => {
      return consumer.globalDataKeys.some(key => changedGlobalDataKeys.has(key))
    })
  }

  /**
   * Remove subscriptions for generated pages that no longer exist.
   *
   * @param {Set<string>} currentGeneratedPageKeys
   * @param {Set<string> | null} rebuiltOwnerPaths - Null when every owner was rebuilt.
   */
  pruneGeneratedPages (currentGeneratedPageKeys, rebuiltOwnerPaths = null) {
    if (!this.#enabled) return

    for (const [id, consumer] of Object.entries(this.#state.consumers)) {
      if (
        consumer.type === 'page' &&
        consumer.ownerPath &&
        (rebuiltOwnerPaths === null || rebuiltOwnerPaths.has(consumer.ownerPath)) &&
        !currentGeneratedPageKeys.has(consumer.key)
      ) {
        delete this.#state.consumers[id]
      }
    }
  }
}

/**
 * Read and validate a dataDependencies declaration.
 *
 * @param {unknown} value
 * @param {string} label
 * @returns {string[]}
 */
export function resolveDataDependencies (value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} dataDependencies must be an array of strings`)
  }

  /** @type {string[]} */
  const dependencies = []
  for (const key of value) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`${label} dataDependencies must contain non-empty strings`)
    }
    if (!dependencies.includes(key)) dependencies.push(key)
  }
  return dependencies.sort()
}

/**
 * Remove reserved dependency metadata from a vars object.
 *
 * @template {Record<string, any>} T
 * @param {T | null | undefined} vars
 * @param {string} label
 * @returns {{ vars: T, dataDependencies: string[] }}
 */
export function extractDataDependencies (vars, label) {
  const source = vars ?? /** @type {T} */ ({})
  const dataDependencies = resolveDataDependencies(source['dataDependencies'], label)
  if (!Object.hasOwn(source, 'dataDependencies')) return { vars: source, dataDependencies }

  const { dataDependencies: _dataDependencies, ...contentVars } = source
  return {
    vars: /** @type {T} */ (contentVars),
    dataDependencies,
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
      throw new Error(`${label} subscribes to missing global data key "${key}"`)
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
        throw new Error(`${label} accessed undeclared global data key "${property}"`)
      }
      return Reflect.get(target, property, receiver)
    },
    has: (target, property) => {
      if (
        typeof property === 'string' &&
        Object.hasOwn(globalData, property) &&
        !declared.has(property)
      ) {
        throw new Error(`${label} checked undeclared global data key "${property}"`)
      }
      return Reflect.has(target, property)
    },
  })
}

/**
 * @returns {WatchDependencyState}
 */
function createWatchDependencyState () {
  return {
    consumers: {},
    globalDataFingerprints: {},
  }
}

/**
 * @param {WatchConsumerType} type
 * @param {string} key
 */
function consumerId (type, key) {
  return `${type}\0${key}`
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function fingerprint (value) {
  try {
    if (!isFingerprintSafe(value, new Set())) return null
    const serialized = stableJsonStringify(value)
    if (serialized === undefined && value !== undefined) return null
    return createHash('sha256').update(serialized ?? 'undefined').digest('hex')
  } catch {
    return null
  }
}

/**
 * Reject values whose observable shape JSON serialization would silently lose.
 * A null fingerprint intentionally invalidates subscribers on every build.
 *
 * @param {unknown} value
 * @param {Set<object>} ancestors
 * @returns {boolean}
 */
function isFingerprintSafe (value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false
    ancestors.add(value)
    const safe = value.every(item => isFingerprintSafe(item, ancestors))
    ancestors.delete(value)
    return safe
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false

  ancestors.add(value)
  const safe = Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key)) return false
    return isFingerprintSafe(Reflect.get(value, key), ancestors)
  })
  ancestors.delete(value)
  return safe
}
