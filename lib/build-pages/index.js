/**
 * @import { BuilderOptions, PageFunction } from './page-builders/page-writer.js'
 * @import { TemplateReport } from './page-builders/template-builder.js'
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from '../identify-pages.js'
 * @import { ResolvedLayout } from './page-data.js'
 */

import { Worker } from 'worker_threads'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path'
import pMap from 'p-map'
import { cpus } from 'os'
import { keyBy } from '../helpers/key-by.js'
import { resolveVars, resolveGlobalData } from './resolve-vars.js'
import { pageBuilders, templateBuilder } from './page-builders/index.js'
import { PageData, resolveLayout } from './page-data.js'
import { pageWriter } from './page-builders/page-writer.js'
import { computePageUrl } from './compute-page-url.js'
import { DomStackOutputConflictError } from '../helpers/domstack-error.js'
import { isAsyncIterable, isPlainObject } from '../helpers/type-guards.js'

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

const __dirname = import.meta.dirname

/**
 * @typedef {object} PageBuilderReport
 * @property {{ pageFilePath: string }[]} pages
 * @property {TemplateReport[]} templates
 */

/**
 * Parameters passed to a global.data.js default export function.
 * @typedef {object} GlobalDataFunctionParams
 * @property {PageData<any, any, any>[]} pages - Fully initialized PageData instances for all pages.
 */

/**
 * Synchronous global.data function. Receives initialized PageData[] (with .vars, .pageInfo, etc.)
 * and returns an object stamped onto every page's vars before rendering begins.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The shape of the derived vars object returned.
 * @callback GlobalDataFunction
 * @param {GlobalDataFunctionParams} params
 * @returns {T | Promise<T>}
 */

/**
 * Asynchronous global.data function. Receives initialized PageData[] (with .vars, .pageInfo, etc.)
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
 * @property {string[] | null} [pageFilterPaths] - If set, only rebuild pages whose pageFile.filepath is in this list.
 * @property {string[] | null} [templateFilterPaths] - If set, only rebuild templates whose templateFile.filepath is in this list.
 * @property {boolean | undefined} [buildDrafts] - Include generated page definitions marked as drafts.
 */

/**
 * Public build options plus the internal filters used by incremental page builds.
 *
 * @typedef {DomStackOpts & BuildPagesFilterOptions} BuildPagesOptions
 */

/**
 * Parameters passed to a *.pages.* default export function.
 *
 * @typedef {object} PagesFunctionParams
 * @property {PageData<any, any, any>[]} pages - Initialized concrete/source-backed pages only.
 * @property {Record<string, any>} vars - Default and global vars, before global.data.* output.
 * @property {PagesFileInfo} pagesFile - Info about the current *.pages.* file.
 * @property {SiteData} siteData - Site data from identifyPages().
 */

/**
 * Definition for one page produced by a *.pages.* file.
 *
 * @template {Record<string, any>} [T=Record<string, any>]
 * @template [U=any]
 * @typedef {object} GeneratedPageDefinition
 * @property {string} [outputName] - Relative output filename, defaulting to `<pages-file-name>/index.html`.
 * @property {T} [vars] - Page vars to merge through the normal page/layout pipeline.
 * @property {U | PageFunction<T, U>} [children] - Static child content or inline render function.
 * @property {boolean} [draft] - When true, only build if buildDrafts is enabled.
 */

/**
 * Synchronous generated-pages function.
 *
 * @template {Record<string, any>} [T=Record<string, any>]
 * @template [U=any]
 * @callback PagesFunction
 * @param {PagesFunctionParams} params
 * @returns {GeneratedPageDefinition<T, U> | GeneratedPageDefinition<T, U>[] | AsyncIterable<GeneratedPageDefinition<T, U>> | Promise<GeneratedPageDefinition<T, U> | GeneratedPageDefinition<T, U>[] | AsyncIterable<GeneratedPageDefinition<T, U>>>}
 */

/**
 * Asynchronous generated-pages function.
 *
 * @template {Record<string, any>} [T=Record<string, any>]
 * @template [U=any]
 * @callback AsyncPagesFunction
 * @param {PagesFunctionParams} params
 * @returns {Promise<GeneratedPageDefinition<T, U> | GeneratedPageDefinition<T, U>[] | AsyncIterable<GeneratedPageDefinition<T, U>>>}
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
 * @property {PageInfo} [page] - Page context for page var/rendering errors.
 * @property {TemplateInfo} [template] - Template context for template rendering errors.
 * @property {PagesFileInfo} [pagesFile] - Pages-file context for generated page resolution errors.
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

  const normalized = normalize(value)
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
 * @param {Record<string, any>} params.globalVars
 * @param {boolean | undefined} params.buildDrafts
 * @returns {Promise<PageInfo[]>}
 */
async function resolveGeneratedPageInfos ({ siteData, concretePages, globalVars, buildDrafts }) {
  /** @type {PageInfo[]} */
  const generatedPageInfos = []
  /** @type {Map<string, { type: 'page', path: string }>} */
  const pageOutputClaims = new Map()

  for (const pageInfo of siteData.pages) {
    pageOutputClaims.set(resolve(pageInfo.outputRelname), {
      type: 'page',
      path: pageInfo.outputRelname,
    })
  }

  for (const pagesFile of siteData.pagesFiles ?? []) {
    const importResults = await import(pagesFile.pagesFile.filepath)
    if (!('default' in importResults)) throw new Error(`Missing default export from pages file: ${pagesFile.pagesFile.relname}`)

    const pagesExport = importResults.default
    const pagesResults = typeof pagesExport === 'function'
      ? await pagesExport({
        pages: concretePages,
        vars: globalVars,
        pagesFile,
        siteData,
      })
      : pagesExport

    const definitions = await collectGeneratedPageDefinitions(pagesResults)

    for (const [index, definition] of definitions.entries()) {
      const generatedPageInfo = generatedDefinitionToPageInfo({ definition, pagesFile, index })
      if (generatedPageInfo.draft && !buildDrafts) continue

      const outputKey = resolve(generatedPageInfo.outputRelname)
      const existingClaim = pageOutputClaims.get(outputKey)
      if (existingClaim) {
        throw new DomStackOutputConflictError(
          `Output path conflict: ${generatedPageInfo.outputRelname} is produced by both ${existingClaim.path} and ${pagesFile.pagesFile.relname}.`,
          {
            outputPath: generatedPageInfo.outputRelname,
            a: existingClaim,
            b: {
              type: 'page',
              path: pagesFile.pagesFile.relname,
            },
          }
        )
      }

      pageOutputClaims.set(outputKey, {
        type: 'page',
        path: generatedPageInfo.outputRelname,
      })
      generatedPageInfos.push(generatedPageInfo)
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
    ...(opts?.pageFilterPaths !== undefined ? { pageFilterPaths: opts.pageFilterPaths } : {}),
    ...(opts?.templateFilterPaths !== undefined ? { templateFilterPaths: opts.templateFilterPaths } : {}),
    ...(opts?.buildDrafts !== undefined ? { buildDrafts: opts.buildDrafts } : {}),
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
      render: resolvedLayout.render,
      vars: resolvedLayout.vars,
      name: layout.layoutName,
      layoutStylePath: layout.layoutStyle ? `/${layout.layoutStyle.outputRelname}` : null,
      layoutClientPath: layout.layoutClient ? `/${layout.layoutClient.outputRelname}` : null,
    }
  }, { concurrency: MAX_CONCURRENCY })

  const resolvedLayouts = keyBy(resolvedLayoutResults, 'name')

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

  if (result.errors.length > 0) return result

  let generatedPageInfos = /** @type {PageInfo[]} */ ([])
  try {
    generatedPageInfos = await resolveGeneratedPageInfos({
      siteData,
      concretePages,
      globalVars,
      buildDrafts: opts?.buildDrafts,
    })
  } catch (err) {
    if (!(err instanceof Error)) throw new Error('Non-error thrown while resolving generated pages', { cause: err })
    const generatedPagesError = new Error(`Error resolving generated pages: ${err.message}`, { cause: { message: err.message, stack: err.stack } })
    result.errors.push({ error: generatedPagesError })
  }

  if (result.errors.length > 0) return result

  const generatedPages = await pMap(generatedPageInfos, initPageData, { concurrency: MAX_CONCURRENCY })
  const pages = [...concretePages, ...generatedPages]

  if (result.errors.length > 0) return result

  // Run global.data.js after concrete and generated pages are initialized — receives fully resolved PageData[]
  // so it can filter/sort by page.vars.layout, page.vars.publishDate, etc.
  const globalDataVars = await resolveGlobalData({
    globalDataPath: siteData.globalData?.filepath,
    pages,
  })

  // Stamp globalDataVars onto each page so they appear in page.vars at render time.
  if (Object.keys(globalDataVars).length > 0) {
    for (const page of pages) {
      page.globalDataVars = globalDataVars
    }
  }

  /** @type {[number, number]} Divided concurrency valus */
  const dividedConcurrency = MAX_CONCURRENCY % 2
    ? [((MAX_CONCURRENCY - 1) / 2) + 1, (MAX_CONCURRENCY - 1) / 2] // odd
    : [MAX_CONCURRENCY / 2, MAX_CONCURRENCY / 2] // even

  // Filter to only requested pages/templates when a filter is active.
  const pagesToRender = pageFilterSet
    ? pages.filter(p => pageFilterSet.has(p.pageInfo.pageFile.filepath))
    : pages

  const templatesToRender = templateFilterSet
    ? siteData.templates.filter(t => templateFilterSet.has(t.templateFile.filepath))
    : siteData.templates

  // Merge once — globalVars and globalDataVars are constant for this build.
  const templateGlobalVars = { ...globalVars, ...globalDataVars }

  await Promise.all([
    pMap(pagesToRender, async (page) => {
      try {
        const buildResult = await pageWriter({
          dest,
          page,
          pages,
        })

        result.report.pages.push({ pageFilePath: buildResult.pageFilePath })
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
    pMap(templatesToRender, async (template) => {
      try {
        const buildResult = await templateBuilder({
          dest,
          globalVars: templateGlobalVars,
          template,
          pages,
        })

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

  return result
}
