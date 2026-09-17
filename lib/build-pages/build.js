/**
 * @import { BuilderOptions } from './outputs/page-writer.js'
 * @import { SiteData } from '../builder.js'
 * @import { PageInfo, PagesFileInfo } from '../identify-pages.js'
 * @import { ResolvedLayout } from './layouts/resolve-layout.js'
 * @import { WatchConsumer } from './global-data/watch-dependencies.js'
 * @import { BuildPagesFilterOptions, WorkerBuildStepResult } from './worker/protocol.js'
 */

import { join, resolve } from 'path'
import pMap from 'p-map'
import { cpus } from 'os'
import { keyBy } from '../helpers/key-by.js'
import { resolveVars } from './vars/resolve-vars.js'
import { resolveGlobalData } from './global-data/resolve-global-data.js'
import { templateBuilder } from './templates/template-builder.js'
import { PageData } from './page/page-data.js'
import { resolveLayout } from './layouts/resolve-layout.js'
import { resolveLayoutChain } from './layouts/resolve-layout-chain.js'
import { pageWriter } from './outputs/page-writer.js'
import { DomStackDataError } from '../helpers/domstack-error.js'
import { WatchDependencyTracker as WatchDependencyTrackerClass } from './global-data/watch-dependencies.js'
import { outputWarnings } from '../helpers/output-warnings.js'
import { createGlobalDataState } from './global-data/global-data-state.js'
import { resolveGeneratedPageInfos } from './generated-pages/index.js'
import { pageInfoForWorker, serializeBuildError } from './worker/protocol.js'

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

const __dirname = import.meta.dirname

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

  const outputCache = opts?.trackWatchDependencies ? new Map(opts.previousPageOutputCache) : undefined
  result.report.pageOutputCache = outputCache

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
  if (Object.hasOwn(globalVars, 'dataDeps')) {
    throw new DomStackDataError('dataDeps is page and layout metadata and cannot be declared in global vars', {
      reason: 'INVALID_DECLARATION', consumer: 'Global vars',
    })
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
      result.errors.push(serializeBuildError(err, { page: pageInfoForWorker(pageInfo) }, 'Error resolving page vars'))
    }
    result.warnings.push(...pageData.warnings)
    return pageData
  }

  // Mix in resolveVars, renderInnerPage and renderFullPage methods for concrete pages.
  const concretePages = await pMap(siteData.pages, pageInfo => {
    const filepath = resolve(pageInfo.pageFile.filepath)
    return initPageData(filepath === pageInfo.pageFile.filepath
      ? pageInfo
      : { ...pageInfo, pageFile: { ...pageInfo.pageFile, filepath } })
  }, { concurrency: MAX_CONCURRENCY })

  if (result.errors.length > 0) return result

  // Derive collection data from source-backed pages before generated-page factories run.
  // This keeps generated pages downstream while making shared data available to them.
  const globalDataState = siteData.globalData
    ? createGlobalDataState({
      pages: concretePages,
      previousGlobalDataBaseline: opts?.previousGlobalDataBaseline,
      globalDataInputChanges: opts?.globalDataInputChanges,
    })
    : null
  const globalData = /** @type {Record<string, unknown>} */ (globalDataState
    ? await resolveGlobalData({
      globalDataPath: siteData.globalData?.filepath,
      context: globalDataState.context,
    })
    : {})
  const changedGlobalDataKeys = watchDependencyTracker.updateGlobalDataFingerprints(
    globalData,
    opts?.previousWatchDependencies?.globalDataFingerprints
  )

  for (const page of concretePages) {
    page.setGlobalData(globalData)
    watchDependencyTracker.registerConsumer(
      'page',
      page.pageInfo.pageFile.filepath,
      page.dataDeps
    )
  }

  if (!fullBuild) {
    applyInvalidatedConsumerFilters({
      consumers: watchDependencyTracker.getInvalidatedConsumers(
        opts?.previousWatchDependencies,
        changedGlobalDataKeys
      ),
      pageFilterSet,
      templateFilterSet,
      pagesFileFilterSet,
    })
  }

  const pagesToWrite = pageFilterSet
    ? concretePages.filter(page => pageFilterSet.has(page.pageInfo.pageFile.filepath))
    : concretePages

  /** @type {[number, number]} Divided concurrency values */
  const dividedConcurrency = MAX_CONCURRENCY % 2
    ? [((MAX_CONCURRENCY - 1) / 2) + 1, (MAX_CONCURRENCY - 1) / 2] // odd
    : [MAX_CONCURRENCY / 2, MAX_CONCURRENCY / 2] // even

  const templatesToRender = templateFilterSet
    ? siteData.templates.filter(t => templateFilterSet.has(t.templateFile.filepath))
    : siteData.templates
  if (opts?.trackWatchDependencies) {
    result.report.rebuiltPagesFilePaths = pagesFileFilterSet
      ? Array.from(pagesFileFilterSet)
      : (siteData.pagesFiles ?? []).map(pagesFile => pagesFile.pagesFile.filepath)
  }

  /** @param {PageData<any, any, any, any>} page */
  const writePage = async (page) => {
    try {
      const buildResult = await pageWriter({
        dest,
        page,
        outputCache,
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
      return true
    } catch (err) {
      // Direct writes already emitted by a failed iterator still need ownership
      // so a later successful watch rebuild can remove them.
      if (page.outputRecords.length > 0) {
        result.report.pages.push({
          pageFilePath: join(dest, page.pageInfo.outputRelname),
          sourcePageFilePath: page.pageInfo.generated ? undefined : page.pageInfo.pageFile.filepath,
          pagesFilePath: page.pageInfo.generated?.pagesFile.pagesFile.filepath,
          layoutName: page.layout?.name,
          layoutNames: page.layoutChain.map(layout => layout.name),
          outputs: page.outputRecords,
        })
        result.outputs.push(...page.outputRecords)
      }
      result.errors.push(serializeBuildError(err, { page: pageInfoForWorker(page.pageInfo) }, `Error building page "${page.pageInfo.pageFile.relname}"`))
      return false
    }
  }

  // Keep output names for dependency pruning, not generated definitions or PageData instances.
  const generatedOutputRelnames = new Set()
  const writeGeneratedPages = async () => {
    try {
      for await (const pageInfo of resolveGeneratedPageInfos({
        siteData,
        factoryVars: globalVars,
        globalData,
        pagesFileFilterSet,
        buildDrafts: opts?.buildDrafts,
        watchDependencyTracker,
      })) {
        const errorCount = result.errors.length
        const page = await initPageData(pageInfo)
        if (result.errors.length > errorCount) break
        page.setGlobalData(globalData)
        watchDependencyTracker.registerConsumer(
          'page',
          pageInfo.outputRelname,
          page.dataDeps,
          { ownerPath: pageInfo.pageFile.filepath }
        )
        if (!await writePage(page)) break
        generatedOutputRelnames.add(pageInfo.outputRelname)
      }
    } catch (err) {
      const pagesFile = /** @type {PagesFileInfo | undefined} */ (err instanceof Error && 'pagesFile' in err ? err.pagesFile : undefined)
      result.errors.push(serializeBuildError(err, { pagesFile }, `Error building generated pages: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  await Promise.all([
    pMap(pagesToWrite, writePage, { concurrency: dividedConcurrency[0] }),
    writeGeneratedPages(),
    pMap(templatesToRender, async (template) => {
      try {
        const buildResult = await templateBuilder({
          dest,
          globalVars,
          globalData,
          template,
          watchDependencyTracker,
        })

        result.report.templates.push(buildResult.report)
        result.outputs.push(...buildResult.outputs)
      } catch (err) {
        result.errors.push(serializeBuildError(err, { template }, 'Error building template'))
      }
    }, { concurrency: dividedConcurrency[1] }),
  ])

  if (opts?.trackWatchDependencies) {
    result.warnings.push(...outputWarnings(result.outputs))
    watchDependencyTracker.pruneGeneratedPages(
      generatedOutputRelnames,
      pagesFileFilterSet
    )
    result.report.watchDependencies = watchDependencyTracker.state
  }
  if (opts?.trackWatchDependencies && result.errors.length === 0 && globalDataState) {
    result.report.globalDataBaseline = globalDataState.getBaseline()
  }
  return result
}

/**
 * Add invalidated consumers to the mutable filters for a targeted build.
 *
 * @param {object} params
 * @param {WatchConsumer[]} params.consumers
 * @param {Set<string> | null} params.pageFilterSet
 * @param {Set<string> | null} params.templateFilterSet
 * @param {Set<string> | null} params.pagesFileFilterSet
 */
function applyInvalidatedConsumerFilters ({
  consumers,
  pageFilterSet,
  templateFilterSet,
  pagesFileFilterSet,
}) {
  for (const consumer of consumers) {
    if (consumer.type === 'template') {
      templateFilterSet?.add(consumer.key)
      continue
    }
    if (consumer.type === 'pages-file') {
      pagesFileFilterSet?.add(consumer.key)
      continue
    }
    if (consumer.type !== 'page') continue

    if (consumer.ownerPath) {
      pagesFileFilterSet?.add(consumer.ownerPath)
      continue
    }

    pageFilterSet?.add(consumer.key)
  }
}
