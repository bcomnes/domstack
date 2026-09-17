/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { ResolvedLayout } from '../layouts/resolve-layout.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 * @import { DomStackWarning } from '../../helpers/domstack-warning.js'
 * @import { BuilderOptions, PageFunction } from '../outputs/page-writer.js'
 * @import { PageOutputsFunction, PageOutputProvenance, CollectedPageOutput } from '../outputs/page-outputs.js'
 */

import { readFile } from 'node:fs/promises'
import { normalize } from 'node:path'
import { toPosix } from '../../helpers/path.js'
import { resolveVars, resolvePostVars } from '../vars/resolve-vars.js'
import { pageBuilders } from '../page-builders/index.js'
import { parseMdFileContents } from '../page-builders/md/parse-md.js'
import { createSubscribedData, extractDataDeps } from '../global-data/data-deps.js'
import { DomStackDataError } from '../../helpers/domstack-error.js'
import pretty from 'pretty'
import { resolveLayoutChain } from '../layouts/resolve-layout-chain.js'
import { resolveLayoutName } from '../layouts/resolve-layout-name.js'
import { createPageOutputsPage, normalizePageOutputs, validatePageOutputsHook } from '../outputs/page-outputs.js'

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
  /** @type {string[]} */ #pageDataDeps = []
  /** @type {{ hook: PageOutputsFunction<T, any>, provenance: PageOutputProvenance } | undefined} */ #pageOutputs
  /** @type {Map<string, { keys: string[], data: Record<string, unknown> }>} */ #layoutSubscriptions = new Map()
  /** @type {string[]} */ styles = []
  /** @type {string[]} */ scripts = []
  /** @type {WorkerFiles} */ workerFiles = {}
  /** @type {boolean} */ #initialized = false
  /** @type {T | null} */ #varsCache = null
  /** @type {(Partial<T> | null)[] | null} */ #varsCacheSources = null
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

  #varSources () {
    return [
      this.globalVars,
      ...this.layoutVars.map(layout => layout.vars),
      this.pageVars,
      this.builderVars,
    ]
  }

  #varSourcesUnchanged () {
    const sources = this.#varsCacheSources
    const layoutCount = this.layoutVars.length
    if (
      !sources ||
      sources.length !== layoutCount + 3 ||
      sources[0] !== this.globalVars ||
      sources[layoutCount + 1] !== this.pageVars ||
      sources[layoutCount + 2] !== this.builderVars
    ) return false

    for (let index = 0; index < layoutCount; index++) {
      const layout = this.layoutVars[index]
      if (!layout || sources[index + 1] !== layout.vars) return false
    }
    return true
  }

  /** @param {(Partial<T> | null)[]} sources */
  #mergeVars (sources) {
    // A null prototype makes assignment behave like spread for __proto__ and
    // inherited setters, without repeatedly copying the growing merged object.
    const merged = Object.create(null)
    for (const vars of sources) Object.assign(merged, vars)
    Object.setPrototypeOf(merged, Object.prototype)
    return /** @type {T} */ (merged)
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
    if (this.#varsCache && this.#varSourcesUnchanged()) return this.#varsCache
    const sources = this.#varSources()

    try {
      this.#varsCache = /** @type {T} */ (Object.freeze(this.#mergeVars(sources)))
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
    this.#pageDataDeps = [...new Set([...pageResolution.dataDeps, ...builderResolution.dataDeps])].sort()
    const dependencies = new Set(this.#pageDataDeps)
    for (const layout of this.layoutChain) {
      const resolution = extractDataDeps(layout.vars, `Layout "${layout.name}"`)
      this.#layoutSubscriptions.set(layout.name, { keys: resolution.dataDeps, data: Object.freeze({}) })
      this.layoutVars.push({ name: layout.name, vars: /** @type {Partial<T>} */ (resolution.vars) })
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

    // First vars access must still observe source changes made after init.
    /** @type {object} */
    const finalVars = this.#mergeVars(this.#varSources())

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
    // Capture source metadata so rebinding the reader cannot change its source.
    const sourceInfo = { ...this.pageInfo, pageFile: { ...this.pageInfo.pageFile } }
    const page = createPageOutputsPage(sourceInfo, async () => {
      if (sourceInfo.type !== 'md') throw new Error('Markdown content can only be read from markdown pages')
      return parseMdFileContents(await readFile(sourceInfo.pageFile.filepath, 'utf8')).markdownContent
    })
    const pageData = this
    /**
     * @param {PageOutputsFunction<T, any>} hook
     * @param {PageOutputProvenance} provenance
     * @param {() => object} getData
     * @returns {AsyncGenerator<CollectedPageOutput, void, unknown>}
     */
    const collect = async function * (hook, provenance, getData) {
      try {
        yield * normalizePageOutputs(hook({ page, vars: pageData.vars, data: getData() }), provenance)
      } catch (cause) {
        const message = `pageOutputs for page "${pageData.pageInfo.pageFile.relname}" from ${provenance.kind} "${provenance.source}" failed: ${cause instanceof Error ? cause.message : String(cause)}`
        throw cause instanceof DomStackDataError
          ? new DomStackDataError(message, cause.dataDependency, { cause })
          : new Error(message, { cause })
      }
    }
    for (const layout of this.layoutChain) {
      const source = layout.source ?? layout.name
      const hook = validatePageOutputsHook(layout.pageOutputs, source)
      if (!hook) continue
      yield * collect(hook, { kind: 'layout', source, layoutName: layout.name }, () => {
        const subscription = this.#layoutSubscriptions.get(layout.name)
        if (!this.#dataReady && subscription?.keys.length) throw this.#dataNotReadyError()
        return subscription?.data ?? Object.freeze({})
      })
    }
    if (this.#pageOutputs) {
      const { hook, provenance } = this.#pageOutputs
      yield * collect(hook, provenance, () => this.data)
    }
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
