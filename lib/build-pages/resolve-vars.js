/**
 * Resolve variables by importing them from a specified path.
 *
 * @param {object} params
 * @param {string} [params.varsPath] - Path to the file containing the variables.
 * @param {object} [params.resolveVars] - Any variables you want passed to the reolveFunction.
 * @param {string} [params.key='default'] - The key to extract from the imported module. Default: 'default'
 * @returns {Promise<object>} - Returns the resolved variables. If the imported variable is a function, it executes and returns its result. Otherwise, it returns the variable directly.
 */
export async function resolveVars ({
  varsPath,
  key = 'default',
}) {
  if (!varsPath) return {}

  const imported = await import(varsPath)

  const maybeVars = imported[key]

  if (isObject(maybeVars)) {
    return maybeVars
  } else if (isFunction(maybeVars)) {
    const resolvedVars = await maybeVars()
    if (isObject(resolvedVars)) {
      return resolvedVars
    } else {
      throw new Error('Var functions must resolve to an object')
    }
  } else {
    return {}
  }
}

/**
 * @import { PageData } from './page-data.js'
 */

/**
 * @callback GlobalDataFunction
 * @param {{ pages: PageData[] }} params
 * @returns {Promise<object> | object}
 */

/**
 * Resolve and call a global.data.js file with the initialized PageData array.
 * Receives fully resolved PageData instances (with .vars, .pageInfo, etc.) so
 * that global.data.js can filter and aggregate by layout, publishDate, title, etc.
 * Returns an empty object if no file is provided or the file exports nothing useful.
 *
 * @param {object} params
 * @param {string} [params.globalDataPath] - Path to the global.data file.
 * @param {PageData[]} params.pages - Initialized PageData array.
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
    // Allow a plain object export as a static fallback (same as global.vars)
    return maybeGlobalData
  } else {
    return {}
  }
}

/**
 * Resolve variables by importing them from a specified path.
 *
 * @param {object} params
 * @param {string} [params.varsPath] - Path to the file containing the variables.
 * @returns {Promise<function|null>} - Returns the resolved variables. If the imported variable is a function, it executes and returns its result. Otherwise, it returns the variable directly.
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
      'See https://domstack.net/#postVars for migration details.'
    )
  }

  return null
}

/**
 * Checks if the given value is an object.
 *
 * @param {*} value - The value to check.
 * @returns {value is object}
 */
function isObject (value) {
  return value !== null && typeof value === 'object'
}

/**
 * Checks if the given value is an object.
 *
 * @param {*} value - The value to check.
 * @returns {value is function}
 */
function isFunction (value) {
  return value !== null && typeof value === 'function'
}
