/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { PageOutputsFunction } from '../outputs/page-outputs.js'
 */

import { pathToFileURL } from 'node:url'
import { resolveVarsExport } from '../vars/resolve-vars.js'
import { validatePageOutputsHook } from '../outputs/page-outputs.js'

/**
 * Resolves a layout from an ESM module.
 *
 * @function
 * @template {Record<string, any>} T - The type of variables for the layout
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @param {string} layoutPath - The string path to the layout ESM module.
 * @returns {Promise<{ render: LayoutFunction<T, U, V, D>, vars: Partial<T>, parentLayout: string | undefined, pageOutputs: PageOutputsFunction<T, D> | undefined, source: string }>} The resolved layout module exports.
 */
export async function resolveLayout (layoutPath) {
  const { default: layout, vars, parentLayout, pageOutputs } = await import(pathToFileURL(layoutPath).href)
  if (typeof layout !== 'function') throw new TypeError(`Layout "${layoutPath}" must export a default render function`)
  if (parentLayout !== undefined && (typeof parentLayout !== 'string' || !parentLayout.trim())) {
    throw new TypeError(`Layout "${layoutPath}" parentLayout must be a non-empty string`)
  }

  return {
    render: layout,
    parentLayout,
    source: layoutPath,
    pageOutputs: validatePageOutputsHook(pageOutputs, layoutPath),
    vars: /** @type {Partial<T>} */ (await resolveVarsExport(vars, 'Layout vars')),
  }
}

/**
 * Synchronous layout vars export.
 *
 * Layout modules may export `vars` as an object or function. These vars are
 * merged into `PageData.vars` after global vars and before page/frontmatter vars.
 *
 * @template {Record<string, any>} T - The layout vars shape.
 * @callback LayoutVarsFunction
 * @returns {T}
 */

/**
 * Asynchronous layout vars export.
 *
 * @template {Record<string, any>} T - The layout vars shape.
 * @callback AsyncLayoutVarsFunction
 * @returns {Promise<T>}
 */

/**
 * Layout vars export value.
 *
 * @template {Record<string, any>} T - The layout vars shape.
 * @typedef {T | LayoutVarsFunction<T> | AsyncLayoutVarsFunction<T>} LayoutVars
 */

/**
  * Common parameters for layout functions.
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @template {object} [D=Record<string, unknown>] - Declared global data.
  * @typedef {object} LayoutFunctionParams
  * @property {T} vars - All default, global, layout, page, and builder vars shallow merged.
  * @property {string[]} [scripts] - Array of script URLs to include.
  * @property {string[]} [styles] - Array of stylesheet URLs to include.
  * @property {U} children - The children content, either as a string or a render function.
  * @property {PageInfo} page - Info about the current page
  * @property {D} data - Global data declared by this renderer, independent of other layouts and the page.
  * @property {Object<string, string>} [workers] - Map of worker names to their output paths
  */

/**
  * Callback for rendering a layout, synchronously or asynchronously.
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @template {object} [D=Record<string, unknown>] - Declared global data.
  * @callback LayoutFunction
  * @param {LayoutFunctionParams<T, U, V, D>} params - The parameters for the layout.
  * @returns {V | Promise<V>} The rendered content.
  */

/**
  * Asynchronous callback for rendering a layout.
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @template {object} [D=Record<string, unknown>] - Declared global data.
  * @callback AsyncLayoutFunction
  * @param {LayoutFunctionParams<T, U, V, D>} params - The parameters for the layout.
  * @returns {Promise<V>} The rendered content.
  */

/**
 * A resolved layout module with its render function and associated asset paths.
 *
 * @template {Record<string, any>} T - The type of variables for the layout
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef ResolvedLayout
 * @property {LayoutFunction<T, U, V, D>} render - The layout function
 * @property {Partial<T>} [vars] - Variables exported by the layout module.
 * @property {PageOutputsFunction<T, D> | undefined} [pageOutputs] - Explicit output-phase hook.
 * @property {string} [source] - Layout module path for diagnostics.
 * @property {string} name - The name of the layout
 * @property {string | undefined} [parentLayout] - Name of the optional outer layout.
 * @property {string | null} layoutStylePath - The string path to the layout style
 * @property {string | null} layoutClientPath - The string path to the layout client
 */
