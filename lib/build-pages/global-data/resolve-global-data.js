/**
 * @import { GlobalDataFunctionParams } from '../index.js'
 */

import { isFunction, isObject } from '../../helpers/type-guards.js'

/**
 * Resolve and call a global.data.js file with initialized source-backed pages.
 * Receives fully resolved PageData instances (with .vars, .pageInfo, etc.) so
 * that global.data.js can filter and aggregate by layout, publishDate, title, etc.
 * Generated pages are created afterward, and downstream consumers may subscribe
 * to named values from the returned data.
 * Returns an empty object if no file is provided or the file exports nothing useful.
 *
 * @param {object} params
 * @param {string | undefined} [params.globalDataPath] - Path to the global.data file.
 * @param {GlobalDataFunctionParams} params.context - Callback context prepared by the page phase.
 * @returns {Promise<object>}
 */
export async function resolveGlobalData ({ globalDataPath, context }) {
  if (!globalDataPath) return {}

  const imported = await import(globalDataPath)
  const maybeGlobalData = imported.default

  if (isFunction(maybeGlobalData)) {
    const result = await maybeGlobalData(context)
    if (isObject(result)) return result
    throw new Error('global.data default export function must return an object')
  } else if (isObject(maybeGlobalData)) {
    return maybeGlobalData
  } else {
    return {}
  }
}
