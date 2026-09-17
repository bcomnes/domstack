/**
 * @import { PageData } from './page-data.js'
 * @import { GlobalDataFunctionParams } from './index.js'
 * @import { WatchEvent } from '../watch/plan.js'
 */
import { resolve } from 'node:path'
import { BlockList } from 'node:net'
import { createHistogram } from 'node:perf_hooks'

// Node does not export Histogram; both recordable and event-loop histograms extend it.
const Histogram = Object.getPrototypeOf(createHistogram().constructor)

/**
 * Internal candidate committed by the main build only after successful cleanup.
 * @typedef {object} GlobalDataBaseline
 * @property {unknown} state
 * @property {string[]} sourceIds - Source-root-relative normalized source IDs with POSIX separators.
 */

/**
 * Internal input changes supplied by the watch planner, not output filters.
 * @typedef {object} GlobalDataInputChanges
 * @property {string | undefined} [resetReason]
 * @property {string[]} upsertedPaths - Normalized absolute source-page candidate paths.
 * @property {WatchEvent[]} events - Raw watch events with normalized absolute filepaths.
 */

/**
 * @typedef {object} GlobalDataResetChanges
 * @property {'reset'} kind
 * @property {string} reason
 * @property {WatchEvent[]} events - Raw watch events with normalized absolute filepaths.
 */

/**
 * @template {Record<string, any>} [T=any] - Source-page vars.
 * @template [U=any] - Source-page render values.
 * @typedef {object} GlobalDataDeltaChanges
 * @property {'delta'} kind
 * @property {PageData<T, U, any, any>[]} upserted - Current initialized pages, identified by their sourceId.
 * @property {string[]} removed - Source IDs no longer eligible, matching PageData.sourceId: source-root-relative normalized relnames with POSIX separators.
 * @property {WatchEvent[]} events - Raw watch events with normalized absolute filepaths, not source IDs.
 */

/**
 * @template {Record<string, any>} [T=any]
 * @template [U=any]
 * @typedef {GlobalDataResetChanges | GlobalDataDeltaChanges<T, U>} GlobalDataChanges
 */

/**
 * @param {unknown} state
 * @param {string} operation
 * @returns {unknown}
 */
function cloneState (state, operation) {
  let cloned
  try {
    cloned = structuredClone(state)
  } catch (cause) {
    throw new Error(`global.data ${operation} requires structured-cloneable state. Store plain data, Maps, Sets, or other structured-cloneable values instead of functions, PageData instances, or renderers.`, { cause })
  }
  // Inspect only retained values: cloning evaluates source getters once and drops
  // private fields, but some native objects still share mutable backing storage.
  rejectSharedState(cloned, operation)
  return cloned
}

/**
 * @param {unknown} value
 * @param {string} operation
 * @param {Set<object>} [seen]
 */
function rejectSharedState (value, operation, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof SharedArrayBuffer || (ArrayBuffer.isView(value) && value.buffer instanceof SharedArrayBuffer)) {
    throw new Error(`global.data ${operation} cannot retain shared-memory state (SharedArrayBuffer or views backed by it): structuredClone shares their memory. Copy the bytes into a non-shared ArrayBuffer or typed array before storing state.`)
  }
  if ((typeof WebAssembly !== 'undefined' && value instanceof WebAssembly.Memory) ||
    value instanceof Histogram || value instanceof BlockList) {
    throw new Error(`global.data ${operation} cannot retain shared mutable state (WebAssembly.Memory, Histogram, or BlockList): structuredClone shares their backing storage. Store plain records or arrays instead.`)
  }
  // Cloned views have no custom properties; avoid walking every byte or element.
  if (ArrayBuffer.isView(value)) return
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      rejectSharedState(key, operation, seen)
      rejectSharedState(entry, operation, seen)
    }
    return
  } else if (value instanceof Set) {
    for (const entry of value) rejectSharedState(entry, operation, seen)
    return
  }
  // Include non-enumerable retained properties such as Error.cause.
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) rejectSharedState(descriptor.value, operation, seen)
  }
}

/**
 * Keep the callback's mutable previousState separate from the candidate so that
 * only setState can commit changes. Snapshot membership before calling user code.
 *
 * @param {object} params
 * @param {PageData<any, any, any, any>[]} params.pages
 * @param {GlobalDataBaseline | null | undefined} [params.previousGlobalDataBaseline]
 * @param {GlobalDataInputChanges | undefined} [params.globalDataInputChanges]
 */
export function createGlobalDataState ({ pages, previousGlobalDataBaseline, globalDataInputChanges }) {
  const reset = !previousGlobalDataBaseline || globalDataInputChanges?.resetReason !== undefined
  let state = reset ? undefined : cloneState(previousGlobalDataBaseline.state, 'previous state')
  const events = globalDataInputChanges ? structuredClone(globalDataInputChanges.events) : []
  const sourceIdSet = new Set()
  /** @type {GlobalDataChanges} */
  let changes
  if (reset) {
    for (const page of pages) sourceIdSet.add(page.sourceId)
    changes = { kind: 'reset', reason: globalDataInputChanges?.resetReason ?? 'initial', events }
  } else {
    const previousIds = new Set(previousGlobalDataBaseline.sourceIds)
    const upsertedPaths = new Set()
    for (const path of globalDataInputChanges?.upsertedPaths ?? []) upsertedPaths.add(resolve(path))
    changes = { kind: 'delta', upserted: [], removed: [], events }
    for (const page of pages) {
      const sourceId = page.sourceId
      sourceIdSet.add(sourceId)
      if (!previousIds.has(sourceId) || (upsertedPaths.size > 0 && upsertedPaths.has(resolve(page.pageInfo.pageFile.filepath)))) {
        changes.upserted.push(page)
      }
    }
    for (const sourceId of previousIds) {
      if (!sourceIdSet.has(sourceId)) changes.removed.push(sourceId)
    }
  }
  const sourceIds = [...sourceIdSet]

  /** @type {GlobalDataFunctionParams} */
  const context = {
    pages,
    // The private snapshot is already validated; only callback isolation remains.
    previousState: reset ? undefined : structuredClone(state),
    changes,
    setState (next) {
      state = cloneState(next, 'setState(next)')
    },
  }

  return {
    context,
    /** @returns {GlobalDataBaseline} */
    getBaseline: () => ({ state, sourceIds }),
  }
}
