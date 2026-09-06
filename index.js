/// <reference path="./types/thread-stream.d.ts" preserve="true" />

/**
 * @import { DomStackOpts, Results, SiteData } from './lib/builder.js'
 * @import { Stats } from 'node:fs'
 * @import { FSWatcher } from 'chokidar'
 * @import { WorkerBuildStepResult } from './lib/build-pages/index.js'
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from './lib/identify-pages.js'
 * @import { TestBuildResult } from './types.js'
 * @import { BsInstance } from '@domstack/sync'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { DomstackManifestRecord } from './lib/domstack-manifest/index.js'
 * @import { WatchDependencyState } from './lib/build-pages/watch-dependencies.js'
 * @typedef {{ dispose: () => Promise<void> }} DisposableBuildContext
 * @typedef {{ pageFilePath: string, sourcePageFilePath?: string | undefined, pagesFilePath?: string | undefined, layoutNames: string[], outputs?: DomstackManifestRecord[] | undefined }} WatchedPageReport
 */
import { once } from 'events'
import assert from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import chokidar from 'chokidar'
import { basename, dirname, join, relative, resolve } from 'node:path'
// @ts-expect-error
import makeArray from 'make-array'
import ignore from 'ignore'
import { watch as cpxWatch } from 'cpx2'
import { inspect } from 'util'
import { createServer } from '@domstack/sync'
import { find } from '@11ty/dependency-tree-typescript'

import { assertInsideDest } from './lib/helpers/path.js'
import { getCopyGlob } from './lib/build-static/index.js'
import { getCopyDirs } from './lib/build-copy/index.js'
import { builder } from './lib/builder.js'
import { buildEsbuildWatch } from './lib/build-esbuild/index.js'
import { buildPages } from './lib/build-pages/index.js'
import {
  identifyPages,
  layoutStyleSuffix,
  globalVarsNames,
  esbuildSettingsNames,
  markdownItSettingsNames,
  domstackManifestSettingsNames,
  pageClientNames,
  layoutClientSuffixs,
  globalClientNames,
  globalStyleNames,
  pageStyleName,
  pageWorkerSuffixs,
  serviceWorkerNames,
} from './lib/identify-pages.js'
import { ensureDest } from './lib/helpers/ensure-dest.js'
import { DomStackAggregateError } from './lib/helpers/domstack-aggregate-error.js'
import { createDomStackLogger } from './lib/logger.js'

export { PageData } from './lib/build-pages/page-data.js'
export {
  DOMSTACK_MANIFEST_SCHEMA_ID,
  DOMSTACK_MANIFEST_SCHEMA_PATH,
  domstackManifestEntryPageMetaSchema,
  domstackManifestEntrySchema,
  domstackManifestKindSchema,
  domstackManifestSchema,
  getDomstackManifestSchemaId,
  reconcileDomstackManifest,
} from './lib/domstack-manifest/index.js'

const DEFAULT_IGNORES = /** @type {const} */ ([
  '.*',
  'coverage',
  'node_modules',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])

export class DomStack {
  /** @type {string} */ #src = ''
  /** @type {string} */ #dest = ''
  /** @type {Readonly<DomStackOpts>} */ opts
  /** @type {FSWatcher?} */ #watcher = null
  /** @type {any[]?} */ #cpxWatchers = null
  /** @type {BsInstance?} */ #syncServer = null
  /** @type {DisposableBuildContext?} */ #esbuildContext = null
  /** @type {SiteData?} */ #siteData = null
  /** @type {PinoLogger} */ #logger

  // Watch maps (rebuilt after every full rebuild)
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
  /** @type {Set<string>} Imported inputs of global.data, including its entry file. */
  #globalDataDepPaths = new Set()
  /** @type {Set<string>} absolute filepaths of esbuild entry points */
  #esbuildEntryPoints = new Set()
  /** @type {Set<string>} destination-relative outputs from the last successful page builds */
  #pageOutputRelnames = new Set()
  /** @type {Map<string, Set<string>>} *.pages.* filepath → owned destination-relative outputs */
  #pagesFileOutputMap = new Map()
  /** @type {Map<string, Set<string>>} *.pages.* filepath → layouts used by its generated pages */
  #pagesFileLayoutMap = new Map()
  /** @type {WatchDependencyState | null} subscriptions and fingerprints from the last successful page build */
  #watchDependencies = null
  /** @type {boolean} Failed builds may leave the previous routing state incomplete. */
  #pageBuildFailed = false
  #starting = false
  #acceptWatchEvents = false
  /** @type {Promise<void> | null} */
  #stopping = null

  // Serialized lock so concurrent chokidar events don't pile up
  /** @type {Promise<void>} */
  #buildLock = Promise.resolve()

  /**
   * Create a DomStack build instance.
   *
   * Copy paths supplied through `opts.copy` are resolved to absolute paths from
   * the current working directory, matching the CLI `--copy` behavior.
   *
   * @param {string} src - The src path of the page build
   * @param {string} dest - The dest path of the page build
   * @param {DomStackOpts} [opts] - The options for the site build
   */
  constructor (src, dest, opts = {}) {
    if (!src || typeof src !== 'string') throw new TypeError('src should be a (non-empty) string')
    if (!dest || typeof dest !== 'string') throw new TypeError('dest should be a (non-empty) string')
    if (!opts || typeof opts !== 'object') throw new TypeError('opts should be an object')

    this.#src = src
    this.#dest = dest
    this.#logger = opts.logger ?? createDomStackLogger()
    this.opts = normalizeDomStackOpts(opts, dest)

    const copyDirs = this.opts.copy ?? []
    if (copyDirs.length > 0) {
      const absDest = resolve(this.#dest)
      for (const copyDir of copyDirs) {
        // Copy dirs can be in the src dir (nested builds), but not in the dest dir.
        const relToDest = relative(absDest, copyDir)
        if (relToDest === '' || !relToDest.startsWith('..')) {
          throw new Error(`copyDir ${copyDir} is within the dest directory`)
        }
      }
    }
  }

  get watching () {
    return Boolean(this.#watcher)
  }

  build () {
    return builder(this.#src, this.#dest, { static: true, ...this.opts })
  }

  /**
   * Build and watch a domstack build
   * @param  {object} [params]
   * @param  {boolean} params.serve
   * @param  {(results: Results) => void | Promise<void>} [params.onInitialBuild]
   * @return {Promise<Results>}
   */
  async watch ({
    serve,
    onInitialBuild,
  } = {
    serve: true,
  }) {
    if (this.watching || this.#starting || this.#stopping) throw new Error('Already watching.')
    this.#starting = true
    try {
      return await this.#startWatch({ serve, onInitialBuild })
    } catch (error) {
      try {
        await this.#disposeWatchResources()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Watch startup and cleanup failed')
      }
      throw error
    } finally {
      this.#starting = false
    }
  }

  /** @param {{ serve: boolean, onInitialBuild: ((results: Results) => void | Promise<void>) | undefined }} params */
  async #startWatch ({ serve, onInitialBuild }) {
    // ── Initial build (inline, not via builder()) ────────────────────────
    const siteData = await identifyPages(this.#src, this.opts)

    if (siteData.errors.length > 0) {
      throw new DomStackAggregateError(siteData.errors, 'Page walk finished but there were errors.', siteData)
    }

    await ensureDest(this.#dest, siteData)

    // Start esbuild in watch mode (stable filenames, no hash)
    let esbuildContext
    try {
      const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts)
      esbuildContext = context
    } catch (err) {
      throw new Error('Error starting esbuild watch context', { cause: err })
    }
    this.#esbuildContext = esbuildContext
    this.#siteData = siteData

    // Build pages (initial full build)
    let report
    try {
      const pageBuildResults = await buildPages(this.#src, this.#dest, siteData, {
        ...this.opts,
        trackWatchDependencies: true,
      })
      if (pageBuildResults.errors.length > 0) {
        throw new DomStackAggregateError(pageBuildResults.errors, 'Page build finished but there were errors.', {
          siteData,
          pageBuildResults,
        })
      }
      report = {
        warnings: [...siteData.warnings, ...pageBuildResults.warnings],
        siteData,
        pageBuildResults,
      }
      this.#pageOutputRelnames = getPageOutputRelnames(pageBuildResults.outputs)
      this.#pagesFileOutputMap = getPagesFileOutputMap(pageBuildResults.report.pages)
      this.#pagesFileLayoutMap = getPagesFileLayoutMap(pageBuildResults.report.pages)
      this.#updatePageLayoutNames(pageBuildResults.report.pages, true)
      this.#pageBuildFailed = false
      this.#watchDependencies = pageBuildResults.report.watchDependencies ?? null
      delete pageBuildResults.report.watchDependencies
      delete pageBuildResults.report.rebuiltPagesFilePaths
      buildLogger(report, this.#logger)
      this.#logger.info('Initial JS, CSS and Page Build Complete')
    } catch (err) {
      if (!(err instanceof DomStackAggregateError)) throw new Error('Non-aggregate error thrown', { cause: err })
      this.#pageBuildFailed = true
      report = err.results
      errorLogger(err, this.#logger)
    }

    // Build watch maps after initial build
    await this.#rebuildMaps(siteData)

    // ── Copy watchers & dev server ───────────────────────────────────────
    const copyDirs = getCopyDirs(this.opts.copy ?? [])

    this.#cpxWatchers = []
    this.#cpxWatchers.push(cpxWatch(getCopyGlob(this.#src), this.#dest, { ignore: this.opts.ignore ?? [] }))
    for (const copyDir of copyDirs) this.#cpxWatchers.push(cpxWatch(copyDir, this.#dest))

    const copyWatchersReady = this.#cpxWatchers.map(async w => {
      w.on('copy', (/** @type{{ srcPath: string, dstPath: string }} */e) => {
        this.#logger.info(`Copy ${e.srcPath} to ${e.dstPath}`)
      })

      w.on('remove', (/** @type{{ path: string }} */e) => {
        this.#logger.info(`Remove ${e.path}`)
      })

      w.on('watch-error', (/** @type{Error} */err) => {
        this.#logger.error(`Copy error: ${err.message}`)
      })

      await once(w, 'watch-ready')
      this.#logger.info('Copy watcher ready')
    })

    // ── Chokidar watcher ─────────────────────────────────────────────────
    const ig = ignore().add(this.opts.ignore ?? [])

    const anymatch = (/** @type {string} */name) => ig.ignores(relname(this.#src, name))

    const watcher = chokidar.watch(this.#src, {
      /**
       * Determines whether a given path should be ignored by the watcher.
       *
       * @param {string} filePath - The path to the file or directory.
       * @param {Stats} [stats] - The stats object for the path (may be undefined).
       * @returns {boolean} - Returns true if the path should be ignored.
       */
      ignored: (filePath, stats) => {
        return (
          anymatch(filePath) ||
          Boolean((stats?.isFile() && !/\.(js|mjs|cjs|ts|mts|cts|css|html|md)$/.test(filePath)))
        )
      },
      persistent: true,
      // Increase the atomic write window so editors that do slow atomic saves
      // (write to a temp file then rename) emit a `change` event rather than
      // `unlink` + `add`, which would otherwise trigger unnecessary full rebuilds.
      atomic: 300,
    })

    this.#watcher = watcher

    await Promise.all([
      ...copyWatchersReady,
      once(watcher, 'ready'),
    ])

    await onInitialBuild?.(report)

    // The callback may have stopped this watch session.
    if (!this.watching || this.#stopping) return report

    if (serve) {
      this.#syncServer = await createServer({
        server: this.#dest,
        files: basename(this.#dest),
        ignore: ['**/domstack-esbuild-meta.json'],
        logger: this.#logger.child({ component: 'sync', logPrefix: '[domstack-sync]' }),
      })
    }

    this.#acceptWatchEvents = true
    const enqueue = (/** @type {() => Promise<unknown>} */ fn) => {
      this.#enqueueBuild(fn)
    }

    watcher.on('add', path => {
      enqueue(() => this.#handleAddUnlink(path, 'added'))
    })
    watcher.on('change', path => {
      assert(this.#src)
      assert(this.#dest)
      enqueue(() => this.#handleChange(path))
    })
    watcher.on('unlink', path => {
      enqueue(() => this.#handleAddUnlink(path, 'removed'))
    })
    watcher.on('error', err => errorLogger(err, this.#logger))

    return report
  }

  /**
   * Full rebuild: re-identify pages, restart esbuild, rebuild all pages, rebuild maps.
   * Used for structural changes (add/unlink), global.vars.*, esbuild.settings.*.
   */
  async #fullRebuild () {
    this.#logger.info('Triggering full rebuild...')
    // Dispose the old esbuild context
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose()
      this.#esbuildContext = null
    }

    const siteData = await identifyPages(this.#src, this.opts)

    if (siteData.errors.length > 0) {
      this.#logger.error(`identifyPages errors:
${siteData.errors.map(err => ` ${err.message}`).join('\n')}`)
      return
    }

    await ensureDest(this.#dest, siteData)

    const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts)
    this.#esbuildContext = context
    this.#siteData = siteData

    await this.#runPageBuild(siteData)
    await this.#rebuildMaps(siteData)
  }

  /**
   * Handle file add/unlink events. Categorizes the file to determine the minimal rebuild:
   * - esbuild entry point added/removed: restart esbuild + targeted page rebuild
   * - Otherwise: full rebuild (structural change to the page/layout/template set)
   *
   * @param {string} changedPath - Absolute path of the added/removed file.
   * @param {'added' | 'removed'} event - The type of event.
   */
  async #handleAddUnlink (changedPath, event) {
    const changedBasename = basename(changedPath)
    const changedDir = relative(this.#src, dirname(changedPath))

    // Check if this is an esbuild entry point by basename pattern
    const isEsbuildEntry = (
      pageClientNames.includes(changedBasename) ||
      layoutClientSuffixs.some(s => changedBasename.endsWith(s)) ||
      changedBasename.endsWith(layoutStyleSuffix) ||
      pageWorkerSuffixs.some(s => changedBasename.endsWith(s)) ||
      serviceWorkerNames.includes(changedBasename) ||
      globalClientNames.includes(changedBasename) ||
      globalStyleNames.includes(changedBasename) ||
      changedBasename === pageStyleName
    )

    if (isEsbuildEntry) {
      this.#logger.info(`"${changedBasename}" ${event}, restarting esbuild...`)

      // Re-identify pages to discover the new/removed entry point
      const siteData = await identifyPages(this.#src, this.opts)
      if (siteData.errors.length > 0) {
        this.#logger.error(`identifyPages errors:\n${siteData.errors.map(err => ` ${err.message}`).join('\n')}`)
        return
      }

      await ensureDest(this.#dest, siteData)

      // Restart esbuild with updated entry points
      if (this.#esbuildContext) {
        await this.#esbuildContext.dispose()
        this.#esbuildContext = null
      }
      const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts)
      this.#esbuildContext = context
      this.#siteData = siteData

      // Determine which pages are affected by this entry point change
      if (serviceWorkerNames.includes(changedBasename)) {
        // Service workers are site-level esbuild entries and do not affect page HTML.
        this.#logger.info(`"${changedBasename}" ${event}, no page rebuild needed.`)
      } else if (globalClientNames.includes(changedBasename) || globalStyleNames.includes(changedBasename)) {
        // Global asset: rebuild all pages
        logRebuildTree(changedBasename, this.#logger, new Set(siteData.pages))
        await this.#runPageBuild(siteData)
      } else if (layoutClientSuffixs.some(s => changedBasename.endsWith(s)) || changedBasename.endsWith(layoutStyleSuffix)) {
        // Layout asset: rebuild pages using that layout
        const layoutName = Object.values(siteData.layouts).find(l =>
          l.layoutClient?.filepath === changedPath || l.layoutStyle?.filepath === changedPath
        )?.layoutName
        if (layoutName) {
          // Rebuild maps first so layoutPageMap is current
          await this.#rebuildMaps(siteData)
          const affectedPages = this.#layoutPageMap.get(layoutName)
          const pagesFileFilterPaths = this.#getPagesFilePathsUsingLayouts(new Set([layoutName]))
          if ((affectedPages?.size ?? 0) > 0 || pagesFileFilterPaths.length > 0) {
            logRebuildTree(changedBasename, this.#logger, affectedPages)
            const pageFilterPaths = Array.from(affectedPages ?? []).map(p => p.pageFile.filepath)
            await this.#runPageBuild(siteData, pageFilterPaths, [], pagesFileFilterPaths)
            return
          }
        }
        // Couldn't determine layout — rebuild all pages to be safe
        await this.#runPageBuild(siteData, null, [], null)
      } else {
        // Page-level asset (client.*, style.css, *.worker.*): rebuild only that page
        const affectedPage = siteData.pages.find(p => p.path === changedDir)
        if (affectedPage) {
          logRebuildTree(changedBasename, this.#logger, new Set([affectedPage]))
          await this.#runPageBuild(siteData, [affectedPage.pageFile.filepath], [], [])
        } else {
          // Page not found (maybe it was removed) — rebuild all pages
          await this.#runPageBuild(siteData)
        }
      }

      await this.#rebuildMaps(siteData)
    } else {
      // Non-esbuild file: structural change (page, layout, template, config, etc.)
      this.#logger.info(`"${changedBasename}" ${event}, triggering full rebuild...`)
      return this.#fullRebuild()
    }
  }

  /**
   * Run a full or filtered page build with the existing esbuild context.
   *
   * @param {SiteData} siteData
   * @param {string[] | null} [pageFilterPaths]
   * @param {string[] | null} [templateFilterPaths]
   * @param {string[] | null} [pagesFileFilterPaths]
   */
  async #runPageBuild (siteData, pageFilterPaths = null, templateFilterPaths = null, pagesFileFilterPaths = null) {
    // Retry the complete page phase after a failure: neither subscriptions nor
    // layout routing from a failed build can safely drive an incremental retry.
    if (this.#pageBuildFailed) pageFilterPaths = templateFilterPaths = pagesFileFilterPaths = null
    try {
      const pageBuildResults = await buildPages(this.#src, this.#dest, siteData, {
        ...this.opts,
        ...(pageFilterPaths ? { pageFilterPaths } : {}),
        ...(templateFilterPaths ? { templateFilterPaths } : {}),
        ...(pagesFileFilterPaths ? { pagesFileFilterPaths } : {}),
        previousWatchDependencies: this.#watchDependencies,
        trackWatchDependencies: true,
      })
      if (pageBuildResults.errors.length > 0) {
        throw new DomStackAggregateError(pageBuildResults.errors, 'Page build finished but there were errors.', {
          siteData,
          pageBuildResults,
        })
      }
      const isFiltered = pageFilterPaths !== null || templateFilterPaths !== null || pagesFileFilterPaths !== null
      this.#updatePageLayoutNames(pageBuildResults.report.pages, !isFiltered)
      if (!isFiltered) {
        await this.#removeObsoletePageOutputs(pageBuildResults.outputs)
        this.#pagesFileOutputMap = getPagesFileOutputMap(pageBuildResults.report.pages)
        this.#pagesFileLayoutMap = getPagesFileLayoutMap(pageBuildResults.report.pages)
      } else if ((pageBuildResults.report.rebuiltPagesFilePaths?.length ?? 0) > 0) {
        await this.#removeObsoleteGeneratedPageOutputs(pageBuildResults.report.rebuiltPagesFilePaths ?? [], pageBuildResults.report.pages)
        updatePagesFileLayoutMap(this.#pagesFileLayoutMap, pageBuildResults.report.rebuiltPagesFilePaths ?? [], pageBuildResults.report.pages)
      }
      this.#watchDependencies = pageBuildResults.report.watchDependencies ?? this.#watchDependencies
      delete pageBuildResults.report.watchDependencies
      delete pageBuildResults.report.rebuiltPagesFilePaths
      await this.#rebuildMaps(siteData)
      this.#pageBuildFailed = false
      buildLogger(
        isFiltered ? pageBuildResults : { warnings: pageBuildResults.warnings, siteData, pageBuildResults },
        this.#logger,
        isFiltered ? this.#dest : undefined
      )
      return pageBuildResults
    } catch (err) {
      this.#pageBuildFailed = true
      errorLogger(err, this.#logger)
    }
  }

  /**
   * Remove page files that were emitted by the previous successful full build
   * but are no longer claimed by the current page or template build.
   *
   * @param {DomstackManifestRecord[]} outputs
   */
  async #removeObsoletePageOutputs (outputs) {
    const currentOutputRelnames = new Set(outputs.map(output => output.outputRelname))
    const currentPageOutputRelnames = getPageOutputRelnames(outputs)
    const dest = resolve(this.#dest)

    await Promise.all(Array.from(this.#pageOutputRelnames, async outputRelname => {
      if (currentOutputRelnames.has(outputRelname)) return
      const filepath = resolve(dest, outputRelname)
      assertInsideDest(dest, filepath)
      if (filepath === dest) throw new Error('Refusing to remove the build destination')
      await rm(filepath, { force: true })
    }))

    this.#pageOutputRelnames = currentPageOutputRelnames
  }

  /**
   * Remove outputs no longer emitted by the selected generated-pages owners.
   * Ownership state changes only after a successful targeted build.
   *
   * @param {string[]} pagesFileFilterPaths
   * @param {WatchedPageReport[]} pageReports
   */
  async #removeObsoleteGeneratedPageOutputs (pagesFileFilterPaths, pageReports) {
    const currentByOwner = getPagesFileOutputMap(pageReports)
    const dest = resolve(this.#dest)

    for (const pagesFilePath of pagesFileFilterPaths) {
      const previousOutputs = this.#pagesFileOutputMap.get(pagesFilePath) ?? new Set()
      const currentOutputs = currentByOwner.get(pagesFilePath) ?? new Set()

      await Promise.all(Array.from(previousOutputs, async outputRelname => {
        if (currentOutputs.has(outputRelname)) return
        const filepath = resolve(dest, outputRelname)
        assertInsideDest(dest, filepath)
        if (filepath === dest) throw new Error('Refusing to remove the build destination')
        await rm(filepath, { force: true })
      }))

      for (const outputRelname of previousOutputs) this.#pageOutputRelnames.delete(outputRelname)
      for (const report of pageReports) {
        if (report.pagesFilePath !== pagesFilePath) continue
        for (const output of report.outputs ?? []) {
          if (output.kind === 'page') this.#pageOutputRelnames.add(output.outputRelname)
        }
      }

      if (currentOutputs.size > 0) this.#pagesFileOutputMap.set(pagesFilePath, currentOutputs)
      else this.#pagesFileOutputMap.delete(pagesFilePath)
    }
  }

  /**
   * Find generated-page owners whose last successful outputs used any affected layout.
   *
   * @param {Set<string>} layoutNames
   * @returns {string[]}
   */
  #getPagesFilePathsUsingLayouts (layoutNames) {
    const pagesFilePaths = []
    for (const [pagesFilePath, usedLayouts] of this.#pagesFileLayoutMap) {
      if (Array.from(usedLayouts).some(layoutName => layoutNames.has(layoutName))) {
        pagesFilePaths.push(pagesFilePath)
      }
    }
    return pagesFilePaths
  }

  /**
   * @param {() => Promise<unknown>} fn
   */
  #enqueueBuild (fn) {
    if (!this.#acceptWatchEvents) return
    this.#buildLock = this.#buildLock.then(async () => {
      if (!this.#acceptWatchEvents) return
      try {
        await fn()
      } catch (err) {
        errorLogger(err, this.#logger)
      }
    })
  }

  /**
   * Record source-page layout chains only after successful builds.
   *
   * @param {WatchedPageReport[]} reports
   * @param {boolean} replace
   */
  #updatePageLayoutNames (reports, replace) {
    if (replace) this.#pageLayoutNamesMap.clear()
    for (const report of reports) {
      if (report.sourcePageFilePath) this.#pageLayoutNamesMap.set(report.sourcePageFilePath, report.layoutNames)
    }
  }

  /**
   * Build and maintain the watch maps from siteData.
   * `find()` returns CWD-relative paths; we resolve them to absolute for map keys.
   *
   * @param {SiteData} siteData
   */
  async #rebuildMaps (siteData) {
    const layoutDepMap = /** @type {Map<string, Set<string>>} */ (new Map())
    const layoutPageMap = /** @type {Map<string, Set<PageInfo>>} */ (new Map())
    const pageFileMap = /** @type {Map<string, PageInfo>} */ (new Map())
    const layoutFileMap = /** @type {Map<string, string>} */ (new Map())
    const pageDepMap = /** @type {Map<string, Set<PageInfo>>} */ (new Map())
    const templateDepMap = /** @type {Map<string, Set<TemplateInfo>>} */ (new Map())
    const pagesFileDepMap = /** @type {Map<string, Set<PagesFileInfo>>} */ (new Map())
    const globalDataDepPaths = new Set()
    if (siteData.globalData) {
      globalDataDepPaths.add(siteData.globalData.filepath)
      try {
        for (const dep of await find(siteData.globalData.filepath)) globalDataDepPaths.add(resolve(dep))
      } catch {
        // Static import analysis is best-effort, as for page and layout helpers.
      }
    }

    // layoutFileMap: layout filepath → layoutName
    for (const layout of Object.values(siteData.layouts)) {
      layoutFileMap.set(layout.filepath, layout.layoutName)
    }

    // layoutDepMap: dep filepath → Set<layoutName>
    for (const layout of Object.values(siteData.layouts)) {
      try {
        const deps = await find(layout.filepath)
        for (const dep of deps) {
          const absPath = resolve(dep)
          if (!layoutDepMap.has(absPath)) layoutDepMap.set(absPath, new Set())
          layoutDepMap.get(absPath)?.add(layout.layoutName)
        }
      } catch {
        // dep analysis is best-effort
      }
    }

    // Use the worker's actual selection, including frontmatter and all ancestors.
    for (const pageInfo of siteData.pages) {
      for (const layoutName of this.#pageLayoutNamesMap.get(pageInfo.pageFile.filepath) ?? []) {
        if (!layoutPageMap.has(layoutName)) layoutPageMap.set(layoutName, new Set())
        layoutPageMap.get(layoutName)?.add(pageInfo)
      }
    }

    // pageFileMap: page filepath & page.vars filepath → PageInfo
    for (const pageInfo of siteData.pages) {
      pageFileMap.set(pageInfo.pageFile.filepath, pageInfo)
      if (pageInfo.pageVars) pageFileMap.set(pageInfo.pageVars.filepath, pageInfo)
    }

    // pageDepMap: dep filepath → Set<PageInfo>
    for (const pageInfo of siteData.pages) {
      const filesToTrack = [pageInfo.pageFile.filepath]
      if (pageInfo.pageVars) filesToTrack.push(pageInfo.pageVars.filepath)
      for (const file of filesToTrack) {
        try {
          const deps = await find(file)
          for (const dep of deps) {
            const absPath = resolve(dep)
            if (!pageDepMap.has(absPath)) pageDepMap.set(absPath, new Set())
            pageDepMap.get(absPath)?.add(pageInfo)
          }
        } catch {
          // best-effort
        }
      }
    }

    // templateDepMap: dep filepath → Set<TemplateInfo>
    for (const templateInfo of siteData.templates) {
      try {
        const deps = await find(templateInfo.templateFile.filepath)
        for (const dep of deps) {
          const absPath = resolve(dep)
          if (!templateDepMap.has(absPath)) templateDepMap.set(absPath, new Set())
          templateDepMap.get(absPath)?.add(templateInfo)
        }
      } catch {
        // best-effort
      }
    }

    // pagesFileDepMap: dep filepath → Set<PagesFileInfo>
    for (const pagesFileInfo of siteData.pagesFiles ?? []) {
      try {
        const deps = await find(pagesFileInfo.pagesFile.filepath)
        for (const dep of deps) {
          const absPath = resolve(dep)
          if (!pagesFileDepMap.has(absPath)) pagesFileDepMap.set(absPath, new Set())
          pagesFileDepMap.get(absPath)?.add(pagesFileInfo)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.#logger.debug(`Could not analyze dependencies for pages file "${pagesFileInfo.pagesFile.relname}": ${message}`)
      }
    }

    // esbuildEntryPoints: absolute filepaths of all esbuild entry points
    const esbuildEntryPoints = /** @type {Set<string>} */ (new Set())
    if (siteData.globalClient) esbuildEntryPoints.add(resolve(siteData.globalClient.filepath))
    if (siteData.globalStyle) esbuildEntryPoints.add(resolve(siteData.globalStyle.filepath))
    if (siteData.serviceWorker) esbuildEntryPoints.add(resolve(siteData.serviceWorker.filepath))
    for (const page of siteData.pages) {
      if (page.clientBundle) esbuildEntryPoints.add(resolve(page.clientBundle.filepath))
      if (page.pageStyle) esbuildEntryPoints.add(resolve(page.pageStyle.filepath))
      if (page.workers) {
        for (const w of Object.values(page.workers)) esbuildEntryPoints.add(resolve(w.filepath))
      }
    }
    for (const layout of Object.values(siteData.layouts)) {
      if (layout.layoutClient) esbuildEntryPoints.add(resolve(layout.layoutClient.filepath))
      if (layout.layoutStyle) esbuildEntryPoints.add(resolve(layout.layoutStyle.filepath))
    }

    this.#layoutDepMap = layoutDepMap
    this.#layoutPageMap = layoutPageMap
    this.#pageFileMap = pageFileMap
    this.#layoutFileMap = layoutFileMap
    this.#pageDepMap = pageDepMap
    this.#templateDepMap = templateDepMap
    this.#pagesFileDepMap = pagesFileDepMap
    this.#globalDataDepPaths = globalDataDepPaths
    this.#esbuildEntryPoints = esbuildEntryPoints
  }

  /**
   * Chokidar change handler — implements the decision tree from the plan.
   *
   * @param {string} changedPath - Absolute path of the changed file.
   */
  async #handleChange (changedPath) {
    const siteData = this.#siteData
    if (!siteData) return

    const changedBasename = basename(changedPath)

    // 2. global.vars.* → full rebuild (esbuild restart + all pages)
    if (globalVarsNames.some(n => changedBasename === n)) {
      this.#logger.info(`"${changedBasename}" changed, triggering full rebuild...`)
      return this.#fullRebuild()
    }

    // 3. global.data.* → recompute data and rebuild only declared subscribers
    const globalDataChanged = this.#globalDataDepPaths.has(changedPath)
    if (globalDataChanged) {
      this.#logger.info(`"${changedBasename}" changed, rebuilding data subscribers...`)
    }

    // 4. esbuild.settings.* → full rebuild
    if (esbuildSettingsNames.some(n => changedBasename === n)) {
      this.#logger.info(`"${changedBasename}" changed, triggering full rebuild...`)
      return this.#fullRebuild()
    }

    // 5. markdown-it.settings.* → rebuild Markdown pages and any data subscribers
    // affected by global.data recomputation.
    if (markdownItSettingsNames.some(n => changedBasename === n)) {
      const mdPages = new Set(siteData.pages.filter(p => p.type === 'md'))
      logRebuildTree(changedBasename, this.#logger, mdPages)
      return this.#runPageBuild(siteData, Array.from(mdPages).map(p => p.pageFile.filepath), [], [])
    }

    // domstack-manifest.settings.* only affects one-shot domstack manifest generation.
    // Watch mode intentionally does not write or return a domstack manifest.
    if (domstackManifestSettingsNames.some(n => changedBasename === n)) {
      this.#logger.info(`"${changedBasename}" changed but domstack manifests are disabled in watch mode, skipping.`)
      return
    }

    if (this.#pageBuildFailed) {
      this.#logger.info(`"${changedBasename}" changed, retrying all pages after the previous build failure...`)
      return this.#runPageBuild(siteData)
    }

    // A source can serve several roles at once: an imported parent layout may
    // also be selected directly, and a helper may be shared by pages and templates.
    // Union every matching consumer before scheduling one build.
    const affectedLayouts = new Set(this.#layoutDepMap.get(changedPath))
    const directLayout = this.#layoutFileMap.get(changedPath)
    if (directLayout) affectedLayouts.add(directLayout)

    const affectedPages = new Set(this.#pageDepMap.get(changedPath))
    const directPage = this.#pageFileMap.get(changedPath)
    if (directPage) affectedPages.add(directPage)
    for (const name of affectedLayouts) {
      for (const page of this.#layoutPageMap.get(name) ?? []) affectedPages.add(page)
    }

    const affectedTemplates = new Set(this.#templateDepMap.get(changedPath))
    for (const template of siteData.templates) {
      if (template.templateFile.filepath === changedPath) affectedTemplates.add(template)
    }

    const affectedOwners = new Set(this.#getPagesFilePathsUsingLayouts(affectedLayouts))
    for (const pagesFile of this.#pagesFileDepMap.get(changedPath) ?? []) {
      affectedOwners.add(pagesFile.pagesFile.filepath)
    }
    for (const pagesFile of siteData.pagesFiles ?? []) {
      if (pagesFile.pagesFile.filepath === changedPath) affectedOwners.add(changedPath)
    }

    if (globalDataChanged || affectedPages.size || affectedTemplates.size || affectedOwners.size) {
      logRebuildTree(changedBasename, this.#logger, affectedPages, affectedTemplates)
      return this.#runPageBuild(
        siteData,
        Array.from(affectedPages, page => page.pageFile.filepath),
        Array.from(affectedTemplates, template => template.templateFile.filepath),
        [...affectedOwners]
      )
    }

    // Browser entry points can also be imported by server-side consumers.
    // Only skip the page phase once all those consumers have been considered.
    if (this.#esbuildEntryPoints.has(changedPath)) {
      this.#logger.info(`"${changedBasename}" changed, esbuild will handle rebundling.`)
      return
    }

    // No matching rule — skip.
    this.#logger.info(`"${changedBasename}" changed but did not match any rebuild rule, skipping.`)
  }

  async stopWatching () {
    if (this.#stopping) return this.#stopping
    if ((!this.watching || !this.#cpxWatchers)) throw new Error('Not watching')
    this.#stopping = this.#disposeWatchResources()
    try {
      await this.#stopping
    } finally {
      this.#stopping = null
    }
  }

  async #disposeWatchResources () {
    this.#acceptWatchEvents = false
    const closures = [
      () => this.#watcher?.close(),
      ...(this.#cpxWatchers ?? []).map(w => () => w.close()),
    ]
    const results = await Promise.allSettled(closures.map(close => Promise.resolve().then(close)))

    // Queued events are cancelled; a build already running may still replace the
    // esbuild context, so wait before disposing the final context and server.
    await this.#buildLock
    results.push(...await Promise.allSettled([
      Promise.resolve().then(() => this.#esbuildContext?.dispose()),
      Promise.resolve().then(() => this.#syncServer?.exit()),
    ]))
    this.#watcher = null
    this.#cpxWatchers = null
    this.#esbuildContext = null
    this.#syncServer = null
    this.#siteData = null
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length > 0) throw new AggregateError(errors, 'Watch cleanup failed')
  }

  /**
   * Returns a promise that resolves when all queued rebuilds have finished.
   * @returns {Promise<void>}
   */
  async settled () {
    await this.#buildLock
  }
}

/**
 * @param {DomstackManifestRecord[]} outputs
 * @returns {Set<string>}
 */
function getPageOutputRelnames (outputs) {
  return new Set(outputs
    .filter(output => output.kind === 'page')
    .map(output => output.outputRelname))
}

/**
 * Group generated-page outputs by their owning *.pages.* filepath.
 *
 * @param {WatchedPageReport[]} pageReports
 * @returns {Map<string, Set<string>>}
 */
function getPagesFileOutputMap (pageReports) {
  /** @type {Map<string, Set<string>>} */
  const outputsByOwner = new Map()

  for (const report of pageReports) {
    if (!report.pagesFilePath) continue
    const outputs = outputsByOwner.get(report.pagesFilePath) ?? new Set()
    for (const output of report.outputs ?? []) outputs.add(output.outputRelname)
    outputsByOwner.set(report.pagesFilePath, outputs)
  }

  return outputsByOwner
}

/**
 * Group layouts used by generated pages by their owning *.pages.* filepath.
 *
 * @param {WatchedPageReport[]} pageReports
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
 *
 * @param {Map<string, Set<string>>} layoutMap
 * @param {string[]} rebuiltOwnerPaths
 * @param {WatchedPageReport[]} pageReports
 */
function updatePagesFileLayoutMap (layoutMap, rebuiltOwnerPaths, pageReports) {
  const rebuiltLayouts = getPagesFileLayoutMap(pageReports)
  for (const ownerPath of rebuiltOwnerPaths) {
    const layouts = rebuiltLayouts.get(ownerPath)
    if (layouts?.size) layoutMap.set(ownerPath, layouts)
    else layoutMap.delete(ownerPath)
  }
}

/**
 * Build a DomStack site into a temporary directory for isolated tests.
 *
 * @param {string} src - Source directory to build.
 * @param {DomStackOpts} [opts] - DomStack build options.
 * @returns {Promise<TestBuildResult>}
 */
export async function testBuild (src, opts = {}) {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-test-'))
  const domstack = new DomStack(resolve(src), dest, opts)
  const results = await domstack.build()

  return {
    dest,
    results,
    readOutput: path => readFile(join(dest, path), 'utf8'),
    cleanup: () => rm(dest, { recursive: true, force: true }),
  }
}

/**
 * relanem is the bsaename if (root === name), otherwise relative(root, name)
 * @param  {string} root The root path string
 * @param  {string} name The name string
 * @return {string}      the relname
 */
function relname (root, name) {
  return root === name ? basename(name) : relative(root, name)
}

/**
 * @param {DomStackOpts} opts
 * @param {string} dest
 * @returns {DomStackOpts}
 */
function normalizeDomStackOpts (opts, dest) {
  const buildOpts = { ...opts }
  delete buildOpts.logger
  const copyDirs = (buildOpts.copy ?? []).map(dir => resolve(dir))

  return {
    ...buildOpts,
    copy: copyDirs,
    ignore: [
      ...DEFAULT_IGNORES,
      basename(dest),
      ...copyDirs.map(dir => basename(dir)),
      ...makeArray(buildOpts.ignore),
    ],
  }
}

/**
 * Log a rebuild tree showing what triggered a rebuild and what will be rebuilt.
 * @param {string} trigger - The changed file (display name)
 * @param {PinoLogger} logger
 * @param {Set<PageInfo>} [pages]
 * @param {Set<TemplateInfo>} [templates]
 */
function logRebuildTree (trigger, logger, pages, templates) {
  const lines = [`"${trigger}" changed:`]
  for (const p of pages ?? []) {
    lines.push(`  → ${p.outputRelname}`)
  }
  for (const t of templates ?? []) {
    lines.push(`  → ${t.outputName} (template)`)
  }
  logger.info(lines.join('\n'))
}

/**
 * An error logger
 * @param  {Error | AggregateError | any } err The error to log
 * @param {PinoLogger} logger
 */
function errorLogger (err, logger) {
  if (!(err instanceof Error || err instanceof AggregateError)) throw new Error('Non-error thrown', { cause: err })
  if ('results' in err) delete err.results
  logger.error(inspect(err, { depth: 999, colors: true }))
  logger.error('\nBuild Failed!\n\n')
}

/**
 * Log build results.
 * @param  {Partial<Results> | WorkerBuildStepResult} results
 * @param {PinoLogger} logger
 * @param  {string} [dest] - dest path for relativizing output paths in filtered builds
 */
function buildLogger (results, logger, dest) {
  if ((results?.warnings?.length ?? 0) > 0) {
    logger.warn('\nThere were build warnings:\n')
  }
  for (const warning of results?.warnings ?? []) {
    if ('message' in warning) {
      logger.warn(`  ${warning.message}`)
    } else {
      logger.warn(inspect(warning, { depth: 999, colors: true }))
    }
  }

  if ('siteData' in results && results.siteData) {
    // Full build: show site totals
    const layoutCount = Object.keys(results.siteData.layouts).length
    logger.info(`Source pages: ${results.siteData.pages.length} Layouts: ${layoutCount} Templates: ${results.siteData.templates.length}`)
    const outputs = results.pageBuildResults?.outputs
    if (outputs) {
      const summary = summarizePageDomstackManifests(outputs)
      logger.info(`Pages built: ${summary.pages} Templates built: ${summary.templates}`)
    }
  } else if ('outputs' in results) {
    // Filtered build: show what was actually built
    const outputs = results.outputs
    if (dest) {
      for (const output of outputs) {
        if (output.kind === 'page' || output.kind === 'template') {
          logger.info(`  Built ${relative(dest, output.filepath)}`)
        }
      }
    }
    const summary = summarizePageDomstackManifests(outputs)
    logger.info(`Pages built: ${summary.pages} Templates built: ${summary.templates}`)
  }
  logger.info('\nBuild Success!\n\n')
}

/**
 * @param {DomstackManifestRecord[]} outputs
 */
function summarizePageDomstackManifests (outputs) {
  const templateSources = new Set()
  let pages = 0

  for (const output of outputs) {
    if (output.kind === 'page') pages += 1
    if (output.kind === 'template') {
      templateSources.add(output.sourceRelname ?? output.templatePath ?? output.outputRelname)
    }
  }

  return {
    pages,
    templates: templateSources.size,
  }
}
