/**
 * @import { PageInfo } from '../identify-pages.js'
 * @import { BuilderOptions } from './page-builders/page-writer.js'
 * @import { ResolvedLayout } from './index.js'
 */

import { resolveVars, resolvePostVars } from './resolve-vars.js'
import { pageBuilders } from './page-builders/index.js'
// @ts-expect-error
import pretty from 'pretty'

/**
 * @typedef {Object<string, string>} WorkerFiles
 */

/**
 * Resolves a layout from an ESM module.
 *
 * @async
 * @function
 * @template T - The type of variables for the layout
 * @param {string} layoutPath - The string path to the layout ESM module.
 * @returns {Promise<LayoutFunction<T>>} The resolved layout exported as default from the module.
 */
export async function resolveLayout (layoutPath) {
  const { default: layout } = await import(layoutPath)

  return layout
}

/**
  * Callback for rendering a layout.
  *
  * @template T - The type of variables passed to the layout function
  * @callback LayoutFunction
  * @param {object} params - The parameters for the layout.
  * @param {T} params.vars - All default, global, layout, page, and builder vars shallow merged.
  * @param {string[]} [params.scripts] - Array of script URLs to include.
  * @param {string[]} [params.styles] - Array of stylesheet URLs to include.
  * @param {any} params.children - The children content, either as a string or a render function.
  * @param {PageInfo} params.page - Info about the current page
  * @param {PageData<T>[]} params.pages - An array of info about every page
  * @param {Object<string, string>} [params.workers] - Map of worker names to their output paths
  * @returns {Promise<string> | string} The rendered HTML string.
  */

/**
  * postVars functions Can be used to generate page vars but access all page data
  *
  * @async
  * @template {Record<string, any>} T - The type of variables for the page
  * @callback PostVarsFunction
  * @param {object} params - The parameters for the pageLayout.
  * @param {T} params.vars - All default, global, layout, page, and builder vars shallow merged.
  * @param {string[]} [params.scripts] - Array of script URLs to include.
  * @param {string[]} [params.styles] - Array of stylesheet URLs to include.
  * @param {PageInfo} params.page - Info about the current page
  * @param {PageData<T>[]} params.pages - An array of info about every page
  * @param {Object<string, string>} [params.workers] - Map of worker names to their output paths
  * @returns {Promise<T>} The rendered postVars
  */

/**
 * Represents the data for a page.
 * @template {Record<string, any>} T - The type of variables for the page data
 */
export class PageData {
  /** @type {PageInfo} */ pageInfo
  /** @type {ResolvedLayout<T> | null | undefined} */ layout
  /** @type {object} */ globalVars
  /** @type {object?} */ pageVars = null
  /** @type {function?} */ postVars = null
  /** @type {object?} */ builderVars = null
  /** @type {string[]} */ styles = []
  /** @type {string[]} */ scripts = []
  /** @type {WorkerFiles|undefined} */ workerFiles = undefined
  /** @type {boolean} */ #initialized = false
  /** @type {T?} */ #renderedPostVars = null
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
    const { globalVars, pageVars, builderVars } = this
    // @ts-ignore
    return {
      ...globalVars,
      ...pageVars,
      ...builderVars,
    }
  }

  /**
   * Access web worker file paths associated with this page
   * @return {WorkerFiles|undefined} Map of worker names to their output paths
   */
  get workers () {
    return this.workerFiles
  }

  /**
   * @type {PostVarsFunction<T>}
   */
  async #renderPostVars ({ vars, styles, scripts, pages, page, workers }) {
    if (!this.#initialized) throw new Error('Initialize PageData before accessing renderPostVars')
    if (!this.postVars) return this.vars
    if (this.#renderedPostVars) return this.#renderedPostVars

    const { globalVars, pageVars, builderVars } = this

    const renderedPostVars = {
      ...globalVars,
      ...pageVars,
      ...(await this.postVars({ vars, styles, scripts, pages, page, workers })),
      ...builderVars,
    }

    this.#renderedPostVars = renderedPostVars

    return renderedPostVars
  }

  /**
   * [init description]
   * @param  {object} params - Parameters required to initialize
   * @param  {Record<string,ResolvedLayout<T>>} params.layouts - The array of ResolvedLayouts
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
    this.postVars = await resolvePostVars({
      varsPath: pageVars?.filepath,
    })

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
      this.workerFiles = {}
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
   * @param  {PageData<T>[]} params.pages An array of initialized PageDatas.
   */
  async renderInnerPage ({ pages }) {
    if (!this.#initialized) throw new Error('Must be initialized before rendering inner pages')
    const { pageInfo, styles, scripts, vars, builderOptions, workers } = this
    if (!pageInfo) throw new Error('A page is required to render')
    const builder = pageBuilders[pageInfo.type]
    const { pageLayout } = await builder({ pageInfo, options: builderOptions })
    const renderedPostVars = await this.#renderPostVars({ vars, styles, scripts, pages, page: pageInfo, workers })
    // @ts-ignore
    return await pageLayout({ vars: renderedPostVars, styles, scripts, pages, page: pageInfo, workers })
  }

  /**
   * Render the full contents of a page with its layout
   * @param  {object} params The params required to render the page
   * @param  {PageData<T>[]} params.pages An array of initialized PageDatas.
   */
  async renderFullPage ({ pages }) {
    if (!this.#initialized) throw new Error('Must be initialized before rendering full pages')
    const { pageInfo, layout, vars, styles, scripts, workers } = this
    if (!pageInfo) throw new Error('A page is required to render')
    if (!layout) throw new Error('A layout is required to render')
    const renderedPostVars = await this.#renderPostVars({ vars, styles, scripts, pages, page: pageInfo, workers })
    const innerPage = await this.renderInnerPage({ pages })

    return pretty(
      await layout.render({
        vars: renderedPostVars,
        styles,
        scripts,
        page: pageInfo,
        pages,
        children: innerPage,
        workers: this.workers
      })
    )
  }
}
