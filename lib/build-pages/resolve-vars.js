/**
 * @import { PageData } from './page-data.js'
 */

import { isFunction, isObject, isPlainObject } from '../helpers/type-guards.js'

/**
 * Resolve an object-or-function vars export.
 *
 * @param {unknown} maybeVars
 * @param {string} errorLabel
 * @returns {Promise<Record<string, unknown>>}
 */
export async function resolveVarsExport (maybeVars, errorLabel) {
  if (!maybeVars) return {}

  if (isPlainObject(maybeVars)) {
    return maybeVars
  } else if (isFunction(maybeVars)) {
    const resolvedVars = await maybeVars()
    if (isPlainObject(resolvedVars)) return resolvedVars
    throw new Error(`${errorLabel} function must resolve to a plain object`)
  } else {
    return {}
  }
}

/**
 * Resolve variables by importing them from a specified path.
 *
 * @param {object} params
 * @param {string | undefined} [params.varsPath] - Path to the file containing the variables.
 * @param {string} [params.key='default'] - The key to extract from the imported module. Default: 'default'
 * @returns {Promise<object>} - Returns the resolved variables. If the imported variable is a function, it executes and returns its result. Otherwise, it returns the variable directly.
 */
export async function resolveVars ({
  varsPath,
  key = 'default',
}) {
  if (!varsPath) return {}

  const imported = await import(varsPath)
  return await resolveVarsExport(imported[key], 'Var')
}

/**
 * Resolve and call a global.data.js file with initialized source-backed pages.
 * Receives fully resolved PageData instances (with .vars, .pageInfo, etc.) so
 * that global.data.js can filter and aggregate by layout, publishDate, title, etc.
 * Generated pages are created afterward and receive the returned data.
 * Returns an empty object if no file is provided or the file exports nothing useful.
 *
 * @param {object} params
 * @param {string | undefined} [params.globalDataPath] - Path to the global.data file.
 * @param {PageData<any, any, any>[]} params.pages - Initialized source-backed PageData array.
 * @returns {Promise<object>}
 */
export async function resolveGlobalData ({ globalDataPath, pages }) {
  if (!globalDataPath) return {}

  const imported = await import(globalDataPath)
  const maybeGlobalData = imported.default

  if (isFunction(maybeGlobalData)) {
    const result = await maybeGlobalData({ pages })
    if (isObject(result)) return result
    throw new Error('global.data default export function must return an object')
  } else if (isObject(maybeGlobalData)) {
    return maybeGlobalData
  } else {
    return {}
  }
}

/**
 * Resolve variables by importing them from a specified path.
 *
 * @param {object} params
 * @param {string | undefined} [params.varsPath] - Path to the file containing the variables.
 * @returns {Promise<null>}
 */
export async function resolvePostVars ({
  varsPath,
}) {
  if (!varsPath) return null

  const imported = await import(varsPath)
  const maybePostVars = imported.postVars

  if (maybePostVars) {
    throw new Error(
      `postVars is no longer supported (found in ${varsPath}). ` +
      'Move data aggregation to a global.data.js file instead. ' +
      'See the domstack docs for details.'
    )
  }

  return null
}
