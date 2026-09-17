/**
 * @import { SiteData } from '../builder.js'
 * @import { PageBuilderReport, PageReport } from '../build-pages/index.js'
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from '../identify-pages.js'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { WatchSnapshot, WatchEvent } from './plan.js'
 */
import { resolve } from 'node:path'
import { find } from '@11ty/dependency-tree-typescript'
import { isProcessedFile, globalBundleAssets, pageBundleAssets, layoutBundleAssets } from '../file-conventions.js'

/** File dependencies and successful layout selections used for watch routing. */
export class WatchDependencyIndex {
  /** @type {PinoLogger} */ #logger
  /** @type {Map<string, Set<string>>} depFilepath → Set<layoutName> */
  #layoutDepMap = new Map()
  /** @type {Map<string, Set<PageInfo>>} layoutName → Set<PageInfo> */
  #layoutPageMap = new Map()
  /** @type {Map<string, string[]>} source filepath → last successfully rendered layout chain */
  #pageLayoutNamesMap = new Map()
  /** @type {Map<string, PageInfo>} filepath → PageInfo */
  #pageFileMap = new Map()
  /** @type {Map<string, string>} filepath → layoutName */
  #layoutFileMap = new Map()
  /** @type {Map<string, Set<PageInfo>>} depFilepath → Set<PageInfo> */
  #pageDepMap = new Map()
  /** @type {Map<string, Set<TemplateInfo>>} depFilepath → Set<TemplateInfo> */
  #templateDepMap = new Map()
  /** @type {Map<string, Set<PagesFileInfo>>} depFilepath → Set<PagesFileInfo> */
  #pagesFileDepMap = new Map()
  /** @type {Map<string, Set<string>>} *.pages.* filepath → layouts used by its generated pages */
  #pagesFileLayoutMap = new Map()
  /** @type {Set<string>} Imported inputs of global.data, including its entry file. */
  #globalDataDepPaths = new Set()
  /** @type {Set<string>} Settings roots and imports always require a full rebuild. */
  #settingsDepPaths = new Set()
  #dependencyAnalysisFailed = false
  /** @type {Set<string>} Absolute filepaths of esbuild entry points. */
  #esbuildEntryPoints = new Set()
  /** @type {Set<string>} Known browser-only helpers can skip the page phase. */
  #esbuildDepPaths = new Set()

  /** @param {PinoLogger} logger */
  constructor (logger) {
    this.#logger = logger
  }

  /**
   * Routing references are readonly to callers, not deep copies.
   * @returns {Omit<WatchSnapshot, 'siteData' | 'pageBuildFailed'>}
   */
  snapshot () {
    return {
      layoutDepMap: this.#layoutDepMap,
      layoutPageMap: this.#layoutPageMap,
      pageFileMap: this.#pageFileMap,
      layoutFileMap: this.#layoutFileMap,
      pageDepMap: this.#pageDepMap,
      templateDepMap: this.#templateDepMap,
      pagesFileDepMap: this.#pagesFileDepMap,
      pagesFileLayoutMap: this.#pagesFileLayoutMap,
      globalDataDepPaths: this.#globalDataDepPaths,
      settingsDepPaths: this.#settingsDepPaths,
      dependencyAnalysisFailed: this.#dependencyAnalysisFailed,
      esbuildEntryPoints: this.#esbuildEntryPoints,
      esbuildDepPaths: this.#esbuildDepPaths,
    }
  }

  /**
   * @param {WatchEvent[]} events
   * @param {{ pageBuildFailed: boolean }} options
   */
  filterEvents (events, { pageBuildFailed }) {
    // Unknown inputs may be needed to recover after a failed build or analysis.
    if (pageBuildFailed || this.#dependencyAnalysisFailed) return events

    const dependencies = [
      this.#globalDataDepPaths,
      this.#settingsDepPaths,
      this.#layoutDepMap,
      this.#pageDepMap,
      this.#templateDepMap,
      this.#pagesFileDepMap,
      this.#esbuildDepPaths,
    ]
    return events.filter(({ filepath }) =>
      isProcessedFile(filepath) || dependencies.some(paths => paths.has(filepath))
    )
  }

  /**
   * Record layout selections only after a successful build. Rebuild routing maps
   * separately, using the latest discovery data.
   * @param {Pick<PageBuilderReport, 'pages' | 'rebuiltPagesFilePaths'>} report
   * @param {{ filtered: boolean }} options
   */
  recordLayouts (report, { filtered }) {
    if (!filtered) this.#pageLayoutNamesMap.clear()
    for (const page of report.pages) {
      if (page.sourcePageFilePath) this.#pageLayoutNamesMap.set(page.sourcePageFilePath, page.layoutNames)
    }
    if (!filtered) {
      this.#pagesFileLayoutMap = getPagesFileLayoutMap(report.pages)
    } else {
      updatePagesFileLayoutMap(this.#pagesFileLayoutMap, report.rebuiltPagesFilePaths ?? [], report.pages)
    }
  }

  /**
   * Reconstruct routing from discovery and the last successful layout selections.
   * `find()` returns CWD-relative paths; resolve them to absolute map keys.
   * @param {SiteData} siteData
   */
  async rebuild (siteData) {
    const layoutDepMap = /** @type {Map<string, Set<string>>} */ (new Map())
    const layoutPageMap = /** @type {Map<string, Set<PageInfo>>} */ (new Map())
    const pageFileMap = /** @type {Map<string, PageInfo>} */ (new Map())
    const layoutFileMap = /** @type {Map<string, string>} */ (new Map())
    const pageDepMap = /** @type {Map<string, Set<PageInfo>>} */ (new Map())
    const templateDepMap = /** @type {Map<string, Set<TemplateInfo>>} */ (new Map())
    const pagesFileDepMap = /** @type {Map<string, Set<PagesFileInfo>>} */ (new Map())
    const esbuildEntryPoints = /** @type {Set<string>} */ (new Set())
    for (const asset of globalBundleAssets(siteData)) esbuildEntryPoints.add(resolve(asset.filepath))
    if (siteData.serviceWorker) esbuildEntryPoints.add(resolve(siteData.serviceWorker.filepath))
    let dependencyAnalysisFailed = false
    /** @type {Map<string, Promise<string[]>>} */
    const dependencyCache = new Map()
    /** @param {string} filepath */
    const dependenciesFor = filepath => {
      const key = resolve(filepath)
      let dependencies = dependencyCache.get(key)
      if (!dependencies) {
        // Keep failures too, but let each role apply its own recovery and logging policy.
        dependencies = find(filepath).then(deps => deps.map(dep => resolve(dep)))
        dependencyCache.set(key, dependencies)
      }
      return dependencies
    }
    /** @param {...(string | undefined)} filepaths */
    const rootDependencies = async (...filepaths) => {
      const paths = new Set(/** @type {string[]} */ ([]))
      for (const filepath of filepaths) {
        if (!filepath) continue
        paths.add(resolve(filepath))
        try {
          for (const dep of await dependenciesFor(filepath)) paths.add(dep)
        } catch {
          dependencyAnalysisFailed = true
        }
      }
      return paths
    }
    const globalDataDepPaths = await rootDependencies(siteData.globalData?.filepath)
    const settingsDepPaths = await rootDependencies(
      siteData.globalVars?.filepath,
      siteData.markdownItSettings?.filepath,
      siteData.esbuildSettings?.filepath
    )

    const layouts = Object.values(siteData.layouts)
    // Index direct layout files and their imported dependencies together.
    for (const layout of layouts) {
      layoutFileMap.set(layout.filepath, layout.layoutName)
      try {
        for (const absPath of await dependenciesFor(layout.filepath)) {
          if (!layoutDepMap.has(absPath)) layoutDepMap.set(absPath, new Set())
          layoutDepMap.get(absPath)?.add(layout.layoutName)
        }
      } catch {
        dependencyAnalysisFailed = true
      }
    }

    // Use the worker's actual selection, including frontmatter and all ancestors.
    for (const pageInfo of siteData.pages) {
      for (const layoutName of this.#pageLayoutNamesMap.get(pageInfo.pageFile.filepath) ?? []) {
        if (!layoutPageMap.has(layoutName)) layoutPageMap.set(layoutName, new Set())
        layoutPageMap.get(layoutName)?.add(pageInfo)
      }
      pageFileMap.set(pageInfo.pageFile.filepath, pageInfo)
      if (pageInfo.pageVars) pageFileMap.set(pageInfo.pageVars.filepath, pageInfo)
      for (const asset of pageBundleAssets(pageInfo)) esbuildEntryPoints.add(resolve(asset.filepath))

      const filesToTrack = /\.[cm]?[jt]sx?$/.test(pageInfo.pageFile.filepath) ? [pageInfo.pageFile.filepath] : []
      if (pageInfo.pageVars) filesToTrack.push(pageInfo.pageVars.filepath)
      for (const file of filesToTrack) {
        try {
          for (const absPath of await dependenciesFor(file)) {
            if (!pageDepMap.has(absPath)) pageDepMap.set(absPath, new Set())
            pageDepMap.get(absPath)?.add(pageInfo)
          }
        } catch {
          dependencyAnalysisFailed = true
        }
      }
    }

    // templateDepMap: dep filepath → Set<TemplateInfo>
    for (const templateInfo of siteData.templates) {
      try {
        for (const absPath of await dependenciesFor(templateInfo.templateFile.filepath)) {
          if (!templateDepMap.has(absPath)) templateDepMap.set(absPath, new Set())
          templateDepMap.get(absPath)?.add(templateInfo)
        }
      } catch {
        dependencyAnalysisFailed = true
      }
    }

    // pagesFileDepMap: dep filepath → Set<PagesFileInfo>
    for (const pagesFileInfo of siteData.pagesFiles ?? []) {
      try {
        for (const absPath of await dependenciesFor(pagesFileInfo.pagesFile.filepath)) {
          if (!pagesFileDepMap.has(absPath)) pagesFileDepMap.set(absPath, new Set())
          pagesFileDepMap.get(absPath)?.add(pagesFileInfo)
        }
      } catch (err) {
        dependencyAnalysisFailed = true
        const message = err instanceof Error ? err.message : String(err)
        this.#logger.debug(`Could not analyze dependencies for pages file "${pagesFileInfo.pagesFile.relname}": ${message}`)
      }
    }

    for (const layout of layouts) {
      for (const asset of layoutBundleAssets(layout)) esbuildEntryPoints.add(resolve(asset.filepath))
    }

    const esbuildDepPaths = new Set(/** @type {string[]} */ ([]))
    for (const filepath of esbuildEntryPoints) {
      if (!/\.[cm]?[jt]sx?$/.test(filepath)) continue
      try {
        for (const dep of await dependenciesFor(filepath)) esbuildDepPaths.add(dep)
      } catch {
        // Unknown browser helpers still take the conservative reset path.
      }
    }

    this.#layoutDepMap = layoutDepMap
    this.#layoutPageMap = layoutPageMap
    this.#pageFileMap = pageFileMap
    this.#layoutFileMap = layoutFileMap
    this.#pageDepMap = pageDepMap
    this.#templateDepMap = templateDepMap
    this.#pagesFileDepMap = pagesFileDepMap
    this.#globalDataDepPaths = globalDataDepPaths
    this.#settingsDepPaths = settingsDepPaths
    this.#dependencyAnalysisFailed = dependencyAnalysisFailed
    this.#esbuildEntryPoints = esbuildEntryPoints
    this.#esbuildDepPaths = esbuildDepPaths
  }
}

/**
 * Group layouts used by generated pages by their owning *.pages.* filepath.
 * @param {PageReport[]} pageReports
 * @returns {Map<string, Set<string>>}
 */
function getPagesFileLayoutMap (pageReports) {
  /** @type {Map<string, Set<string>>} */
  const layoutsByOwner = new Map()
  for (const report of pageReports) {
    if (!report.pagesFilePath) continue
    const layouts = layoutsByOwner.get(report.pagesFilePath) ?? new Set()
    for (const name of report.layoutNames) layouts.add(name)
    layoutsByOwner.set(report.pagesFilePath, layouts)
  }
  return layoutsByOwner
}

/**
 * Replace layout membership for generated-page owners included in a targeted build.
 * @param {Map<string, Set<string>>} layoutMap
 * @param {string[]} rebuiltOwnerPaths
 * @param {PageReport[]} pageReports
 */
function updatePagesFileLayoutMap (layoutMap, rebuiltOwnerPaths, pageReports) {
  const rebuiltLayouts = getPagesFileLayoutMap(pageReports)
  for (const ownerPath of rebuiltOwnerPaths) {
    const layouts = rebuiltLayouts.get(ownerPath)
    if (layouts?.size) layoutMap.set(ownerPath, layouts)
    else layoutMap.delete(ownerPath)
  }
}
