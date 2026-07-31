/**
 * @import { PageInfo } from '../identify-pages.js'
 * @import { BuilderOptions } from './page-builders/page-writer.js'
 */

import { readFile } from 'node:fs/promises'
import { resolveVars, resolvePostVars, resolveVarsExport } from './resolve-vars.js'
import { pageBuilders } from './page-builders/index.js'
import { parseMdFileContents } from './page-builders/md/parse-md.js'
import pretty from 'pretty'

/**
 * @typedef {Object<string, string>} WorkerFiles
 */

/**
 * Resolves a layout from an ESM module.
 *
 * @function
 * @template {Record<string, any>} T - The type of variables for the layout
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @param {string} layoutPath - The string path to the layout ESM module.
 * @returns {Promise<{ render: InternalLayoutFunction<T, U, V>, vars: object }>} The resolved layout render function and optional vars exported from the module.
 */
export async function resolveLayout (layoutPath) {
  const { default: layout, vars } = await import(layoutPath)

  return {
    render: layout,
    vars: await resolveVarsExport(vars, 'Layout vars'),
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
  * @typedef {object} LayoutFunctionParams
  * @property {T} vars - All default, global, layout, page, and builder vars shallow merged.
  * @property {string[]} [scripts] - Array of script URLs to include.
  * @property {string[]} [styles] - Array of stylesheet URLs to include.
  * @property {U} children - The children content, either as a string or a render function.
  * @property {PageInfo} page - Info about the current page
  * @property {PageData<T, U, V>[]} pages - An array of info about every page
  * @property {Object<string, string>} [workers] - Map of worker names to their output paths
  */

/**
  * Synchronous callback for rendering a layout.
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @callback LayoutFunction
  * @param {LayoutFunctionParams<T, U, V>} params - The parameters for the layout.
  * @returns {V | Promise<V>} The rendered content.
  */

/**
  * Asynchronous callback for rendering a layout.
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @callback AsyncLayoutFunction
  * @param {LayoutFunctionParams<T, U, V>} params - The parameters for the layout.
  * @returns {Promise<V>} The rendered content.
  */

/**
  * Callback for rendering a layout (can be sync or async).
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @typedef {LayoutFunction<T, U, V> | AsyncLayoutFunction<T, U, V>} InternalLayoutFunction
  */

/**
 * A resolved layout module with its render function and associated asset paths.
 *
 * @template {Record<string, any>} T - The type of variables for the layout
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @typedef ResolvedLayout
 * @property {InternalLayoutFunction<T, U, V>} render - The layout function
 * @property {object} [vars] - Variables exported by the layout module.
 * @property {string} name - The name of the layout
 * @property {string | null} layoutStylePath - The string path to the layout style
 * @property {string | null} layoutClientPath - The string path to the layout client
 */

/**
 * Represents the data for a page.
 * @template {Record<string, any>} T - The type of variables for the page data
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 */
export class PageData {
  /** @type {PageInfo} */ pageInfo
  /** @type {ResolvedLayout<T, U, V> | null | undefined} */ layout
  /** @type {object} */ globalVars
  /** @type {object} */ globalDataVars = {}
  /** @type {object} */ layoutVars = {}
  /** @type {object?} */ pageVars = null
  /** @type {object?} */ builderVars = null
  /** @type {string[]} */ styles = []
  /** @type {string[]} */ scripts = []
  /** @type {WorkerFiles} */ workerFiles = {}
  /** @type {boolean} */ #initialized = false
  /** @type {T | null} */ #varsCache = null
  /** @type {[object, object, object, object | null, object | null] | null} */ #varsCacheSources = null
  /** @type {string?} */ #defaultStyle = null
  /** @type {string?} */ #defaultClient = null
  /** @type {BuilderOptions} */ builderOptions

  /**
   * Creates an instance of PageData.
   *
   * @param {object} options - The options object.
   * @param  {PageInfo} options.pageInfo - Page-specific data.
   * @param  {object} options.globalVars - Global variables available to all pages.
   * @param  {string | undefined} options.globalStyle - Global style path.
   * @param  {string | undefined} options.globalClient - Global client-side script path.
   * @param  {string?} options.defaultStyle - Default style path.
   * @param  {string?} options.defaultClient - Default client-side script path.
   * @param  {BuilderOptions} options.builderOptions - Options for page builders.
   */
  constructor ({
    pageInfo,
    globalVars,
    globalStyle,
    globalClient,
    defaultStyle,
    defaultClient,
    builderOptions,
  }) {
    this.pageInfo = pageInfo
    this.globalVars = globalVars
    this.#defaultStyle = defaultStyle
    this.#defaultClient = defaultClient
    this.builderOptions = builderOptions

    if (globalStyle) {
      this.styles.push(`/${globalStyle}`)
    }
    if (globalClient) {
      this.scripts.push(`/${globalClient}`)
    }
  }

  /**
   * Returns the cached, shallow-frozen variable set for the page. Requires initialization.
   * @return {T} default/global, layout, page, and builder vars merged together
   */
  get vars () {
    if (!this.#initialized) throw new Error(`Initialize PageData before accessing vars for page "${this.pageInfo?.path ?? '<unknown page>'}"`)
    const sources = /** @type {[object, object, object, object | null, object | null]} */ ([
      this.globalVars,
      this.globalDataVars,
      this.layoutVars,
      this.pageVars,
      this.builderVars,
    ])

    if (
      this.#varsCache &&
      this.#varsCacheSources &&
      this.#varsCacheSources.every((source, index) => source === sources[index])
    ) {
      return this.#varsCache
    }

    try {
      const { globalVars, globalDataVars, layoutVars, pageVars, builderVars } = this
      this.#varsCache = /** @type {T} */ (/** @type {unknown} */ (Object.freeze({
        ...globalVars,
        ...globalDataVars,
        ...layoutVars,
        ...pageVars,
        ...builderVars,
      })))
      this.#varsCacheSources = sources
      return this.#varsCache
    } catch (err) {
      throw new Error(
        `Failed to resolve vars for page "${this.pageInfo?.path ?? '<unknown page>'}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      )
    }
  }

  /**
   * Access web worker file paths associated with this page
   * @return {WorkerFiles} Map of worker names to their output paths
   */
  get workers () {
    return this.workerFiles
  }

  /**
   * Read the raw markdown body for a markdown page, excluding front matter.
   * @returns {Promise<string>}
   */
  async readMarkdownContent () {
    if (!this.pageInfo) throw new Error('A page is required to read markdown content')
    if (this.pageInfo.type !== 'md') throw new Error('Markdown content can only be read from markdown pages')

    const fileContents = await readFile(this.pageInfo.pageFile.filepath, 'utf8')
    return parseMdFileContents(fileContents).markdownContent
  }

  /**
   * [init description]
   * @param  {object} params - Parameters required to initialize
   * @param  {Record<string,ResolvedLayout<T, U, V>>} params.layouts - The array of ResolvedLayouts
   */
  async init ({ layouts }) {
    if (this.#initialized) return
    const { pageInfo, globalVars } = this
    if (!pageInfo) throw new Error('A page is required to initialize')
    const { pageVars, type } = pageInfo
    this.pageVars = await resolveVars({
      varsPath: pageVars?.filepath,
    })
    await resolvePostVars({ varsPath: pageVars?.filepath }) // throws if postVars export is detected

    const builder = pageBuilders[type]
    const { vars: builderVars } = await builder({ pageInfo, options: this.builderOptions })
    this.builderVars = builderVars

    const layoutName = resolveLayoutName(globalVars, this.pageVars, builderVars)

    this.layout = layouts[layoutName]
    if (!this.layout) throw new Error('Unable to resolve a layout')
    this.layoutVars = this.layout.vars ?? {}

    if (this.layout.layoutStylePath) {
      this.styles.push(this.layout.layoutStylePath)
    }

    if (this.layout.layoutClientPath) {
      this.scripts.push(this.layout.layoutClientPath)
    }

    if (pageInfo.pageStyle) {
      this.styles.push(`./${pageInfo.pageStyle.outputName}`)
    }
    if (pageInfo.clientBundle) {
      this.scripts.push(`./${pageInfo.clientBundle.outputName}`)
    }
    // Initialize web workers if they exist
    if (pageInfo.workers) {
      /** @type {WorkerFiles} */
      for (const [workerName, workerFile] of Object.entries(pageInfo.workers)) {
        if (workerFile.outputRelname) {
          this.workerFiles[workerName] = `./${workerFile.outputName}`
        }
      }
    }

    /** @type {object} */
    const finalVars = {
      ...globalVars,
      ...this.globalDataVars,
      ...this.layoutVars,
      ...this.pageVars,
      ...builderVars,
    }

    // disable-eslint-next-line dot-notation
    if ('defaultStyle' in finalVars && finalVars.defaultStyle) {
      if (this.#defaultClient) this.scripts.unshift(`/${this.#defaultClient}`)
      if (this.#defaultStyle) this.styles.unshift(`/${this.#defaultStyle}`)
    }

    this.#initialized = true
  }

  /**
   * Render the inner contents of a page.
   * @param  {object} params The params required to render the page
   * @param  {PageData<T, U, V>[]} params.pages An array of initialized PageDatas.
   */
  async renderInnerPage ({ pages }) {
    if (!this.#initialized) throw new Error('Must be initialized before rendering inner pages')
    const { pageInfo, styles, scripts, vars, builderOptions, workers } = this
    if (!pageInfo) throw new Error('A page is required to render')
    const builder = pageBuilders[pageInfo.type]
    const { pageLayout } = await builder({ pageInfo, options: builderOptions })
    // @ts-expect-error - Builder types vary by page type, but the runtime type is correct
    const results = await pageLayout({ vars, styles, scripts, pages, page: pageInfo, workers })
    return results
  }

  /**
   * Render the full contents of a page with its layout
   * @param  {object} params The params required to render the page
   * @param  {PageData<T, U, V>[]} params.pages An array of initialized PageDatas.
   */
  async renderFullPage ({ pages }) {
    if (!this.#initialized) throw new Error('Must be initialized before rendering full pages')
    const { pageInfo, layout, vars, styles, scripts } = this
    if (!pageInfo) throw new Error('A page is required to render')
    if (!layout) throw new Error('A layout is required to render')
    const innerPage = await this.renderInnerPage({ pages })

    const rendered = await layout.render({
      vars,
      styles,
      scripts,
      page: pageInfo,
      pages,
      children: /** @type {U} */ (/** @type {unknown} */ (innerPage)),
      workers: this.workers
    })
    return pretty(String(rendered))
  }
}

/**
 * Resolve the selected layout name without constructing a partial vars object.
 *
 * Layout selection intentionally uses only pre-layout sources to avoid circular
 * dependency on the selected layout's own vars. The lookup preserves the same
 * precedence as the previous spread: builder/page-frontmatter vars, then
 * page.vars, then global vars.
 *
 * @param {object} globalVars
 * @param {object | null} pageVars
 * @param {object | null} builderVars
 * @returns {string}
 */
function resolveLayoutName (globalVars, pageVars, builderVars) {
  for (const source of [builderVars, pageVars, globalVars]) {
    if (!source || !('layout' in source)) continue
    if (typeof source.layout !== 'string') throw new Error('Layout variable must be a string')
    return source.layout
  }

  throw new Error('Page variables missing a layout var')
}
