/**
 * @import { BuilderOptions, PageFunction } from './page-builders/page-writer.js'
 * @import { TemplateReport } from './page-builders/template-builder.js'
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from '../identify-pages.js'
 * @import { ResolvedLayout } from './page-data.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 * @import { WatchDependencyState, WatchConsumer, WatchDependencyTracker } from './watch-dependencies.js'
 */

import { Worker } from 'worker_threads'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path'
import pMap from 'p-map'
import { cpus } from 'os'
import { keyBy } from '../helpers/key-by.js'
import { resolveVars, resolveGlobalData } from './resolve-vars.js'
import { pageBuilders, templateBuilder } from './page-builders/index.js'
import { PageData, resolveLayout } from './page-data.js'
import { resolveLayoutChain } from './resolve-layout-chain.js'
import { pageWriter } from './page-builders/page-writer.js'
import { computePageUrl } from './compute-page-url.js'
import { DomStackOutputConflictError } from '../helpers/domstack-error.js'
import { isAsyncIterable, isPlainObject } from '../helpers/type-guards.js'
import { WatchDependencyTracker as WatchDependencyTrackerClass } from './watch-dependencies.js'

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

const __dirname = import.meta.dirname

/**
 * @typedef {object} PageReport
 * @property {string} pageFilePath
 * @property {string | undefined} [sourcePageFilePath]
 * @property {string | undefined} [pagesFilePath]
 * @property {string | undefined} [layoutName]
 * @property {string[]} layoutNames - Outermost-to-innermost resolved layout chain.
 * @property {DomstackManifestRecord[]} outputs
 */

/**
 * @typedef {object} PageBuilderReport
 * @property {PageReport[]} pages
 * @property {TemplateReport[]} templates
 * @property {WatchDependencyState | undefined} [watchDependencies]
 * @property {string[] | undefined} [rebuiltPagesFilePaths]
 */

/**
 * Parameters passed to a global.data.js default export function.
 * @typedef {object} GlobalDataFunctionParams
 * @property {PageData<any, any, any>[]} pages - Fully initialized source-backed pages, before generated pages are created.
 */

/**
 * Synchronous global.data function. Receives initialized source-backed PageData[] (with .vars, .pageInfo, etc.)
 * and returns an object stamped onto every page's vars before rendering begins.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The shape of the derived vars object returned.
 * @callback GlobalDataFunction
 * @param {GlobalDataFunctionParams} params
 * @returns {T | Promise<T>}
 */

/**
 * Asynchronous global.data function. Receives initialized source-backed PageData[] (with .vars, .pageInfo, etc.)
 * and returns an object stamped onto every page's vars before rendering begins.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The shape of the derived vars object returned.
 * @callback AsyncGlobalDataFunction
 * @param {GlobalDataFunctionParams} params
 * @returns {Promise<T>}
 */

/**
 * Internal options sent to the page worker.
 * Uses arrays (not Sets) so the values can be copied to the worker.
 *
 * @typedef {object} BuildPagesFilterOptions
 * @property {string[] | null | undefined} [pageFilterPaths] - If set, only rebuild pages whose pageFile.filepath is in this list.
 * @property {string[] | null | undefined} [templateFilterPaths] - If set, only rebuild templates whose templateFile.filepath is in this list.
 * @property {string[] | null | undefined} [pagesFileFilterPaths] - If set, only rebuild generated pages owned by these *.pages.* filepaths.
 * @property {boolean | undefined} [buildDrafts] - Include generated page definitions marked as drafts.
 * @property {WatchDependencyState | null | undefined} [previousWatchDependencies] - Dependency state from the previous successful watch build.
 * @property {boolean | undefined} [trackWatchDependencies] - Collect dependency observations for progressive watch builds.
 */

/**
 * Public build options plus the internal filters used by incremental page builds.
 *
 * @typedef {DomStackOpts & BuildPagesFilterOptions} BuildPagesOptions
 */

/**
 * Parameters passed to a *.pages.* default export function.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - Default, global, and global-data vars available to the factory.
 * @typedef {object} PagesFunctionParams
 * @property {PageData<any, any, any>[]} pages - Initialized source-backed pages with global data applied, before generated pages are created.
 * @property {T} vars - Default and global vars plus values returned by global.data.*.
 * @property {PagesFileInfo} pagesFile - Info about the current *.pages.* file.
 * @property {SiteData} siteData - Discovery data from identifyPages(); siteData.pages is source-backed only.
 */

/**
 * Definition for one page produced by a *.pages.* file.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - Vars added to the generated page.
 * @template [U=string] - Static children or the return type of the inline page function.
 * @typedef {object} GeneratedPageDefinition
 * @property {string} [outputName] - Relative output filename, defaulting to `<pages-file-name>/index.html`.
 * @property {T} [vars] - Page vars to merge through the normal page/layout pipeline.
 * @property {U | PageFunction<T, U> | undefined} [children] - Optional static child content or inline render function. Omitted or undefined children render as empty content.
 * @property {boolean} [draft] - When true, only build if buildDrafts is enabled.
 */

/**
 * A generated-pages factory. The same type covers normal functions, async
 * functions, and async generators.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - Vars added to each generated page.
 * @template [U=string] - Static children or the return type of each inline page function.
 * @template {Record<string, any>} [V=Record<string, any>] - Default, global, and global-data vars available to the factory.
 * @callback PagesFunction
 * @param {PagesFunctionParams<V>} params
 * @returns {GeneratedPageDefinition<T, U> | GeneratedPageDefinition<T, U>[] | AsyncIterable<GeneratedPageDefinition<T, U>> | Promise<GeneratedPageDefinition<T, U> | GeneratedPageDefinition<T, U>[] | AsyncIterable<GeneratedPageDefinition<T, U>>>}
 */

/**
 * @typedef {BuildStep<
 *          'page',
 *          PageBuilderReport,
 *          BuildPagesOptions
 *   >} PageBuildStep
 */

/**
 * @typedef {Awaited<ReturnType<PageBuildStep>>} PageBuildStepResult
 */

/**
 * Error metadata sent back from the page build worker.
 * @typedef {object} WorkerErrorData
 * @property {PageInfo | undefined} [page] - Page context for page var/rendering errors.
 * @property {TemplateInfo | undefined} [template] - Template context for template rendering errors.
 * @property {PagesFileInfo | undefined} [pagesFile] - Pages-file context for generated page resolution errors.
 * @property {DomStackOutputConflictError['code'] | undefined} [code] - Stable generated-page conflict error code.
 * @property {DomStackOutputConflictError['conflict'] | undefined} [conflict] - Generated-page conflict details.
 */

/**
  * @typedef {Omit<PageBuildStepResult, 'errors'> & { errors: {error: Error, errorData?: WorkerErrorData}[] }} WorkerBuildStepResult
 */

export { pageBuilders }

/**
 * Remove generated vars and rendering functions before returning page error
 * information from the worker. Concrete PageInfo objects are already copyable.
 *
 * @param {PageInfo} pageInfo
 * @returns {PageInfo}
 */
function pageInfoForWorker (pageInfo) {
  if (!pageInfo.generated) return pageInfo
  return {
    ...pageInfo,
    generated: { pagesFile: pageInfo.generated.pagesFile },
  }
}

/**
 * @param {WorkerErrorData} errorData
 * @returns {{ type: 'page' | 'template' | 'pages file', path: string } | null}
 */
function getWorkerErrorContext (errorData) {
  if (errorData.page) {
    const pagePath = errorData.page.path || errorData.page.url || errorData.page.pageFile.relname
    return { type: 'page', path: pagePath }
  }

  if (errorData.template) {
    const templatePath = errorData.template.path || errorData.template.templateFile.relname
    return { type: 'template', path: templatePath }
  }

  if (errorData.pagesFile) {
    return { type: 'pages file', path: errorData.pagesFile.pagesFile.relname }
  }

  return null
}

/**
 * @param {Error} error
 * @param {WorkerErrorData} errorData
 * @returns {Error}
 */
function restoreWorkerError (error, errorData) {
  const context = getWorkerErrorContext(errorData)
  const message = context
    ? `${error.message} (${context.type}: "${context.path}")`
    : error.message
  const restoredError = new Error(message, { cause: error.cause })
  restoredError.name = error.name

  if (error.stack) {
    restoredError.stack = error.stack.replace(error.message, restoredError.message)
  }

  Object.assign(restoredError, errorData)

  return restoredError
}

/**
 * @param {unknown} value
 * @returns {GeneratedPageDefinition}
 */
function validateGeneratedPageDefinition (value) {
  if (!isPlainObject(value)) {
    throw new TypeError('Generated page definition must be an object')
  }

  if ('outputName' in value && value['outputName'] !== undefined && typeof value['outputName'] !== 'string') {
    throw new TypeError('Generated page outputName must be a string')
  }
  if ('vars' in value && value['vars'] !== undefined && !isPlainObject(value['vars'])) {
    throw new TypeError('Generated page vars must be an object')
  }
  if ('draft' in value && value['draft'] !== undefined && typeof value['draft'] !== 'boolean') {
    throw new TypeError('Generated page draft must be a boolean')
  }

  return /** @type {GeneratedPageDefinition} */ (value)
}

/**
 * @param {unknown} value
 * @returns {Promise<GeneratedPageDefinition[]>}
 */
async function collectGeneratedPageDefinitions (value) {
  if (value == null) return []

  if (Array.isArray(value)) {
    return value.map(validateGeneratedPageDefinition)
  }

  if (isAsyncIterable(value)) {
    /** @type {GeneratedPageDefinition[]} */
    const definitions = []
    for await (const definition of value) {
      definitions.push(validateGeneratedPageDefinition(definition))
    }
    return definitions
  }

  return [validateGeneratedPageDefinition(value)]
}

/**
 * @param {string} value
 * @param {object} opts
 * @param {string} opts.field
 * @param {boolean} [opts.allowEmpty]
 * @returns {string}
 */
function normalizeGeneratedOutputPart (value, { field, allowEmpty = false }) {
  if (typeof value !== 'string') throw new TypeError(`Generated page ${field} must be a string`)
  if (!allowEmpty && value.length === 0) throw new Error(`Generated page ${field} must not be empty`)
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`Generated page ${field} must be relative: ${value}`)
  if (value.split(/[\\/]+/).includes('..')) throw new Error(`Generated page ${field} must not contain ".." segments: ${value}`)
  if (/[\\/]$/.test(value)) throw new Error(`Generated page ${field} must name a file: ${value}`)

  const normalized = normalize(value)
  if (!allowEmpty && normalized === '.') throw new Error(`Generated page ${field} must not be empty`)
  return normalized === '.' ? '' : normalized
}

/**
 * @param {object} params
 * @param {GeneratedPageDefinition} params.definition
 * @param {PagesFileInfo} params.pagesFile
 * @param {number} params.index
 * @returns {PageInfo}
 */
function generatedDefinitionToPageInfo ({ definition, pagesFile, index }) {
  const relativeOutputName = normalizeGeneratedOutputPart(definition.outputName ?? `${pagesFile.name}/index.html`, { field: 'outputName' })
  const outputRelname = join(pagesFile.path, relativeOutputName)
  const generatedPath = dirname(outputRelname) === '.' ? '' : dirname(outputRelname)
  const outputName = basename(outputRelname)

  return {
    pageFile: {
      ...pagesFile.pagesFile,
      basename: `${pagesFile.pagesFile.basename}#${index}`,
      relname: `${pagesFile.pagesFile.relname}#${index}`,
      type: 'js',
    },
    type: 'js',
    path: generatedPath,
    url: computePageUrl({ path: generatedPath, outputName }),
    outputName,
    outputRelname,
    draft: Boolean(definition.draft),
    generated: {
      pagesFile,
      vars: definition.vars ?? {},
      children: definition.children,
    },
  }
}

/**
 * @param {object} params
 * @param {SiteData} params.siteData
 * @param {PageData<any, any, any>[]} params.concretePages
 * @param {Record<string, any>} params.factoryVars
 * @param {boolean | undefined} params.buildDrafts
 * @param {WatchDependencyTracker} params.watchDependencyTracker
 * @returns {Promise<PageInfo[]>}
 */
async function resolveGeneratedPageInfos ({ siteData, concretePages, factoryVars, buildDrafts, watchDependencyTracker }) {
  /** @type {PageInfo[]} */
  const generatedPageInfos = []
  /** @type {Map<string, { type: 'page', path: string }>} */
  const pageOutputClaims = new Map()

  for (const pageInfo of siteData.pages) {
    pageOutputClaims.set(resolve(pageInfo.outputRelname), {
      type: 'page',
      path: pageInfo.pageFile.relname,
    })
  }

  for (const pagesFile of siteData.pagesFiles ?? []) {
    try {
      const importResults = await import(pagesFile.pagesFile.filepath)
      if (!('default' in importResults)) throw new Error(`Missing default export from pages file: ${pagesFile.pagesFile.relname}`)

      const pagesExport = importResults.default
      const pagesResults = await watchDependencyTracker.runWithConsumer(
        'pages-file',
        pagesFile.pagesFile.filepath,
        () => typeof pagesExport === 'function'
          ? pagesExport({
            pages: concretePages,
            vars: factoryVars,
            pagesFile,
            siteData,
          })
          : pagesExport
      )

      const definitions = await collectGeneratedPageDefinitions(pagesResults)

      for (const [index, definition] of definitions.entries()) {
        const generatedPageInfo = generatedDefinitionToPageInfo({ definition, pagesFile, index })
        if (generatedPageInfo.draft && !buildDrafts) continue

        const outputKey = resolve(generatedPageInfo.outputRelname)
        const existingClaim = pageOutputClaims.get(outputKey)
        const generatedClaim = {
          type: /** @type {const} */ ('page'),
          path: generatedPageInfo.pageFile.relname,
        }
        if (existingClaim) {
          throw new DomStackOutputConflictError(
            `Output path conflict: ${generatedPageInfo.outputRelname} is produced by both ${existingClaim.path} and ${generatedClaim.path}.`,
            {
              outputPath: generatedPageInfo.outputRelname,
              a: existingClaim,
              b: generatedClaim,
            }
          )
        }

        pageOutputClaims.set(outputKey, generatedClaim)
        generatedPageInfos.push(generatedPageInfo)
      }
    } catch (err) {
      const error = err instanceof Error
        ? err
        : new Error('Non-error thrown while resolving generated pages', { cause: err })
      Object.assign(error, { pagesFile })
      throw error
    }
  }

  return generatedPageInfos
}

/**
 * Page builder glue. Most of the magic happens in the builders.
 *
 * @type {PageBuildStep}
 */
export function buildPages (src, dest, siteData, opts) {
  // Only page-build filters cross the worker boundary. General build options
  // can contain functions (manifest hooks and predicates) or logger instances,
  // neither of which can be structured-cloned.
  /** @type {BuildPagesFilterOptions} */
  const workerOpts = {
    pageFilterPaths: opts?.pageFilterPaths,
    templateFilterPaths: opts?.templateFilterPaths,
    pagesFileFilterPaths: opts?.pagesFileFilterPaths,
    buildDrafts: opts?.buildDrafts,
    previousWatchDependencies: opts?.previousWatchDependencies,
    trackWatchDependencies: opts?.trackWatchDependencies,
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'worker.js'), {
      workerData: { src, dest, siteData, opts: workerOpts },
    })

    worker.once('message', message => {
      /** @type { WorkerBuildStepResult }  */
      const workerReport = message

      /** @type {PageBuildStepResult} */
      const buildReport = {
        type: workerReport.type,
        report: workerReport.report,
        outputs: workerReport.outputs,
        errors: [],
        warnings: workerReport.warnings ?? [],
      }

      if (workerReport.errors.length > 0) {
        buildReport.errors = workerReport.errors.map(({ error, errorData = {} }) => {
          return restoreWorkerError(error, errorData)
        })
      }
      resolve(buildReport)
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) { reject(new Error(`Worker stopped with exit code ${code}`)) }
    })
  })
}

/**
 * Directly build pages. Normally you run this in a worker.
 * All layouts, variables and page builders need to resolve in here
 * so that it can be run more than once, after the source files change.
 *
 * @param {string} _src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {BuildPagesFilterOptions} [opts]
 * @returns {Promise<WorkerBuildStepResult>}
 */
export async function buildPagesDirect (_src, dest, siteData, opts) {
  /** @type {WorkerBuildStepResult} */
  const result = {
    type: 'page',
    report: {
      pages: [],
      templates: [],
    },
    outputs: [],
    errors: [],
    warnings: [],
  }

  const pageFilterSet = opts?.pageFilterPaths ? new Set(opts.pageFilterPaths) : null
  const templateFilterSet = opts?.templateFilterPaths ? new Set(opts.templateFilterPaths) : null
  const pagesFileFilterSet = opts?.pagesFileFilterPaths ? new Set(opts.pagesFileFilterPaths) : null
  const fullBuild = pageFilterSet === null && templateFilterSet === null && pagesFileFilterSet === null
  const watchDependencyTracker = new WatchDependencyTrackerClass(
    opts?.previousWatchDependencies,
    {
      fullBuild,
      enabled: opts?.trackWatchDependencies === true,
    }
  )

  // Note: markdown-it settings are now passed directly to builders through builderOptions

  const [
    defaultVars,
    bareGlobalVars,
  ] = await Promise.all([
    resolveVars({
      varsPath: join(__dirname, '../defaults/default.vars.js'),
    }),
    resolveVars({
      varsPath: siteData?.globalVars?.filepath,
    }),
  ])

  /** @type {ResolvedLayout<object, any, string>[]} */
  const resolvedLayoutResults = await pMap(Object.values(siteData.layouts), async (layout) => {
    const resolvedLayout = await resolveLayout(layout.filepath)
    return {
      ...resolvedLayout,
      name: layout.layoutName,
      layoutStylePath: layout.layoutStyle ? `/${layout.layoutStyle.outputRelname}` : null,
      layoutClientPath: layout.layoutClient ? `/${layout.layoutClient.outputRelname}` : null,
    }
  }, { concurrency: MAX_CONCURRENCY })

  const resolvedLayouts = keyBy(resolvedLayoutResults, 'name')
  for (const layout of resolvedLayoutResults) resolveLayoutChain(layout.name, resolvedLayouts)

  // Default vars is an internal detail, here we create globalVars that the user sees.
  /** @type {object} */
  const globalVars = {
    ...defaultVars,
    ...(siteData.defaultStyle ? { defaultStyle: true } : {}),
    ...bareGlobalVars,
  }

  // Create builder options from siteData
  /** @type {BuilderOptions} */
  const builderOptions = {
    markdownItSettingsPath: siteData.markdownItSettings?.filepath || null
  }

  /**
   * @param {PageInfo} pageInfo
   */
  const initPageData = async (pageInfo) => {
    const pageData = new PageData({
      pageInfo,
      globalVars,
      globalStyle: siteData?.globalStyle?.outputRelname,
      globalClient: siteData?.globalClient?.outputRelname,
      defaultStyle: siteData?.defaultStyle,
      defaultClient: siteData?.defaultClient,
      builderOptions,
      watchDependencyTracker,
    })
    try {
      // Resolves async vars and binds the page to a reference to its layout fn
      await pageData.init({ layouts: resolvedLayouts })
    } catch (err) {
      if (!(err instanceof Error)) throw new Error('Non-error thrown while resolving vars', { cause: err })
      const variableResolveError = new Error('Error resolving page vars', { cause: { message: err.message, stack: err.stack } })
      // I can't put stuff on the error, the worker swallows it for some reason.
      result.errors.push({ error: variableResolveError, errorData: { page: pageInfoForWorker(pageInfo) } })
    }
    return pageData
  }

  // Mix in resolveVars, renderInnerPage and renderFullPage methods for concrete pages.
  const concretePages = await pMap(siteData.pages, initPageData, { concurrency: MAX_CONCURRENCY })
  const trackedConcretePages = concretePages.map(page => watchDependencyTracker.trackPageData(page))

  if (result.errors.length > 0) return result

  // Derive collection data from source-backed pages before generated-page factories run.
  // This keeps generated pages downstream while making shared data available to them.
  const globalDataVars = await watchDependencyTracker.runWithConsumer(
    'global-data',
    siteData.globalData?.filepath ?? '<none>',
    () => resolveGlobalData({
      globalDataPath: siteData.globalData?.filepath,
      pages: trackedConcretePages,
    })
  )
  const changedGlobalDataKeys = watchDependencyTracker.updateGlobalDataFingerprints(
    globalDataVars,
    opts?.previousWatchDependencies?.globalDataFingerprints
  )

  if (Object.keys(globalDataVars).length > 0) {
    for (const page of concretePages) {
      page.globalDataVars = globalDataVars
    }
  }

  const pagesFactoryVars = watchDependencyTracker.trackGlobalDataVars(
    { ...globalVars, ...globalDataVars },
    globalDataVars
  )

  let generatedPageInfos = /** @type {PageInfo[]} */ ([])
  try {
    generatedPageInfos = await resolveGeneratedPageInfos({
      siteData,
      concretePages: trackedConcretePages,
      factoryVars: pagesFactoryVars,
      buildDrafts: opts?.buildDrafts,
      watchDependencyTracker,
    })
  } catch (err) {
    if (!(err instanceof Error)) throw new Error('Non-error thrown while resolving generated pages', { cause: err })
    const generatedPagesError = new Error(`Error resolving generated pages: ${err.message}`, { cause: { message: err.message, stack: err.stack } })
    generatedPagesError.name = err.name
    const pagesFile = /** @type {PagesFileInfo | undefined} */ ('pagesFile' in err ? err.pagesFile : undefined)
    const outputConflictError = err instanceof DomStackOutputConflictError ? err : undefined
    /** @type {WorkerErrorData} */
    const errorData = {
      pagesFile,
      code: outputConflictError?.code,
      conflict: outputConflictError?.conflict,
    }
    result.errors.push({ error: generatedPagesError, errorData })
  }

  if (result.errors.length > 0) return result

  const generatedPages = await pMap(generatedPageInfos, initPageData, { concurrency: MAX_CONCURRENCY })

  if (Object.keys(globalDataVars).length > 0) {
    for (const page of generatedPages) {
      page.globalDataVars = globalDataVars
    }
  }

  if (result.errors.length > 0) return result

  /** @type {PageData<any, any, any>[]} */
  const allPages = []
  /** @type {PageData<any, any, any>[]} */
  const pagesToWrite = []

  for (const page of concretePages) {
    allPages.push(watchDependencyTracker.trackPageData(page))
    if (!pageFilterSet || pageFilterSet.has(page.pageInfo.pageFile.filepath)) {
      pagesToWrite.push(page)
    }
  }

  for (const page of generatedPages) {
    allPages.push(watchDependencyTracker.trackPageData(page))
    const ownerPath = page.pageInfo.generated?.pagesFile.pagesFile.filepath
    if (!pagesFileFilterSet || (ownerPath && pagesFileFilterSet.has(ownerPath))) {
      pagesToWrite.push(page)
    }
  }

  /** @type {[number, number]} Divided concurrency valus */
  const dividedConcurrency = MAX_CONCURRENCY % 2
    ? [((MAX_CONCURRENCY - 1) / 2) + 1, (MAX_CONCURRENCY - 1) / 2] // odd
    : [MAX_CONCURRENCY / 2, MAX_CONCURRENCY / 2] // even

  // allPages is the complete rendering context. pagesToWrite contains only the
  // source pages and generated-page owners affected by this build.

  const templatesToRender = templateFilterSet
    ? siteData.templates.filter(t => templateFilterSet.has(t.templateFile.filepath))
    : siteData.templates

  if (!fullBuild) {
    const changedPages = new Map(concretePages
      .filter(page => opts?.pageFilterPaths?.includes(page.pageInfo.pageFile.filepath))
      .map(page => [page.pageInfo.pageFile.filepath, page]))
    const changedPageProperties = watchDependencyTracker.getChangedPageProperties(
      opts?.previousWatchDependencies,
      changedPages
    )
    const invalidatedConsumers = watchDependencyTracker.getInvalidatedConsumers(
      opts?.previousWatchDependencies,
      changedPageProperties,
      changedGlobalDataKeys
    )
    applyInvalidatedConsumers({
      consumers: invalidatedConsumers,
      concretePages,
      generatedPages,
      pagesToWrite,
      pageFilterSet,
      templateFilterSet,
      pagesFileFilterSet,
    })
  }

  const finalTemplatesToRender = templateFilterSet
    ? siteData.templates.filter(t => templateFilterSet.has(t.templateFile.filepath))
    : templatesToRender
  if (opts?.trackWatchDependencies) {
    result.report.rebuiltPagesFilePaths = pagesFileFilterSet
      ? Array.from(pagesFileFilterSet)
      : (siteData.pagesFiles ?? []).map(pagesFile => pagesFile.pagesFile.filepath)
  }

  // Merge once — globalVars and globalDataVars are constant for this build.
  const templateGlobalVars = watchDependencyTracker.trackGlobalDataVars(
    { ...globalVars, ...globalDataVars },
    globalDataVars
  )

  await Promise.all([
    pMap(pagesToWrite, async (page) => {
      try {
        const pageConsumerKey = page.pageInfo.generated
          ? page.pageInfo.outputRelname
          : page.pageInfo.pageFile.filepath
        const buildResult = await pageWriter({
          dest,
          page,
          pages: allPages,
          renderFullPage: () => watchDependencyTracker.runWithConsumer(
            'page',
            pageConsumerKey,
            () => page.renderFullPage({ pages: allPages }),
            page.pageInfo.generated
              ? { ownerPath: page.pageInfo.generated.pagesFile.pagesFile.filepath }
              : {}
          ),
        })

        result.report.pages.push({
          pageFilePath: buildResult.pageFilePath,
          sourcePageFilePath: page.pageInfo.generated ? undefined : page.pageInfo.pageFile.filepath,
          pagesFilePath: page.pageInfo.generated?.pagesFile.pagesFile.filepath,
          layoutName: page.layout?.name,
          layoutNames: page.layoutChain.map(layout => layout.name),
          outputs: buildResult.outputs,
        })
        result.outputs.push(...buildResult.outputs)
      } catch (err) {
        const cause = err instanceof Error
          ? { message: err.message, stack: err.stack }
          : { message: `Non-error thrown (${err === null ? 'null' : typeof err})` }
        const buildError = new Error('Error building page', { cause })
        // I can't put stuff on the error, the worker swallows it for some reason.
        result.errors.push({ error: buildError, errorData: { page: pageInfoForWorker(page.pageInfo) } })
      }
    }, { concurrency: dividedConcurrency[0] }),
    pMap(finalTemplatesToRender, async (template) => {
      try {
        const buildResult = await watchDependencyTracker.runWithConsumer(
          'template',
          template.templateFile.filepath,
          () => templateBuilder({
            dest,
            globalVars: templateGlobalVars,
            template,
            pages: allPages,
          })
        )

        result.report.templates.push(buildResult.report)
        result.outputs.push(...buildResult.outputs)
      } catch (err) {
        if (!(err instanceof Error)) throw new Error('Non-error thrown while building pages', { cause: err })
        const buildError = new Error('Error building template', { cause: { message: err.message, stack: err.stack } })
        // I can't put stuff on the error, the worker swallows it for some reason.
        result.errors.push({ error: buildError, errorData: { template } })
      }
    }, { concurrency: dividedConcurrency[1] }),
  ])

  if (opts?.trackWatchDependencies) {
    result.report.watchDependencies = watchDependencyTracker.state
  }
  return result
}

/**
 * Add invalidated consumers to the mutable filters for a targeted build.
 *
 * @param {object} params
 * @param {WatchConsumer[]} params.consumers
 * @param {PageData<any, any, any>[]} params.concretePages
 * @param {PageData<any, any, any>[]} params.generatedPages
 * @param {PageData<any, any, any>[]} params.pagesToWrite
 * @param {Set<string> | null} params.pageFilterSet
 * @param {Set<string> | null} params.templateFilterSet
 * @param {Set<string> | null} params.pagesFileFilterSet
 */
function applyInvalidatedConsumers ({
  consumers,
  concretePages,
  generatedPages,
  pagesToWrite,
  pageFilterSet,
  templateFilterSet,
  pagesFileFilterSet,
}) {
  const queuedPages = new Set(pagesToWrite)

  for (const consumer of consumers) {
    if (consumer.type === 'template') {
      templateFilterSet?.add(consumer.key)
      continue
    }
    if (consumer.type === 'pages-file') {
      pagesFileFilterSet?.add(consumer.key)
      for (const page of generatedPages) {
        if (page.pageInfo.generated?.pagesFile.pagesFile.filepath === consumer.key && !queuedPages.has(page)) {
          pagesToWrite.push(page)
          queuedPages.add(page)
        }
      }
      continue
    }
    if (consumer.type !== 'page') continue

    if (consumer.ownerPath) {
      pagesFileFilterSet?.add(consumer.ownerPath)
      for (const page of generatedPages) {
        if (page.pageInfo.generated?.pagesFile.pagesFile.filepath === consumer.ownerPath && !queuedPages.has(page)) {
          pagesToWrite.push(page)
          queuedPages.add(page)
        }
      }
      continue
    }

    pageFilterSet?.add(consumer.key)
    const page = concretePages.find(candidate => candidate.pageInfo.pageFile.filepath === consumer.key)
    if (page && !queuedPages.has(page)) {
      pagesToWrite.push(page)
      queuedPages.add(page)
    }
  }
}
