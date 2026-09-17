/**
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from '../../identify-pages.js'
 * @import { PageBuildStepResult } from '../index.js'
 * @import { WatchDependencyState } from '../global-data/watch-dependencies.js'
 * @import { PageOutputCache } from '../outputs/page-output-writer.js'
 * @import { GlobalDataBaseline, GlobalDataInputChanges } from '../global-data/global-data-state.js'
 */

import { DomStackDataError, DomStackOutputConflictError } from '../../helpers/domstack-error.js'

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
 * @property {boolean | undefined} [trackWatchDependencies] - Collect subscriptions for incremental watch builds.
 * @property {PageOutputCache | undefined} [previousPageOutputCache] - Successful output hashes and metadata retained across watch workers.
 * @property {GlobalDataBaseline | null | undefined} [previousGlobalDataBaseline]
 * @property {GlobalDataInputChanges | undefined} [globalDataInputChanges]
 */

/**
 * Error metadata sent back from the page build worker.
 * @typedef {object} WorkerErrorData
 * @property {PageInfo | undefined} [page] - Page context for page var/rendering errors.
 * @property {TemplateInfo | undefined} [template] - Template context for template rendering errors.
 * @property {PagesFileInfo | undefined} [pagesFile] - Pages-file context for generated page resolution errors.
 * @property {DomStackOutputConflictError['code'] | DomStackDataError['code'] | undefined} [code] - Stable domain error code.
 * @property {DomStackOutputConflictError['conflict'] | undefined} [conflict] - Generated-page conflict details.
 * @property {DomStackDataError['dataDependency'] | undefined} [dataDependency] - Subscription error details.
 */

/**
 * @typedef {Omit<PageBuildStepResult, 'errors'> & { errors: {error: Error, errorData?: WorkerErrorData}[] }} WorkerBuildStepResult
 */

/**
 * Remove generated vars and rendering functions before returning page error
 * information from the worker. Concrete PageInfo objects are already copyable.
 *
 * @param {PageInfo} pageInfo
 * @returns {PageInfo}
 */
export function pageInfoForWorker (pageInfo) {
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
export function restoreWorkerError (error, errorData) {
  const context = getWorkerErrorContext(errorData)
  const message = context
    ? `${error.message} (${context.type}: "${context.path}")`
    : error.message
  const restoredError = errorData.dataDependency
    ? new DomStackDataError(message, errorData.dataDependency, { cause: error.cause })
    : new Error(message, { cause: error.cause })
  if (!(restoredError instanceof DomStackDataError)) restoredError.name = error.name

  if (error.stack) {
    restoredError.stack = error.stack.replace(error.message, restoredError.message)
  }

  const { code, ...contextData } = errorData
  Object.assign(restoredError, contextData)
  if (!(restoredError instanceof DomStackDataError) && code) Object.assign(restoredError, { code })

  return restoredError
}

/**
 * Preserve domain metadata separately because worker cloning strips Error fields.
 * @param {unknown} err
 * @param {WorkerErrorData} [context]
 * @param {string} [message]
 * @returns {WorkerBuildStepResult['errors'][number]}
 */
export function serializeBuildError (err, context = {}, message) {
  const error = err instanceof Error ? err : new Error('Non-error thrown during page build', { cause: err })
  const errorData = { ...context }
  if (error instanceof DomStackDataError) {
    errorData.code = error.code
    errorData.dataDependency = error.dataDependency
  } else if (error instanceof DomStackOutputConflictError) {
    errorData.code = error.code
    errorData.conflict = error.conflict
  }
  const reportedError = message && !errorData.code
    ? new Error(message, { cause: { message: error.message, stack: error.stack } })
    : error
  reportedError.name = error.name
  return { error: reportedError, errorData }
}
