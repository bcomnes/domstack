/**
 * @import { PageFunction } from './outputs/page-writer.js'
 * @import { TemplateReport } from './templates/template-builder.js'
 * @import { BuildStep, DomStackOpts } from '../builder.js'
 * @import { PagesFileInfo } from '../identify-pages.js'
 * @import { PageData } from './page/page-data.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 * @import { WatchDependencyState } from './global-data/watch-dependencies.js'
 * @import { PageOutputCache } from './outputs/page-output-writer.js'
 * @import { GlobalDataBaseline, GlobalDataChanges } from './global-data/global-data-state.js'
 * @import { BuildPagesFilterOptions as WorkerBuildPagesFilterOptions, WorkerErrorData as ProtocolWorkerErrorData, WorkerBuildStepResult as ProtocolWorkerBuildStepResult } from './worker/protocol.js'
 */

export { buildPages } from './worker/index.js'
export { buildPagesDirect } from './build.js'
export { serializeBuildError } from './worker/protocol.js'
export { pageBuilders } from './page-builders/index.js'

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
 * @property {PageOutputCache | undefined} [pageOutputCache]
 * @property {string[] | undefined} [rebuiltPagesFilePaths]
 * @property {GlobalDataBaseline | undefined} [globalDataBaseline] - Candidate state and membership, emitted only after a successful page phase.
 */

/**
 * Parameters passed to a global.data.js default export function.
 * @template {Record<string, any>} [T=any] - Source-page vars.
 * @template [U=any] - Source-page render values.
 * @template [S=unknown] - Explicitly retained, structured-cloneable state.
 * @typedef {object} GlobalDataFunctionParams
 * @property {PageData<T, U, any, any>[]} pages - Fully initialized source-backed pages, before generated pages are created. Use page.sourceId (a source-relative path with POSIX separators) as the index key, matching changes.removed.
 * @property {S | undefined} previousState - Isolated state from the last successful build, or undefined on reset.
 * @property {GlobalDataChanges<T, U>} changes - Reset information or source-page input deltas, independent of output filters.
 * @property {(next: S) => void} setState - Immediately snapshot state for the next successful build. Mutating previousState alone does not commit changes.
 */

/**
 * Sync or async global.data function. Receives initialized source-backed PageData[] (with .vars, .pageInfo, etc.)
 * and returns named values that consumers may subscribe to.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The shape of the derived vars object returned.
 * @template {Record<string, any>} [V=any] - Source-page vars.
 * @template [U=any] - Source-page render values.
 * @template [S=unknown] - Explicitly retained, structured-cloneable state.
 * @callback GlobalDataFunction
 * @param {GlobalDataFunctionParams<V, U, S>} params
 * @returns {T | Promise<T>}
 */

/**
 * Asynchronous global.data function. Receives initialized source-backed PageData[] (with .vars, .pageInfo, etc.)
 * and returns named values that consumers may subscribe to.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - The shape of the derived vars object returned.
 * @template {Record<string, any>} [V=any] - Source-page vars.
 * @template [U=any] - Source-page render values.
 * @template [S=unknown] - Explicitly retained, structured-cloneable state.
 * @callback AsyncGlobalDataFunction
 * @param {GlobalDataFunctionParams<V, U, S>} params
 * @returns {Promise<T>}
 */

/**
 * @typedef {WorkerBuildPagesFilterOptions} BuildPagesFilterOptions
 */

/**
 * Public build options plus the internal filters used by incremental page builds.
 *
 * @typedef {DomStackOpts & BuildPagesFilterOptions} BuildPagesOptions
 */

/**
 * Parameters passed to a *.pages.* default export function.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - Default and global vars available to the factory.
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef {object} PagesFunctionParams
 * @property {T} vars - Default and global vars.
 * @property {D} data - Global data declared by the factory.
 * @property {PagesFileInfo} pagesFile - Info about the current *.pages.* file.
 */

/**
 * Definition for one page produced by a *.pages.* file.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - Vars added to the generated page.
 * @template [U=string] - Static children or the return type of the inline page function.
 * @template {object} [D=Record<string, unknown>] - Declared global data for an inline page function.
 * @typedef {object} GeneratedPageDefinition
 * @property {string} [outputName] - Relative output filename, defaulting to `<pages-file-name>/index.html`.
 * @property {T} [vars] - Page vars to merge through the normal page/layout pipeline.
 * @property {U | PageFunction<T, U, D> | undefined} [children] - Optional static child content or inline render function. Omitted or undefined children render as empty content.
 * @property {boolean} [draft] - When true, only build if buildDrafts is enabled.
 */

/**
 * A generated-pages factory. The same type covers normal functions, async
 * functions, and async generators.
 *
 * @template {Record<string, any>} [T=Record<string, any>] - Vars added to each generated page.
 * @template [U=string] - Static children or the return type of each inline page function.
 * @template {Record<string, any>} [V=Record<string, any>] - Default and global vars available to the factory.
 * @template {object} [D=Record<string, unknown>] - Factory's declared global data.
 * @template {object} [P=D] - Inline pages' declared global data, independent of the factory.
 * @callback PagesFunction
 * @param {PagesFunctionParams<V, D>} params
 * @returns {PagesFunctionResult<T, U, P> | Promise<PagesFunctionResult<T, U, P>>}
 */

/**
 * @template {Record<string, any>} T
 * @template U
 * @template {object} D
 * @typedef {GeneratedPageDefinition<T, U, D> | GeneratedPageDefinition<T, U, D>[] | AsyncIterable<GeneratedPageDefinition<T, U, D>> | null | undefined} PagesFunctionResult
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
 * @typedef {ProtocolWorkerErrorData} WorkerErrorData
 * @typedef {ProtocolWorkerBuildStepResult} WorkerBuildStepResult
 */
