import { fingerprint } from './fingerprint.js'

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
    for (const key of Object.keys(previousFingerprints ?? {})) {
      const previous = previousFingerprints?.[key]
      const next = current[key]
      if (previous == null || next == null || previous !== next) changed.add(key)
    }

    // Preserve union order: previous enumerable keys, then current-only keys.
    for (const key of Object.keys(current)) {
      if (previousFingerprints && Object.prototype.propertyIsEnumerable.call(previousFingerprints, key)) continue
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

    /** @type {WatchConsumer[]} */
    const invalidated = []
    const consumers = previousState.consumers
    for (const id in consumers) {
      if (!Object.hasOwn(consumers, id)) continue
      const consumer = /** @type {WatchConsumer} */ (consumers[id])
      if (consumer.globalDataKeys.some(key => changedGlobalDataKeys.has(key))) invalidated.push(consumer)
    }
    return invalidated
  }

  /**
   * Remove subscriptions for generated pages that no longer exist.
   *
   * @param {Set<string>} currentGeneratedPageKeys
   * @param {Set<string> | null} rebuiltOwnerPaths - Null when every owner was rebuilt.
   */
  pruneGeneratedPages (currentGeneratedPageKeys, rebuiltOwnerPaths = null) {
    if (!this.#enabled || rebuiltOwnerPaths?.size === 0) return

    const consumers = this.#state.consumers
    for (const id in consumers) {
      if (!Object.hasOwn(consumers, id)) continue
      const consumer = /** @type {WatchConsumer} */ (consumers[id])
      if (
        consumer.type === 'page' &&
        consumer.ownerPath &&
        (rebuiltOwnerPaths === null || rebuiltOwnerPaths.has(consumer.ownerPath)) &&
        !currentGeneratedPageKeys.has(consumer.key)
      ) {
        delete consumers[id]
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
