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
    const current = Object.create(null)
    for (const key of Object.keys(globalData)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalData, key)
      current[key] = descriptor && 'value' in descriptor ? fingerprint(descriptor.value) : null
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
    if (serialized === undefined) return null
    return createHash('sha256').update(serialized).digest('hex')
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
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false
    ancestors.add(value)
    // Check every index explicitly: array iteration skips holes, which could
    // otherwise hide an extra named property behind the own-key count check.
    let safe = true
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (!descriptor?.enumerable || !('value' in descriptor) || !isFingerprintSafe(descriptor.value, ancestors)) {
        safe = false
        break
      }
    }
    ancestors.delete(value)
    return safe
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false

  ancestors.add(value)
  const safe = Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) return false
    return isFingerprintSafe(descriptor.value, ancestors)
  })
  ancestors.delete(value)
  return safe
}
