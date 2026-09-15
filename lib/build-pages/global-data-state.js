/**
 * @import { PageData } from './page-data.js'
 * @import { GlobalDataFunctionParams } from './index.js'
 * @import { WatchEvent } from '../watch-plan.js'
 */
import { resolve } from 'node:path'

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
  // private fields, but SharedArrayBuffer still aliases its original memory.
  rejectSharedMemory(cloned, operation)
  return cloned
}

/**
 * @param {unknown} value
 * @param {string} operation
 * @param {Set<object>} [seen]
 */
function rejectSharedMemory (value, operation, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof SharedArrayBuffer || (ArrayBuffer.isView(value) && value.buffer instanceof SharedArrayBuffer)) {
    throw new Error(`global.data ${operation} cannot retain shared-memory state (SharedArrayBuffer or views backed by it): structuredClone shares their memory. Copy the bytes into a non-shared ArrayBuffer or typed array before storing state.`)
  }
  // Cloned views have no custom properties; avoid walking every byte or element.
  if (ArrayBuffer.isView(value)) return
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      rejectSharedMemory(key, operation, seen)
      rejectSharedMemory(entry, operation, seen)
    }
  } else if (value instanceof Set) {
    for (const entry of value) rejectSharedMemory(entry, operation, seen)
  }
  // Include non-enumerable retained properties such as Error.cause.
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) rejectSharedMemory(descriptor.value, operation, seen)
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
  const sourceIds = [...new Set(pages.map(page => page.sourceId))]
  const sourceIdSet = new Set(sourceIds)
  const reset = !previousGlobalDataBaseline || globalDataInputChanges?.resetReason !== undefined
  let state = reset ? undefined : cloneState(previousGlobalDataBaseline.state, 'previous state')
  const events = structuredClone(globalDataInputChanges?.events ?? [])
  const previousIds = new Set(previousGlobalDataBaseline?.sourceIds)
  const upsertedPaths = new Set(globalDataInputChanges?.upsertedPaths.map(path => resolve(path)))

  /** @type {GlobalDataFunctionParams} */
  const context = {
    pages,
    previousState: reset ? undefined : cloneState(state, 'previous state'),
    changes: reset
      ? { kind: 'reset', reason: globalDataInputChanges?.resetReason ?? 'initial', events }
      : {
          kind: 'delta',
          upserted: pages.filter(page => {
            const path = resolve(page.pageInfo.pageFile.filepath)
            return upsertedPaths.has(path) || !previousIds.has(page.sourceId)
          }),
          removed: [...previousIds].filter(id => !sourceIdSet.has(id)),
          events,
        },
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
