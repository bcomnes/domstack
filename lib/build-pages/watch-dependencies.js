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
 * @property {string[]} pageCollections
 * @property {string[]} globalDataKeys
 *
 * @typedef {object} WatchDependencyState
 * @property {Record<string, WatchConsumer>} consumers
 * @property {Record<string, string | null>} globalDataFingerprints
 * @property {Record<string, Record<string, string | null>>} pageFingerprints
 * @property {Record<string, string | null>} pageCollectionFingerprints
 */

export class WatchDependencyTracker {
  /** @type {AsyncLocalStorage<string>} */
  #consumerStorage = new AsyncLocalStorage()
  /** @type {WatchDependencyState} */
  #state
  /** @type {boolean} */
  #enabled
  /** @type {WeakMap<PageData<any, any, any>, PageData<any, any, any>>} */
  #trackedPages = new WeakMap()

  /**
   * @param {WatchDependencyState | null | undefined} previousState
   * @param {{ fullBuild: boolean, enabled?: boolean }} options
   */
  constructor (previousState, { fullBuild, enabled = true }) {
    this.#enabled = enabled
    this.#state = fullBuild || !previousState
      ? createWatchDependencyState()
      : structuredClone(previousState)
    this.#state.pageCollectionFingerprints ??= {}
    for (const consumer of Object.values(this.#state.consumers)) {
      consumer.pageCollections ??= []
    }
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
      pageCollections: [],
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
    const existing = this.#trackedPages.get(page)
    if (existing) return existing
    const trackedPage = new Proxy(page, {
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
      has: (target, property) => {
        const exists = Reflect.has(target, property)
        if (typeof property === 'string') {
          this.#recordPageDependency(target.pageInfo, `has:${property}`, exists)
        }
        return exists
      },
      ownKeys: target => {
        this.#recordPageDependency(target.pageInfo, '*', target)
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
        if (typeof property === 'string') {
          this.#recordPageDependency(target.pageInfo, `descriptor:${property}`, descriptor)
        }
        return descriptor
      },
    })
    this.#trackedPages.set(page, trackedPage)
    return trackedPage
  }

  /**
   * Wrap a page array so indexed access and iteration observe membership and order.
   *
   * Array methods such as map(), find(), and some() read length or indexed values
   * through the proxy, while for-of and spread read Symbol.iterator.
   *
   * @template {PageData<any, any, any>} T
   * @param {T[]} pages
   * @param {string} collectionKey
   * @returns {T[]}
   */
  trackPageCollection (pages, collectionKey) {
    if (!this.#enabled) return pages
    const recordDependency = () => this.#recordPageCollectionDependency(collectionKey)
    return new Proxy(pages, {
      get: (target, property, receiver) => {
        if (
          property === Symbol.iterator ||
          property === 'length' ||
          (typeof property === 'string' && isArrayIndex(property))
        ) {
          recordDependency()
        }
        return Reflect.get(target, property, receiver)
      },
      has: (target, property) => {
        if (typeof property === 'string' && isArrayIndex(property)) recordDependency()
        return Reflect.has(target, property)
      },
      ownKeys: target => {
        recordDependency()
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor: (target, property) => {
        if (
          property === 'length' ||
          (typeof property === 'string' && isArrayIndex(property))
        ) {
          recordDependency()
        }
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
  }

  /**
   * Wrap a resolved vars object so property reads can be attributed to the active consumer.
   *
   * @template {Record<string, any>} T
   * @param {PageInfo} pageInfo
   * @param {T} vars
   * @param {Partial<T>} layoutVars
   * @param {Partial<T> | null} pageVars
   * @param {Partial<T> | null} builderVars
   * @returns {T}
   */
  trackPageVars (pageInfo, vars, layoutVars, pageVars, builderVars) {
    if (!this.#enabled) return vars
    const recordGlobalDataCandidate = (/** @type {string} */ property) => {
      if (
        !Object.hasOwn(layoutVars, property) &&
        !Object.hasOwn(pageVars ?? {}, property) &&
        !Object.hasOwn(builderVars ?? {}, property)
      ) {
        this.#recordGlobalDataDependency(property)
      }
    }
    return new Proxy(vars, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (typeof property === 'string') {
          this.#recordPageDependency(pageInfo, `vars.${property}`, value)
          recordGlobalDataCandidate(property)
        }
        return value
      },
      has: (target, property) => {
        const exists = Reflect.has(target, property)
        if (typeof property === 'string') {
          this.#recordPageDependency(pageInfo, `vars.has:${property}`, exists)
          recordGlobalDataCandidate(property)
        }
        return exists
      },
      ownKeys: target => {
        this.#recordPageDependency(pageInfo, 'vars.*', target)
        this.#recordGlobalDataDependency('*')
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
        if (typeof property === 'string') {
          this.#recordPageDependency(pageInfo, `vars.descriptor:${property}`, descriptor)
          recordGlobalDataCandidate(property)
        }
        return descriptor
      },
    })
  }

  /**
   * Track top-level global-data reads from a vars object that is not tied to one page.
   *
   * @template {Record<string, any>} T
   * @param {T} vars
   * @returns {T}
   */
  trackGlobalDataVars (vars) {
    if (!this.#enabled) return vars
    return new Proxy(vars, {
      get: (target, property, receiver) => {
        if (typeof property === 'string') this.#recordGlobalDataDependency(property)
        return Reflect.get(target, property, receiver)
      },
      has: (target, property) => {
        if (typeof property === 'string') this.#recordGlobalDataDependency(property)
        return Reflect.has(target, property)
      },
      ownKeys: target => {
        this.#recordGlobalDataDependency('*')
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor: (target, property) => {
        if (typeof property === 'string') this.#recordGlobalDataDependency(property)
        return Reflect.getOwnPropertyDescriptor(target, property)
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
   * Store the membership and order fingerprint for a page collection.
   *
   * @param {string} collectionKey
   * @param {PageData<any, any, any>[]} pages
   * @param {Record<string, string | null> | null | undefined} previousFingerprints
   * @returns {boolean}
   */
  updatePageCollectionFingerprint (collectionKey, pages, previousFingerprints) {
    if (!this.#enabled) return false
    const currentFingerprint = fingerprint(pages.map(pageCollectionIdentity))
    const previousFingerprint = previousFingerprints?.[collectionKey]
    this.#state.pageCollectionFingerprints[collectionKey] = currentFingerprint
    return previousFingerprint == null ||
      currentFingerprint == null ||
      previousFingerprint !== currentFingerprint
  }

  /**
   * Find prior consumers affected by changed source pages or global-data keys.
   *
   * @param {WatchDependencyState | null | undefined} previousState
   * @param {Map<string, Set<string>>} changedPageProperties
   * @param {Set<string>} changedGlobalDataKeys
   * @param {Set<string>} changedPageCollections
   * @returns {WatchConsumer[]}
   */
  getInvalidatedConsumers (previousState, changedPageProperties, changedGlobalDataKeys, changedPageCollections = new Set()) {
    if (!this.#enabled || !previousState) return []
    const invalidated = []
    for (const consumer of Object.values(previousState.consumers)) {
      const readsChangedPage = Object.entries(consumer.pages).some(([path, properties]) => {
        const changedProperties = changedPageProperties.get(path)
        return changedProperties && properties.some(property => changedProperties.has(property))
      })
      const readsChangedGlobalData = consumer.globalDataKeys.some(key => {
        return key === '*' ? changedGlobalDataKeys.size > 0 : changedGlobalDataKeys.has(key)
      })
      const readsChangedPageCollection = (consumer.pageCollections ?? []).some(key => changedPageCollections.has(key))
      if (readsChangedPage || readsChangedGlobalData || readsChangedPageCollection) invalidated.push(consumer)
    }
    return invalidated
  }

  /**
   * Remove observations for generated pages that no longer exist.
   *
   * Collection consumers have already been invalidated by this point, so their
   * rebuilt records no longer refer to removed generated-page keys.
   *
   * @param {Set<string>} currentGeneratedPageKeys
   */
  pruneGeneratedPages (currentGeneratedPageKeys) {
    if (!this.#enabled) return
    const removedPageKeys = new Set()
    for (const [id, consumer] of Object.entries(this.#state.consumers)) {
      if (
        consumer.type !== 'page' ||
        !consumer.ownerPath ||
        currentGeneratedPageKeys.has(consumer.key)
      ) continue
      removedPageKeys.add(consumer.key)
      delete this.#state.consumers[id]
    }
    for (const pageKey of removedPageKeys) {
      delete this.#state.pageFingerprints[pageKey]
    }
    for (const consumer of Object.values(this.#state.consumers)) {
      for (const pageKey of removedPageKeys) delete consumer.pages[pageKey]
    }
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
    const properties = consumer.pages[pageKey] ?? []
    addSortedUnique(properties, property)
    consumer.pages[pageKey] = properties
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
    addSortedUnique(consumer.globalDataKeys, key)
  }

  /**
   * @param {string} collectionKey
   */
  #recordPageCollectionDependency (collectionKey) {
    const consumer = this.#activeConsumer()
    if (!consumer) return
    consumer.pageCollections ??= []
    addSortedUnique(consumer.pageCollections, collectionKey)
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
    pageCollectionFingerprints: {},
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
    if (serialized === undefined && value !== undefined) return null
    return createHash('sha256').update(serialized ?? 'undefined').digest('hex')
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
  if (property === '*') return page
  if (property.startsWith('has:')) return Reflect.has(page, property.slice('has:'.length))
  if (property.startsWith('descriptor:')) return Reflect.getOwnPropertyDescriptor(page, property.slice('descriptor:'.length))
  if (property === 'vars.*') return page.vars
  if (property.startsWith('vars.has:')) return Reflect.has(page.vars, property.slice('vars.has:'.length))
  if (property.startsWith('vars.descriptor:')) return Reflect.getOwnPropertyDescriptor(page.vars, property.slice('vars.descriptor:'.length))
  if (property.startsWith('vars.')) return page.vars[property.slice('vars.'.length)]
  return Reflect.get(page, property)
}

/**
 * @param {string} property
 * @returns {boolean}
 */
function isArrayIndex (property) {
  const index = Number(property)
  return Number.isInteger(index) && index >= 0 && String(index) === property
}

/**
 * @param {PageData<any, any, any>} page
 * @returns {string}
 */
function pageCollectionIdentity (page) {
  const { pageInfo } = page
  if (pageInfo.generated) {
    return `generated\0${pageInfo.generated.pagesFile.pagesFile.filepath}\0${pageInfo.outputRelname}`
  }
  return `page\0${pageInfo.pageFile.filepath}\0${pageInfo.outputRelname}`
}

/**
 * @param {string[]} values
 * @param {string} value
 */
function addSortedUnique (values, value) {
  if (values.includes(value)) return
  values.push(value)
  values.sort()
}
