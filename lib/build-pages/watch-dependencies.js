/**
 * @import { PageData } from './page-data.js'
 * @import { PageInfo } from '../identify-pages.js'
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../helpers/stable-json-stringify.js'

/**
 * @typedef {'page' | 'template' | 'pages-file' | 'global-data'} WatchConsumerType
 *
 * @typedef {object} WatchConsumer
 * @property {WatchConsumerType} type
 * @property {string} key
 * @property {string | undefined} [ownerPath]
 * @property {Record<string, string[]>} pages
 * @property {string[]} globalDataKeys
 *
 * @typedef {object} WatchDependencyState
 * @property {Record<string, WatchConsumer>} consumers
 * @property {Record<string, string | null>} globalDataFingerprints
 * @property {Record<string, Record<string, string | null>>} pageFingerprints
 */

export class WatchDependencyTracker {
  /** @type {AsyncLocalStorage<string>} */
  #consumerStorage = new AsyncLocalStorage()
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
   * Run user code while attributing observed page and global-data reads to a consumer.
   *
   * AsyncLocalStorage is request-style async context, not browser localStorage.
   * It keeps the active consumer attached across awaits and concurrent p-map tasks
   * without exposing tracking arguments to user functions.
   *
   * @template T
   * @param {WatchConsumerType} type
   * @param {string} key
   * @param {() => T | Promise<T>} fn
   * @param {{ ownerPath?: string }} [metadata]
   * @returns {Promise<T>}
   */
  async runWithConsumer (type, key, fn, metadata = {}) {
    if (!this.#enabled) return fn()
    const id = consumerId(type, key)
    this.#state.consumers[id] = {
      type,
      key,
      ownerPath: metadata.ownerPath,
      pages: {},
      globalDataKeys: [],
    }
    return this.#consumerStorage.run(id, fn)
  }

  /**
   * Return a PageData facade that records reads made by the active consumer.
   *
   * @template {Record<string, any>} T
   * @template U
   * @template V
   * @param {PageData<T, U, V>} page
   * @returns {PageData<T, U, V>}
   */
  trackPageData (page) {
    if (!this.#enabled) return page
    return new Proxy(page, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target)
        if (typeof property === 'string' && property !== 'vars') {
          this.#recordPageDependency(target.pageInfo, property, value)
        }
        if (typeof value === 'function') {
          return (/** @type {unknown[]} */ ...args) => {
            if (typeof property === 'string') this.#recordPageDependency(target.pageInfo, `${property}()`, value)
            return Reflect.apply(value, target, args)
          }
        }
        return value
      },
    })
  }

  /**
   * Wrap a resolved vars object so property reads can be attributed to the active consumer.
   *
   * @template {Record<string, any>} T
   * @param {PageInfo} pageInfo
   * @param {T} vars
   * @param {Partial<T>} globalDataVars
   * @param {Partial<T>} layoutVars
   * @param {Partial<T> | null} pageVars
   * @param {Partial<T> | null} builderVars
   * @returns {T}
   */
  trackPageVars (pageInfo, vars, globalDataVars, layoutVars, pageVars, builderVars) {
    if (!this.#enabled) return vars
    return new Proxy(vars, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (typeof property === 'string') {
          this.#recordPageDependency(pageInfo, `vars.${property}`, value)
          if (
            Object.hasOwn(globalDataVars, property) &&
            !Object.hasOwn(layoutVars, property) &&
            !Object.hasOwn(pageVars ?? {}, property) &&
            !Object.hasOwn(builderVars ?? {}, property)
          ) {
            this.#recordGlobalDataDependency(property)
          }
        }
        return value
      },
      ownKeys: target => {
        this.#recordPageDependency(pageInfo, 'vars.*', target)
        for (const key of Object.keys(globalDataVars)) this.#recordGlobalDataDependency(key)
        return Reflect.ownKeys(target)
      },
    })
  }

  /**
   * Track top-level global-data reads from a vars object that is not tied to one page.
   *
   * @template {Record<string, any>} T
   * @param {T} vars
   * @param {Record<string, any>} globalDataVars
   * @returns {T}
   */
  trackGlobalDataVars (vars, globalDataVars) {
    if (!this.#enabled) return vars
    return new Proxy(vars, {
      get: (target, property, receiver) => {
        if (typeof property === 'string' && Object.hasOwn(globalDataVars, property)) {
          this.#recordGlobalDataDependency(property)
        }
        return Reflect.get(target, property, receiver)
      },
      ownKeys: target => {
        for (const key of Object.keys(globalDataVars)) this.#recordGlobalDataDependency(key)
        return Reflect.ownKeys(target)
      },
    })
  }

  /**
   * Compare properties observed in the previous build for directly changed pages.
   *
   * @param {WatchDependencyState | null | undefined} previousState
   * @param {Map<string, PageData<any, any, any>>} changedPages
   * @returns {Map<string, Set<string>>}
   */
  getChangedPageProperties (previousState, changedPages) {
    /** @type {Map<string, Set<string>>} */
    const changed = new Map()
    if (!this.#enabled || !previousState) return changed

    for (const [pagePath, page] of changedPages) {
      const previousFingerprints = previousState.pageFingerprints?.[pagePath] ?? {}
      const currentFingerprints = this.#state.pageFingerprints[pagePath] ?? {}
      for (const [property, previousFingerprint] of Object.entries(previousFingerprints)) {
        const currentFingerprint = fingerprint(readTrackedProperty(page, property))
        currentFingerprints[property] = currentFingerprint
        if (previousFingerprint == null || currentFingerprint == null || previousFingerprint !== currentFingerprint) {
          const properties = changed.get(pagePath) ?? new Set()
          properties.add(property)
          changed.set(pagePath, properties)
        }
      }
      this.#state.pageFingerprints[pagePath] = currentFingerprints
    }

    return changed
  }

  /**
   * Store stable fingerprints for the current global-data result and return changed keys.
   * Opaque or cyclic values receive a null fingerprint and are conservatively treated as changed.
   *
   * @param {Record<string, any>} globalData
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
   * Find prior consumers affected by changed source pages or global-data keys.
   *
   * @param {WatchDependencyState | null | undefined} previousState
   * @param {Map<string, Set<string>>} changedPageProperties
   * @param {Set<string>} changedGlobalDataKeys
   * @returns {WatchConsumer[]}
   */
  getInvalidatedConsumers (previousState, changedPageProperties, changedGlobalDataKeys) {
    if (!this.#enabled || !previousState) return []
    const invalidated = []
    for (const consumer of Object.values(previousState.consumers)) {
      const readsChangedPage = Array.from(changedPageProperties).some(([path, properties]) => {
        return consumer.pages[path]?.some(property => properties.has(property))
      })
      const readsChangedGlobalData = consumer.globalDataKeys.some(key => changedGlobalDataKeys.has(key))
      if (readsChangedPage || readsChangedGlobalData) invalidated.push(consumer)
    }
    return invalidated
  }

  /**
   * @param {PageInfo} pageInfo
   * @param {string} property
   * @param {unknown} value
   */
  #recordPageDependency (pageInfo, property, value) {
    const consumer = this.#activeConsumer()
    if (!consumer) return
    const pageKey = pageInfo.generated?.pagesFile.pagesFile.filepath
      ? pageInfo.outputRelname
      : pageInfo.pageFile.filepath
    const properties = new Set(consumer.pages[pageKey] ?? [])
    properties.add(property)
    consumer.pages[pageKey] = Array.from(properties).sort()
    const fingerprints = this.#state.pageFingerprints[pageKey] ?? {}
    fingerprints[property] = fingerprint(value)
    this.#state.pageFingerprints[pageKey] = fingerprints
  }

  /**
   * @param {string} key
   */
  #recordGlobalDataDependency (key) {
    const consumer = this.#activeConsumer()
    if (!consumer) return
    if (!consumer.globalDataKeys.includes(key)) {
      consumer.globalDataKeys.push(key)
      consumer.globalDataKeys.sort()
    }
  }

  /**
   * @returns {WatchConsumer | undefined}
   */
  #activeConsumer () {
    const id = this.#consumerStorage.getStore()
    return id ? this.#state.consumers[id] : undefined
  }
}

/**
 * @returns {WatchDependencyState}
 */
function createWatchDependencyState () {
  return {
    consumers: {},
    globalDataFingerprints: {},
    pageFingerprints: {},
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
    const serialized = stableJsonStringify(value)
    if (serialized === undefined) return null
    return createHash('sha256').update(serialized).digest('hex')
  } catch {
    return null
  }
}

/**
 * Read a previously observed property without invoking rendering helpers.
 * Function calls are opaque and therefore conservatively invalidate their consumers.
 *
 * @param {PageData<any, any, any>} page
 * @param {string} property
 * @returns {unknown}
 */
function readTrackedProperty (page, property) {
  if (property.endsWith('()')) return undefined
  if (property === 'vars.*') return page.vars
  if (property.startsWith('vars.')) return page.vars[property.slice('vars.'.length)]
  return Reflect.get(page, property)
}
