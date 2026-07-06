/**
 * @import { DomStackOpts, Results, SiteData } from './lib/builder.js'
 * @import { Stats } from 'node:fs'
 * @import { FSWatcher } from 'chokidar'
 * @import { WorkerBuildStepResult } from './lib/build-pages/index.js'

 * @import { PageInfo, TemplateInfo } from './lib/identify-pages.js'
 * @import { TestBuildResult } from './types.js'
 * @import { BsInstance } from '@domstack/sync'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { DomstackManifestRecord } from './lib/domstack-manifest/index.js'
 * @typedef {{ dispose: () => Promise<void> }} DisposableBuildContext
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

import { getCopyGlob } from './lib/build-static/index.js'
import { getCopyDirs } from './lib/build-copy/index.js'
import { builder } from './lib/builder.js'
import { buildEsbuildWatch } from './lib/build-esbuild/index.js'
import { buildPages } from './lib/build-pages/index.js'
import {
  identifyPages,
  layoutSuffixs,
  layoutStyleSuffix,
  templateSuffixs,
  globalVarsNames,
  globalDataNames,
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
import { resolveVars } from './lib/build-pages/resolve-vars.js'
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
  buildDomstackManifest,
  domstackManifestSchema,
  getDomstackManifestSchemaId,
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
  /** @type {Map<string, PageInfo>} filepath → PageInfo */
  #pageFileMap = new Map()
  /** @type {Map<string, string>} filepath → layoutName */
  #layoutFileMap = new Map()
  /** @type {Map<string, Set<PageInfo>>} depFilepath → Set<PageInfo> */
  #pageDepMap = new Map()
  /** @type {Map<string, Set<TemplateInfo>>} depFilepath → Set<TemplateInfo> */
  #templateDepMap = new Map()
  /** @type {Set<string>} absolute filepaths of esbuild entry points */
  #esbuildEntryPoints = new Set()

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
    if (this.watching) throw new Error('Already watching.')

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
      buildLogger(report, this.#logger)
      this.#logger.info('Initial JS, CSS and Page Build Complete')
    } catch (err) {
      errorLogger(err, this.#logger)
      if (!(err instanceof DomStackAggregateError)) throw new Error('Non-aggregate error thrown', { cause: err })
      report = err.results
    }

    // Build watch maps after initial build
    await this.#rebuildMaps(siteData)

    // ── Copy watchers & dev server ───────────────────────────────────────
    const copyDirs = getCopyDirs(this.opts.copy ?? [])

    this.#cpxWatchers = [
      cpxWatch(getCopyGlob(this.#src), this.#dest, { ignore: this.opts.ignore ?? [] }),
      ...copyDirs.map(copyDir => cpxWatch(copyDir, this.#dest))
    ]

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

    if (serve) {
      this.#syncServer = await createServer({
        server: this.#dest,
        files: basename(this.#dest),
        logger: this.#logger.child({ component: 'sync', logPrefix: '[domstack-sync]' }),
      })
    }

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
          if (affectedPages && affectedPages.size > 0) {
            logRebuildTree(changedBasename, this.#logger, affectedPages)
            const pageFilterPaths = Array.from(affectedPages).map(p => p.pageFile.filepath)
            await this.#runPageBuild(siteData, pageFilterPaths, [])
            return
          }
        }
        // Couldn't determine layout — rebuild all pages to be safe
        await this.#runPageBuild(siteData)
      } else {
        // Page-level asset (client.*, style.css, *.worker.*): rebuild only that page
        const affectedPage = siteData.pages.find(p => p.path === changedDir)
        if (affectedPage) {
          logRebuildTree(changedBasename, this.#logger, new Set([affectedPage]))
          await this.#runPageBuild(siteData, [affectedPage.pageFile.filepath], [])
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
   * Full page rebuild only: re-run all pages+templates with existing esbuild context.
   * Used for global.data.*, markdown-it.settings.* (all md pages).
   *
   * @param {SiteData} siteData
   * @param {string[] | null} [pageFilterPaths]
   * @param {string[] | null} [templateFilterPaths]
   */
  async #runPageBuild (siteData, pageFilterPaths = null, templateFilterPaths = null) {
    try {
      const pageBuildResults = await buildPages(this.#src, this.#dest, siteData, {
        ...this.opts,
        ...(pageFilterPaths ? { pageFilterPaths } : {}),
        ...(templateFilterPaths ? { templateFilterPaths } : {}),
      })
      if (pageBuildResults.errors.length > 0) {
        throw new DomStackAggregateError(pageBuildResults.errors, 'Page build finished but there were errors.', {
          siteData,
          pageBuildResults,
        })
      }
      const isFiltered = pageFilterPaths !== null || templateFilterPaths !== null
      buildLogger(
        isFiltered ? pageBuildResults : { warnings: pageBuildResults.warnings, siteData, pageBuildResults },
        this.#logger,
        isFiltered ? this.#dest : undefined
      )
      return pageBuildResults
    } catch (err) {
      errorLogger(err, this.#logger)
    }
  }

  /**
   * @param {() => Promise<unknown>} fn
   */
  #enqueueBuild (fn) {
    this.#buildLock = this.#buildLock.then(async () => {
      try {
        await fn()
      } catch (err) {
        errorLogger(err, this.#logger)
      }
    })
  }

  /**
   * Build and maintain the six watch maps from siteData.
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

    // layoutPageMap: layoutName → Set<PageInfo>
    // Build by reading each page's vars file (lightweight, no full render)
    const defaultVars = /** @type {{ layout?: string }} */ (await resolveVars({
      varsPath: resolve(import.meta.dirname, 'lib/defaults/default.vars.js'),
    }))
    const bareGlobalVars = /** @type {{ layout?: string }} */ (await resolveVars({
      varsPath: siteData?.globalVars?.filepath,
    }))
    const globalVars = { ...defaultVars, ...bareGlobalVars }
    const defaultLayout = globalVars.layout ?? 'root'

    for (const pageInfo of siteData.pages) {
      let layoutName = defaultLayout
      if (pageInfo.pageVars) {
        try {
          const pageVars = /** @type {{ layout?: string }} */ (await resolveVars({ varsPath: pageInfo.pageVars.filepath }))
          if (typeof pageVars.layout === 'string') layoutName = pageVars.layout
        } catch {
          // fall back to default
        }
      }
      if (!layoutPageMap.has(layoutName)) layoutPageMap.set(layoutName, new Set())
      layoutPageMap.get(layoutName)?.add(pageInfo)
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

    // 3. global.data.* → full page rebuild (no esbuild restart)
    if (globalDataNames.some(n => changedBasename === n)) {
      this.#logger.info(`"${changedBasename}" changed, rebuilding all pages...`)
      return this.#runPageBuild(siteData)
    }

    // 4. esbuild.settings.* → full rebuild
    if (esbuildSettingsNames.some(n => changedBasename === n)) {
      this.#logger.info(`"${changedBasename}" changed, triggering full rebuild...`)
      return this.#fullRebuild()
    }

    // 5. markdown-it.settings.* → rebuild all md pages only
    if (markdownItSettingsNames.some(n => changedBasename === n)) {
      const mdPages = new Set(siteData.pages.filter(p => p.type === 'md'))
      logRebuildTree(changedBasename, this.#logger, mdPages)
      return this.#runPageBuild(siteData, Array.from(mdPages).map(p => p.pageFile.filepath), [])
    }

    // domstack-manifest.settings.* only affects one-shot domstack manifest generation.
    // Watch mode intentionally does not write or return a domstack manifest.
    if (domstackManifestSettingsNames.some(n => changedBasename === n)) {
      this.#logger.info(`"${changedBasename}" changed but domstack manifests are disabled in watch mode, skipping.`)
      return
    }

    // 6. esbuild entry point (client.js, style.css, .layout.css, .layout.client.*, *.worker.*, global.client.*, global.css)
    // esbuild's own watcher handles these. Stable filenames mean page HTML doesn't
    // change, so no page rebuild is needed.
    if (this.#esbuildEntryPoints.has(changedPath)) {
      this.#logger.info(`"${changedBasename}" changed, esbuild will handle rebundling.`)
      return
    }

    // 7. Layout file itself → rebuild pages using that layout
    if (layoutSuffixs.some(s => changedBasename.endsWith(s))) {
      const layoutName = this.#layoutFileMap.get(changedPath)
      if (layoutName) {
        const affectedPages = this.#layoutPageMap.get(layoutName)
        if (affectedPages && affectedPages.size > 0) {
          logRebuildTree(changedBasename, this.#logger, affectedPages)
          const pageFilterPaths = Array.from(affectedPages).map(p => p.pageFile.filepath)
          return this.#runPageBuild(siteData, pageFilterPaths, [])
        }
        this.#logger.info(`"${changedBasename}" changed but no pages use layout "${layoutName}", skipping.`)
        return
      }
      // Not a registered layout — fall through to dep checks
    }

    // 8. Dep of a layout
    if (this.#layoutDepMap.has(changedPath)) {
      const affectedLayoutNames = this.#layoutDepMap.get(changedPath) ?? new Set()
      const affectedPages = new Set(/** @type {PageInfo[]} */ ([]))
      for (const layoutName of affectedLayoutNames) {
        const pages = this.#layoutPageMap.get(layoutName)
        if (pages) for (const p of pages) affectedPages.add(p)
      }
      if (affectedPages.size > 0) {
        logRebuildTree(changedBasename, this.#logger, affectedPages)
        const pageFilterPaths = Array.from(affectedPages).map(p => p.pageFile.filepath)
        return this.#runPageBuild(siteData, pageFilterPaths, [])
      }
    }

    // 9. Page file or page.vars file
    if (this.#pageFileMap.has(changedPath)) {
      const affectedPage = this.#pageFileMap.get(changedPath)
      if (affectedPage) {
        logRebuildTree(changedBasename, this.#logger, new Set([affectedPage]))
        return this.#runPageBuild(siteData, [affectedPage.pageFile.filepath], [])
      }
    }

    // 10. Template file itself
    if (templateSuffixs.some(s => changedBasename.endsWith(s))) {
      const templateInfo = siteData.templates.find(t => t.templateFile.filepath === changedPath)
      if (templateInfo) {
        logRebuildTree(changedBasename, this.#logger, undefined, new Set([templateInfo]))
        return this.#runPageBuild(siteData, [], [templateInfo.templateFile.filepath])
      }
    }

    // 11. Dep of a page.js or page.vars
    if (this.#pageDepMap.has(changedPath)) {
      const affectedPages = this.#pageDepMap.get(changedPath) ?? new Set()
      if (affectedPages.size > 0) {
        logRebuildTree(changedBasename, this.#logger, affectedPages)
        const pageFilterPaths = Array.from(affectedPages).map(p => p.pageFile.filepath)
        return this.#runPageBuild(siteData, pageFilterPaths, [])
      }
    }

    // 12. Dep of a template file
    if (this.#templateDepMap.has(changedPath)) {
      const affectedTemplates = this.#templateDepMap.get(changedPath) ?? new Set()
      if (affectedTemplates.size > 0) {
        logRebuildTree(changedBasename, this.#logger, undefined, affectedTemplates)
        const templateFilterPaths = Array.from(affectedTemplates).map(t => t.templateFile.filepath)
        return this.#runPageBuild(siteData, [], templateFilterPaths)
      }
    }

    // 13. No matching rule — skip.
    this.#logger.info(`"${changedBasename}" changed but did not match any rebuild rule, skipping.`)
  }

  async stopWatching () {
    if ((!this.watching || !this.#cpxWatchers)) throw new Error('Not watching')
    if (this.#watcher) this.#watcher.close()
    this.#cpxWatchers.forEach(w => {
      w.close()
    })
    this.#watcher = null
    this.#cpxWatchers = null
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose()
      this.#esbuildContext = null
    }
    await this.#syncServer?.exit()
    this.#syncServer = null
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
    logger.info(`Pages: ${results.siteData.pages.length} Layouts: ${layoutCount} Templates: ${results.siteData.templates.length}`)
    const outputs = results.pageBuildResults?.report?.outputs
    if (outputs) {
      const summary = summarizePageDomstackManifests(outputs)
      logger.info(`Pages built: ${summary.pages} Templates built: ${summary.templates}`)
    }
  } else if ('report' in results && results.report) {
    // Filtered build: show what was actually built
    const report = results.report
    const outputs = report.outputs ?? []
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
