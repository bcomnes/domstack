/**
 * @import { PageInfo } from '../identify-pages.js'
 * @import { BuilderOptions, InternalPageFunction } from './page-builders/page-writer.js'
 */

import { readFile } from 'node:fs/promises'
import { resolveVars, resolvePostVars, resolveVarsExport } from './resolve-vars.js'
import { pageBuilders } from './page-builders/index.js'
import { parseMdFileContents } from './page-builders/md/parse-md.js'
import { createSubscribedData, extractDataDeps } from './data-deps.js'
import { DomStackDataError } from '../helpers/domstack-error.js'
import pretty from 'pretty'
import { resolveLayoutChain } from './resolve-layout-chain.js'

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
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @param {string} layoutPath - The string path to the layout ESM module.
 * @returns {Promise<{ render: InternalLayoutFunction<T, U, V, D>, vars: Partial<T>, parentLayout: string | undefined }>} The resolved layout module exports.
 */
export async function resolveLayout (layoutPath) {
  const { default: layout, vars, parentLayout } = await import(layoutPath)
  if (typeof layout !== 'function') throw new TypeError(`Layout "${layoutPath}" must export a default render function`)
  if (parentLayout !== undefined && (typeof parentLayout !== 'string' || !parentLayout.trim())) {
    throw new TypeError(`Layout "${layoutPath}" parentLayout must be a non-empty string`)
  }

  return {
    render: layout,
    parentLayout,
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
  * Callback for rendering a layout (can be sync or async).
  *
  * @template {Record<string, any>} T - The type of variables passed to the layout function
  * @template [U=any] U - The return type of the page function (defaults to any)
  * @template [V=string] V - The return type of the layout function (defaults to string)
  * @template {object} [D=Record<string, unknown>] - Declared global data.
  * @typedef {LayoutFunction<T, U, V, D>} InternalLayoutFunction
  */

/**
 * A resolved layout module with its render function and associated asset paths.
 *
 * @template {Record<string, any>} T - The type of variables for the layout
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef ResolvedLayout
 * @property {InternalLayoutFunction<T, U, V, D>} render - The layout function
 * @property {Partial<T>} [vars] - Variables exported by the layout module.
 * @property {string} name - The name of the layout
 * @property {string | undefined} [parentLayout] - Name of the optional outer layout.
 * @property {string | null} layoutStylePath - The string path to the layout style
 * @property {string | null} layoutClientPath - The string path to the layout client
 */

/**
 * Represents the data for a page.
 * @template {Record<string, any>} T - The type of variables for the page data
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 */
export class PageData {
  /** @type {PageInfo} */ pageInfo
  /** @type {ResolvedLayout<T, U, V, any> | null | undefined} */ layout
  /** @type {ResolvedLayout<T, any, any, any>[]} Each parent has its own render and data contracts. */ layoutChain = []
  /** @type {Partial<T>} */ globalVars
  /** @type {Partial<T>} */ layoutVars = {}
  /** @type {Partial<T> | null} */ pageVars = null
  /** @type {Partial<T> | null} */ builderVars = null
  /** @type {string[]} Union of the page and entire layout chain, for output invalidation. */ dataDeps = []
  /** @type {string[]} */ #pageDataDeps = []
  /** @type {Map<string, { keys: string[], data: Record<string, unknown> }>} */ #layoutSubscriptions = new Map()
  /** @type {string[]} */ styles = []
  /** @type {string[]} */ scripts = []
  /** @type {WorkerFiles} */ workerFiles = {}
  /** @type {boolean} */ #initialized = false
  /** @type {T | null} */ #varsCache = null
  /** @type {[Partial<T>, Partial<T>, Partial<T> | null, Partial<T> | null] | null} */ #varsCacheSources = null
  /** @type {D} */ #data = /** @type {D} */ (Object.freeze({}))
  /** @type {boolean} */ #dataReady = false
  /** @type {string?} */ #defaultStyle = null
  /** @type {string?} */ #defaultClient = null
  /** @type {BuilderOptions} */ builderOptions

  /**
   * Creates an instance of PageData.
   *
   * @param {object} options - The options object.
   * @param  {PageInfo} options.pageInfo - Page-specific data.
   * @param  {NoInfer<Partial<T>>} options.globalVars - Global variables available to all pages.
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
    const sources = /** @type {[Partial<T>, Partial<T>, Partial<T> | null, Partial<T> | null]} */ ([
      this.globalVars,
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
      const { globalVars, layoutVars, pageVars, builderVars } = this
      this.#varsCache = /** @type {T} */ (/** @type {unknown} */ (Object.freeze({
        ...globalVars,
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
   * Return only the global-data values declared by the page itself.
   *
   * @returns {D}
   */
  get data () {
    if (!this.#dataReady && this.#pageDataDeps.length > 0) {
      throw this.#dataNotReadyError()
    }
    return this.#data
  }

  #dataNotReadyError () {
    return new DomStackDataError(
      `Global data is not available while resolving global.data for page "${this.pageInfo.pageFile.relname}" or its layouts`,
      { reason: 'NOT_READY', consumer: `Page "${this.pageInfo.pageFile.relname}"` }
    )
  }

  /**
   * Select the declared global-data values after global.data has resolved.
   *
   * @param {Record<string, unknown>} globalData
   */
  setGlobalData (globalData) {
    this.#data = /** @type {D} */ (createSubscribedData(
      globalData,
      this.#pageDataDeps,
      `Page "${this.pageInfo.pageFile.relname}"`
    ))
    for (const [name, subscription] of this.#layoutSubscriptions) {
      subscription.data = createSubscribedData(globalData, subscription.keys, `Layout "${name}"`)
    }
    this.#dataReady = true
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
   * Resolve the page's vars, layout chain, and assets once before rendering.
   * @param  {object} params - Parameters required to initialize
   * @param  {Record<string, ResolvedLayout<T, any, any, any>>} params.layouts - Layouts indexed by name.
   */
  async init ({ layouts }) {
    if (this.#initialized) return
    const { pageInfo, globalVars } = this
    if (!pageInfo) throw new Error('A page is required to initialize')
    const { pageVars, type } = pageInfo
    const resolvedPageVars = await resolveVars({
      varsPath: pageVars?.filepath,
    })
    await resolvePostVars({ varsPath: pageVars?.filepath }) // throws if postVars export is detected

    const builder = pageBuilders[type]
    const { vars: builderVars } = await builder({ pageInfo, options: this.builderOptions })

    const layoutName = resolveLayoutName(globalVars, resolvedPageVars, builderVars)

    this.layoutChain = resolveLayoutChain(layoutName, layouts)
    this.layout = this.layoutChain.at(-1)
    const pageResolution = extractDataDeps(resolvedPageVars, `Page vars "${pageInfo.pageFile.relname}"`)
    const builderResolution = extractDataDeps(builderVars, `Page "${pageInfo.pageFile.relname}"`)
    this.pageVars = pageResolution.vars
    this.builderVars = /** @type {Partial<T>} */ (builderResolution.vars)
    this.#pageDataDeps = [...new Set([...pageResolution.dataDeps, ...builderResolution.dataDeps])].sort()
    const dependencies = new Set(this.#pageDataDeps)
    for (const layout of this.layoutChain) {
      const resolution = extractDataDeps(layout.vars, `Layout "${layout.name}"`)
      this.#layoutSubscriptions.set(layout.name, { keys: resolution.dataDeps, data: Object.freeze({}) })
      Object.assign(this.layoutVars, resolution.vars)
      for (const key of resolution.dataDeps) dependencies.add(key)
      if (layout.layoutStylePath) this.styles.push(layout.layoutStylePath)
      if (layout.layoutClientPath) this.scripts.push(layout.layoutClientPath)
    }

    this.dataDeps = [...dependencies].sort()

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
      ...this.layoutVars,
      ...this.pageVars,
      ...this.builderVars,
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
   * @returns {Promise<Awaited<U>>} The page's render value, before any layout runs.
   */
  async renderInnerPage () {
    if (!this.#initialized) throw new Error('Must be initialized before rendering inner pages')
    const { pageInfo, styles, scripts, vars, data, builderOptions, workers } = this
    if (!pageInfo) throw new Error('A page is required to render')
    const builder = pageBuilders[pageInfo.type]
    const { pageLayout } = await builder({ pageInfo, options: builderOptions })
    // Discovery selects the builder; the caller's U describes that page's result.
    const render = /** @type {InternalPageFunction<T, U, D>} */ (pageLayout)
    const results = await render({ vars, data, styles, scripts, page: pageInfo, workers })
    return results
  }

  /**
   * Render the full contents of a page with its layout
   */
  async renderFullPage () {
    if (!this.#initialized) throw new Error('Must be initialized before rendering full pages')
    if (!this.#dataReady && this.dataDeps.length > 0) {
      throw this.#dataNotReadyError()
    }
    const { pageInfo, layout, layoutChain, vars, styles, scripts } = this
    if (!pageInfo) throw new Error('A page is required to render')
    if (!layout) throw new Error('A layout is required to render')
    /** @type {unknown} */
    let rendered = await this.renderInnerPage()
    for (const currentLayout of layoutChain.toReversed()) {
      rendered = await currentLayout.render({
        vars,
        styles,
        scripts,
        page: pageInfo,
        data: this.#layoutSubscriptions.get(currentLayout.name)?.data,
        children: rendered,
        workers: this.workers
      })
    }
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
