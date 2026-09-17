/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { ResolvedLayout } from '../layouts/resolve-layout.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 * @import { DomStackWarning } from '../../helpers/domstack-warning.js'
 * @import { BuilderOptions, PageFunction } from '../outputs/page-writer.js'
 * @import { CollectedPageOutput } from '../outputs/page-outputs.js'
 * @import { PageOutputProvider } from '../outputs/collect-page-outputs.js'
 */

import { readFile } from 'node:fs/promises'
import { normalize } from 'node:path'
import { toPosix } from '../../helpers/path.js'
import { resolveVars, resolvePostVars } from '../vars/resolve-vars.js'
import { PageVars } from '../vars/page-vars.js'
import { pageBuilders } from '../page-builders/index.js'
import { parseMdFileContents } from '../page-builders/md/parse-md.js'
import { extractDataDeps } from '../global-data/data-deps.js'
import { PageSubscriptions } from '../global-data/page-subscriptions.js'

import pretty from 'pretty'
import { resolveLayoutChain } from '../layouts/resolve-layout-chain.js'
import { resolveLayoutName } from '../layouts/resolve-layout-name.js'
import { validatePageOutputsHook } from '../outputs/page-outputs.js'
import { collectPageOutputs } from '../outputs/collect-page-outputs.js'

/**
 * @typedef {Object<string, string>} WorkerFiles
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
  /** @type {DomStackWarning[]} */ warnings = []
  /** @type {DomstackManifestRecord[]} Successfully emitted files, including partial builds; never populated by rendering alone. */ outputRecords = []
  /** @type {ResolvedLayout<T, U, V, any> | null | undefined} */ layout
  /** @type {ResolvedLayout<T, any, any, any>[]} Each parent has its own render and data contracts. */ layoutChain = []
  /** @type {Partial<T>} */ globalVars
  /** @type {{ name: string, vars: Partial<T> }[]} Layout variable sources, outermost to innermost, with dataDeps extracted. */ layoutVars = []
  /** @type {Partial<T> | null} */ pageVars = null
  /** @type {Partial<T> | null} */ builderVars = null
  /** @type {string[]} Union of the page and entire layout chain, for output invalidation. */ dataDeps = []
  /** @type {PageSubscriptions<D>} */ #subscriptions = new PageSubscriptions()
  /** @type {PageOutputProvider<T> | undefined} */ #pageOutputs

  /** @type {string[]} */ styles = []
  /** @type {string[]} */ scripts = []
  /** @type {WorkerFiles} */ workerFiles = {}
  /** @type {boolean} */ #initialized = false
  /** @type {PageVars<T>} */ #vars = new PageVars()

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
   * Source-root-relative identity with POSIX separators, independent of checkout
   * location and output URL. Generated pages use their synthetic factory relname.
   * @returns {string}
   */
  get sourceId () {
    return toPosix(normalize(this.pageInfo.pageFile.relname))
  }

  /**
   * Returns the cached, shallow-frozen variable set for the page. Requires initialization.
   * @return {T} default/global, layout, page, and builder vars merged together
   */
  get vars () {
    if (!this.#initialized) throw new Error(`Initialize PageData before accessing vars for page "${this.pageInfo?.path ?? '<unknown page>'}"`)
    try {
      return this.#vars.get(this)
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
    return this.#subscriptions.getPageData(this.pageInfo)
  }

  /**
   * Select the declared global-data values after global.data has resolved.
   *
   * @param {Record<string, unknown>} globalData
   */
  setGlobalData (globalData) {
    this.#subscriptions.bind(globalData, this.pageInfo)
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
    const built = await builder({ pageInfo, options: this.builderOptions })
    const { vars: builderVars } = built
    if (!pageInfo.generated) {
      const pageModuleOutputs = type === 'js' ? built.pageOutputs : undefined
      const varsCompanionOutputs = pageVars?.filepath
        ? validatePageOutputsHook((await import(pageVars.filepath)).pageOutputs, pageVars.filepath)
        : undefined
      if (pageModuleOutputs && varsCompanionOutputs) {
        this.warnings.push({
          code: 'DOM_STACK_WARNING_DUPLICATE_PAGE_OUTPUTS_PROVIDER',
          message: `Page "${pageInfo.pageFile.filepath}" and companion "${pageVars?.filepath}" both export pageOutputs; using the page module export and ignoring the companion export`,
        })
      }
      const hook = pageModuleOutputs ?? varsCompanionOutputs
      if (hook) {
        this.#pageOutputs = {
          hook,
          provenance: {
            kind: pageModuleOutputs ? 'page' : 'companion',
            source: pageModuleOutputs ? pageInfo.pageFile.filepath : /** @type {string} */ (pageVars?.filepath),
          },
        }
      }
    }

    const layoutName = resolveLayoutName(globalVars, resolvedPageVars, builderVars)

    this.layoutChain = resolveLayoutChain(layoutName, layouts)
    this.layout = this.layoutChain.at(-1)
    const pageResolution = extractDataDeps(resolvedPageVars, `Page vars "${pageInfo.pageFile.relname}"`)
    const builderResolution = extractDataDeps(builderVars, `Page "${pageInfo.pageFile.relname}"`)
    this.pageVars = pageResolution.vars
    this.builderVars = /** @type {Partial<T>} */ (builderResolution.vars)
    this.#subscriptions.setPageDependencies(pageResolution.dataDeps, builderResolution.dataDeps)
    for (const layout of this.layoutChain) {
      const resolution = extractDataDeps(layout.vars, `Layout "${layout.name}"`)
      this.#subscriptions.addLayout(layout.name, resolution.dataDeps)
      this.layoutVars.push({ name: layout.name, vars: /** @type {Partial<T>} */ (resolution.vars) })

      if (layout.layoutStylePath) this.styles.push(layout.layoutStylePath)
      if (layout.layoutClientPath) this.scripts.push(layout.layoutClientPath)
    }

    this.dataDeps = this.#subscriptions.dependencies

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

    // First vars access must still observe source changes made after init.
    /** @type {object} */
    const finalVars = this.#vars.merge(this)

    // disable-eslint-next-line dot-notation
    if ('defaultStyle' in finalVars && finalVars.defaultStyle) {
      if (this.#defaultClient) this.scripts.unshift(`/${this.#defaultClient}`)
      if (this.#defaultStyle) this.styles.unshift(`/${this.#defaultStyle}`)
    }

    this.#initialized = true
  }

  /**
   * Run hooks lazily as the output phase consumes each record.
   * Layouts run outermost first, followed by the single page-level provider.
   * @returns {AsyncGenerator<CollectedPageOutput, void, unknown>}
   */
  async * collectPageOutputs () {
    if (!this.#initialized) throw new Error('Must be initialized before collecting pageOutputs')
    if (this.pageInfo.generated) return
    yield * collectPageOutputs(this, this.#subscriptions, this.#pageOutputs)
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
    const render = /** @type {PageFunction<T, U, D>} */ (pageLayout)
    const results = await render({ vars, data, styles, scripts, page: pageInfo, workers })
    return results
  }

  /**
   * Render the full contents of a page with its layout
   */
  async renderFullPage () {
    if (!this.#initialized) throw new Error('Must be initialized before rendering full pages')
    this.#subscriptions.assertReady(this.dataDeps, this.pageInfo)
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
        data: this.#subscriptions.getLayoutData(currentLayout.name, this.pageInfo),
        children: rendered,
        workers: this.workers
      })
    }
    return pretty(String(rendered))
  }
}
