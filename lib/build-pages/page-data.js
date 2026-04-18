/**
 * @import { PageInfo } from '../identify-pages.js'
 * @import { BuilderOptions } from './page-builders/page-writer.js'
 * @import { ResolvedLayout } from './index.js'
 */

import { resolveVars, resolvePostVars } from './resolve-vars.js'
import { pageBuilders } from './page-builders/index.js'
import { fsPathToUrlPath } from './page-builders/fs-path-to-url.js'
// @ts-expect-error
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
 * @returns {Promise<InternalLayoutFunction<T, U, V>>} The resolved layout exported as default from the module.
 */
export async function resolveLayout (layoutPath) {
  const { default: layout } = await import(layoutPath)

  return layout
}

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
  /** @type {object?} */ pageVars = null
  /** @type {object?} */ builderVars = null
  /** @type {string[]} */ styles = []
  /** @type {string[]} */ scripts = []
  /** @type {WorkerFiles} */ workerFiles = {}
  /** @type {boolean} */ #initialized = false
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
   * Returns the fully resolved variable set for the page. Requires initialization.
   * @return {T} globalVars, pageVars, and buildVars merged together
   */
  get vars () {
    if (!this.#initialized) throw new Error('Initialize PageData before accessing vars')
    const { globalVars, globalDataVars, pageVars, builderVars } = this
    // @ts-ignore
    return {
      pageUrl: this.#computePageUrl(),
      ...globalVars,
      ...globalDataVars,
      ...pageVars,
      ...builderVars,
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
   * Derive the canonical URL path for this page from its filesystem path and output name.
   * Index pages get a trailing-slash URL; other outputs include the filename.
   * @return {string}
   */
  #computePageUrl () {
    const { path, outputName } = this.pageInfo
    if (outputName === 'index.html') {
      return path ? fsPathToUrlPath(path) + '/' : '/'
    }
    return path ? fsPathToUrlPath(path) + '/' + outputName : '/' + outputName
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
      resolveVars: globalVars,
    })
    await resolvePostVars({ varsPath: pageVars?.filepath }) // throws if postVars export is detected

    const builder = pageBuilders[type]
    const { vars: builderVars } = await builder({ pageInfo, options: this.builderOptions })
    this.builderVars = builderVars

    /** @type {object} */
    const finalVars = {
      ...globalVars,
      ...this.pageVars,
      ...builderVars,
    }

    if (!('layout' in finalVars)) throw new Error('Page variables missing a layout var')
    if (typeof finalVars.layout !== 'string') throw new Error('Layout variable must be a string')

    this.layout = layouts[finalVars.layout]
    if (!this.layout) throw new Error('Unable to resolve a layout')

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

    return pretty(
      await layout.render({
        vars,
        styles,
        scripts,
        page: pageInfo,
        pages,
        // @ts-expect-error - innerPage type varies by page builder but layout handles it
        children: innerPage,
        workers: this.workers
      })
    )
  }
}
