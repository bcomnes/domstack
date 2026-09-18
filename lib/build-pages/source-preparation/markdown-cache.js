/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { GlobalDataInputChanges } from '../global-data/global-data-state.js'
 * @import { PreparedMarkdown } from './markdown.js'
 * @typedef {Map<string, {sourceId: string, prepared: PreparedMarkdown}>} MarkdownPreparationState
 * @typedef {object} MarkdownPreparationUpdate
 * @property {boolean} replace
 * @property {MarkdownPreparationState} upserts
 * @property {string[]} removed
 */
import { normalize, resolve } from 'node:path'
import { types } from 'node:util'
import { toPosix } from '../../helpers/path.js'
import { prepareMarkdown } from './markdown.js'

/** @param {PageInfo} page */
const sourceId = page => toPosix(normalize(page.pageFile.relname))

/**
 * Accept only data whose values and graph survive structured cloning unchanged.
 * Inspect descriptors, never getters; detect proxies before any reflective operation.
 * @param {unknown} value
 * @param {Set<object>} seen
 * @returns {boolean}
 */
function hasCloneFidelity (value, seen) {
  if (value === null || typeof value !== 'object') return typeof value !== 'function' && typeof value !== 'symbol'
  if (types.isProxy(value)) return false
  if (seen.has(value)) return true
  seen.add(value)
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  if (prototype === Date.prototype && types.isDate(value)) return keys.length === 0
  const binary = prototype === Uint8Array.prototype && types.isUint8Array(value)
  const array = Array.isArray(value) && prototype === Array.prototype
  if (!binary && !array && prototype !== Object.prototype) return false
  // Native internal slots remain exotic even if someone replaces the prototype.
  if (!binary && (types.isArrayBufferView(value) || types.isAnyArrayBuffer(value))) return false
  if (types.isDate(value) || types.isRegExp(value) || types.isMap(value) || types.isSet(value) ||
    types.isWeakMap(value) || types.isWeakSet(value) || types.isPromise(value) ||
    types.isNativeError(value) || types.isBoxedPrimitive(value) || types.isModuleNamespaceObject(value)) return false
  for (const key of keys) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) return false
    if (array && key === 'length') {
      if (!descriptor.writable) return false
      continue
    }
    if (!descriptor.enumerable || !descriptor.writable || !descriptor.configurable) return false
    if ((array || binary) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= 4294967295)) return false
    if (!hasCloneFidelity(descriptor.value, seen)) return false
  }
  if (binary) {
    const buffer = value.buffer
    if (types.isSharedArrayBuffer(buffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Reflect.ownKeys(buffer).length) return false
  }
  return true
}

/** @param {PreparedMarkdown} prepared @returns {PreparedMarkdown | undefined} */
function snapshot (prepared) {
  try {
    if (hasCloneFidelity(prepared, new Set())) return structuredClone(prepared)
  } catch {
    // Cache eligibility must never turn otherwise valid source into a build failure.
  }
  return undefined
}

/** Build-local candidate; the parent accepts updates only after total build success. */
export class MarkdownPreparationCache {
  /** @type {Map<string, string>} */
  #members = new Map()
  /** @type {MarkdownPreparationState} */
  #previous
  /** @type {MarkdownPreparationState} */
  #upserts = new Map()
  /** @type {Set<string>} */
  #removed = new Set()
  /** @type {Map<string, Promise<PreparedMarkdown>>} */
  #pending = new Map()
  #replace
  #loader

  /**
   * @param {object} params
   * @param {PageInfo[]} params.pages Complete current membership, not an output filter.
   * @param {MarkdownPreparationState | null | undefined} [params.previous]
   * @param {GlobalDataInputChanges | undefined} [params.changes]
   * @param {typeof prepareMarkdown} [loader]
   */
  constructor ({ pages, previous, changes }, loader = prepareMarkdown) {
    this.#replace = !previous || !changes || changes.resetReason !== undefined
    this.#previous = this.#replace ? new Map() : previous ?? new Map()
    this.#loader = loader
    for (const page of pages) {
      if (page.type === 'md' && !page.generated) this.#members.set(resolve(page.pageFile.filepath), sourceId(page))
    }
    const invalidated = new Set()
    for (const filepath of changes?.upsertedPaths ?? []) invalidated.add(resolve(filepath))
    for (const event of changes?.events ?? []) invalidated.add(resolve(event.filepath))
    for (const [key, entry] of this.#previous) {
      if (this.#members.get(key) !== entry.sourceId || invalidated.has(key)) this.#removed.add(key)
    }
  }

  /** @param {PageInfo} pageInfo @returns {Promise<PreparedMarkdown>} */
  async prepare (pageInfo) {
    const key = resolve(pageInfo.pageFile.filepath)
    const id = sourceId(pageInfo)
    if (pageInfo.type !== 'md' || pageInfo.generated || this.#members.get(key) !== id) return this.#loader(key)
    // Duplicate requests may share I/O, but must never share application-owned vars.
    const pending = this.#pending.get(key)
    if (pending) await pending
    const entry = this.#upserts.get(key) ?? (this.#removed.has(key) ? undefined : this.#previous.get(key))
    if (entry) {
      const prepared = snapshot(entry.prepared)
      if (prepared) return prepared
      this.#upserts.delete(key)
      if (this.#previous.has(key)) this.#removed.add(key)
    }
    const loading = this.#loader(key).then(prepared => {
      // Snapshot before resolving: application code receives the original on a miss.
      const retained = snapshot(prepared)
      if (retained) this.#upserts.set(key, { sourceId: id, prepared: retained })
      else if (this.#previous.has(key)) this.#removed.add(key)
      return prepared
    })
    this.#pending.set(key, loading)
    try {
      return await loading
    } finally {
      this.#pending.delete(key)
    }
  }

  /** @returns {MarkdownPreparationUpdate} */
  getUpdate () {
    return { replace: this.#replace, upserts: new Map(this.#upserts), removed: [...this.#removed] }
  }
}

/**
 * Apply only an accepted candidate, without mutating the previous successful map.
 * @param {MarkdownPreparationState | null | undefined} previous
 * @param {MarkdownPreparationUpdate} update
 * @returns {MarkdownPreparationState}
 */
export function applyMarkdownPreparationUpdate (previous, update) {
  const next = new Map(update.replace ? undefined : previous)
  for (const key of update.removed) next.delete(key)
  for (const [key, entry] of update.upserts) next.set(key, entry)
  return next
}
