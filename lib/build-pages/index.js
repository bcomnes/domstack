/**
 * @import { BuilderOptions } from './page-builders/page-writer.js'
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { PageInfo, TemplateInfo } from '../identify-pages.js'
 * @import { ResolvedLayout } from './page-data.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */

import { Worker } from 'worker_threads'
import { join } from 'path'
import pMap from 'p-map'
import { cpus } from 'os'
import { keyBy } from '../helpers/key-by.js'
import { resolveVars, resolveGlobalData } from './resolve-vars.js'
import { pageBuilders, templateBuilder } from './page-builders/index.js'
import { PageData, resolveLayout } from './page-data.js'
import { pageWriter } from './page-builders/page-writer.js'

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

const __dirname = import.meta.dirname

/**
 * @typedef {{
 *   outputs: DomstackManifestRecord[]
 * }} PageBuilderReport
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
 * @typedef {BuildStep<
 *          'page',
 *          PageBuilderReport
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
 */

/**
  * @typedef {Omit<PageBuildStepResult, 'errors'> & { errors: {error: Error, errorData?: WorkerErrorData}[] }} WorkerBuildStepResult
 */

/**
 * Options for filtering which pages/templates to rebuild.
 * Uses arrays (not Sets) so they can be structured-cloned across the worker boundary.
 *
 * @typedef {object} BuildPagesOpts
 * @property {string[] | null} [pageFilterPaths] - If set, only rebuild pages whose pageFile.filepath is in this list.
 * @property {string[] | null} [templateFilterPaths] - If set, only rebuild templates whose templateFile.filepath is in this list.
 */

export { pageBuilders }

/**
 * @param {WorkerErrorData} errorData
 * @returns {{ type: 'page' | 'template', path: string } | null}
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
 * Page builder glue. Most of the magic happens in the builders.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {DomStackOpts & BuildPagesOpts} [opts]
 * @returns {Promise<PageBuildStepResult>}
 */
export function buildPages (src, dest, siteData, opts) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'worker.js'), {
      workerData: { src, dest, siteData, opts },
    })

    worker.once('message', message => {
      /** @type { WorkerBuildStepResult }  */
      const workerReport = message

      /** @type {PageBuildStepResult} */
      const buildReport = {
        type: workerReport.type,
        report: workerReport.report,
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
 * @param {DomStackOpts & BuildPagesOpts} [_opts]
 * @returns {Promise<WorkerBuildStepResult>}
 */
export async function buildPagesDirect (_src, dest, siteData, _opts) {
  /** @type {WorkerBuildStepResult} */
  const result = {
    type: 'page',
    report: {
      outputs: [],
    },
    errors: [],
    warnings: [],
  }

  const pageFilterSet = _opts?.pageFilterPaths ? new Set(_opts.pageFilterPaths) : null
  const templateFilterSet = _opts?.templateFilterPaths ? new Set(_opts.templateFilterPaths) : null

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
    const render = await resolveLayout(layout.filepath)
    return {
      render,
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

  // Mix in resolveVars, renderInnerPage and renderFullPage methods
  const pages = await pMap(siteData.pages, async (pageInfo) => {
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
      result.errors.push({ error: variableResolveError, errorData: { page: pageInfo } })
    }
    return pageData
  }, { concurrency: MAX_CONCURRENCY })

  // Run global.data.js after all pages are initialized — receives fully resolved PageData[]
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

  if (result.errors.length > 0) return result

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
        const outputRecords = await pageWriter({
          dest,
          page,
          pages,
        })

        result.report.outputs.push(...outputRecords)
      } catch (err) {
        const buildError = new Error('Error building page', { cause: err })
        // I can't put stuff on the error, the worker swallows it for some reason.
        result.errors.push({ error: buildError, errorData: { page: page.pageInfo } })
      }
    }, { concurrency: dividedConcurrency[0] }),
    pMap(templatesToRender, async (template) => {
      try {
        const outputRecords = await templateBuilder({
          dest,
          globalVars: templateGlobalVars,
          template,
          pages,
        })

        result.report.outputs.push(...outputRecords)
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
