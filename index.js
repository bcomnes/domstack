/**
 * @import { DomStackOpts as DomStackOpts, Results, SiteData } from './lib/builder.js'
 * @import { FSWatcher } from 'chokidar'
 * @import { Stats } from 'node:fs'
 * @import { AsyncLayoutFunction, LayoutFunction } from './lib/build-pages/page-data.js'
 * @import { PageFunction, AsyncPageFunction } from './lib/build-pages/page-builders/page-writer.js'
 * @import { TemplateFunction } from './lib/build-pages/page-builders/template-builder.js'
 * @import { TemplateAsyncIterator } from './lib/build-pages/page-builders/template-builder.js'
 * @import { TemplateOutputOverride } from './lib/build-pages/page-builders/template-builder.js'
 * @import { PageInfo, TemplateInfo } from './lib/identify-pages.js'
 * @import { PageData } from './lib/build-pages/page-data.js'
 * @import { BuildOptions, BuildContext, BuildResult } from 'esbuild'
 * @import { BuildPagesOpts, PageBuildStepResult } from './lib/build-pages/index.js'
*/
import { once } from 'events'
import assert from 'node:assert'
import chokidar from 'chokidar'
import { basename, relative, resolve } from 'node:path'
// @ts-expect-error
import makeArray from 'make-array'
import ignore from 'ignore'
// @ts-expect-error
import cpx from 'cpx2'
import { inspect } from 'util'
import browserSync from 'browser-sync'
import pMap from 'p-map'
import { find as findDeps } from '@11ty/dependency-tree-typescript'

import { getCopyGlob, buildStatic } from './lib/build-static/index.js'
import { getCopyDirs, buildCopy } from './lib/build-copy/index.js'
import { builder } from './lib/builder.js'
import { buildPages } from './lib/build-pages/index.js'
import { identifyPages } from './lib/identify-pages.js'
import { buildEsbuild } from './lib/build-esbuild/index.js'
import { ensureDest } from './lib/helpers/ensure-dest.js'
import { resolveVars } from './lib/build-pages/resolve-vars.js'
import { DomStackAggregateError } from './lib/helpers/dom-stack-aggregate-error.js'

/**
 * @typedef {BuildOptions} BuildOptions
 */

/**
 * @template {Record<string, any>} Vars - The type of variables passed to the layout function
 * @template [PageReturn=any] PageReturn - The return type of the page function (defaults to any)
 * @template [LayoutReturn=string] LayoutReturn - The return type of the layout function (defaults to string)
 * @typedef {LayoutFunction<Vars, PageReturn, LayoutReturn>} LayoutFunction
 */

/**
 * @template {Record<string, any>} Vars - The type of variables passed to the async layout function
 * @template [PageReturn=any] PageReturn - The return type of the page function (defaults to any)
 * @template [LayoutReturn=string] LayoutReturn - The return type of the layout function (defaults to string)
 * @typedef {AsyncLayoutFunction<Vars, PageReturn, LayoutReturn>} AsyncLayoutFunction
 */

/**
 * @template {Record<string, any>} Vars - The type of variables passed to the page function
 * @template [PageReturn=any] PageReturn - The return type of the page function (defaults to any)
 * @typedef {PageFunction<Vars, PageReturn>} PageFunction
 */

/**
 * @template {Record<string, any>} Vars - The type of variables passed to the async page function
 * @template [PageReturn=any] PageReturn - The return type of the page function (defaults to any)
 * @typedef {AsyncPageFunction<Vars, PageReturn>} AsyncPageFunction
 */

/**
 * @template {Record<string, any>} Vars - The type of variables for the template function
 * @typedef {TemplateFunction<Vars>} TemplateFunction
 */

/**
 * @template {Record<string, any>} Vars - The type of variables for the template async iterator
 * @typedef {TemplateAsyncIterator<Vars>} TemplateAsyncIterator
 */

/**
 * @typedef {TemplateOutputOverride} TemplateOutputOverride
 */

/**
 * @typedef {PageInfo} PageInfo
 */

/**
 * @template {Record<string, any>} [T=object] T - The type of variables for the page data
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @typedef {PageData<T, U, V>} PageData
 */

const DEFAULT_IGNORES = /** @type {const} */ ([
  '.*',
  'coverage',
  'node_modules',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])

const globalVarsNames = new Set(['global.vars.ts', 'global.vars.mts', 'global.vars.cts', 'global.vars.js', 'global.vars.mjs', 'global.vars.cjs'])
const globalDataNames = new Set(['global.data.ts', 'global.data.mts', 'global.data.cts', 'global.data.js', 'global.data.mjs', 'global.data.cjs'])
const esbuildSettingsNames = new Set(['esbuild.settings.ts', 'esbuild.settings.mts', 'esbuild.settings.cts', 'esbuild.settings.js', 'esbuild.settings.mjs', 'esbuild.settings.cjs'])
const markdownItSettingsNames = new Set(['markdown-it.settings.ts', 'markdown-it.settings.mts', 'markdown-it.settings.cts', 'markdown-it.settings.js', 'markdown-it.settings.mjs', 'markdown-it.settings.cjs'])
const templateSuffixes = ['.template.ts', '.template.mts', '.template.cts', '.template.js', '.template.mjs', '.template.cjs']

/**
 * Find transitive ESM dependencies of a file.
 * @param {string} filepath
 * @returns {Promise<string[]>}
 */
async function findDepsOf (filepath) {
  try {
    return await findDeps(filepath)
  } catch {
    return []
  }
}

/**
 * Build the watch maps from siteData.
 * @param {SiteData} siteData
 * @returns {Promise<{
 *   layoutDepMap: Map<string, Set<string>>,
 *   layoutPageMap: Map<string, Set<PageInfo>>,
 *   pageFileMap: Map<string, PageInfo>,
 *   layoutFileMap: Map<string, string>,
 * }>}
 */
async function buildWatchMaps (siteData) {
  /** @type {Map<string, Set<string>>} depFilepath -> Set<layoutName> */
  const layoutDepMap = new Map()
  /** @type {Map<string, Set<PageInfo>>} layoutName -> Set<PageInfo> */
  const layoutPageMap = new Map()
  /** @type {Map<string, PageInfo>} pageFile/pageVars filepath -> PageInfo */
  const pageFileMap = new Map()
  /** @type {Map<string, string>} layout filepath -> layoutName */
  const layoutFileMap = new Map()

  // Build layoutDepMap and layoutFileMap via static dep analysis
  await pMap(Object.values(siteData.layouts), async (layout) => {
    layoutFileMap.set(layout.filepath, layout.layoutName)
    const deps = await findDepsOf(layout.filepath)
    for (const dep of deps) {
      if (!layoutDepMap.has(dep)) layoutDepMap.set(dep, new Set())
      layoutDepMap.get(dep)?.add(layout.layoutName)
    }
  }, { concurrency: 8 })

  // Build layoutPageMap and pageFileMap by resolving each page's layout var.
  // This runs in the main process — ESM cache is acceptable since we only need
  // to know the layout name string, not call the module.
  await pMap(siteData.pages, async (pageInfo) => {
    pageFileMap.set(pageInfo.pageFile.filepath, pageInfo)
    if (pageInfo.pageVars) pageFileMap.set(pageInfo.pageVars.filepath, pageInfo)

    const pageVars = /** @type {Record<string, any>} */ (await resolveVars({ varsPath: pageInfo.pageVars?.filepath }).catch(() => ({})))
    const layoutName = /** @type {string} */ (pageVars['layout'] ?? 'root')

    if (!layoutPageMap.has(layoutName)) layoutPageMap.set(layoutName, new Set())
    layoutPageMap.get(layoutName)?.add(pageInfo)
  }, { concurrency: 8 })

  return { layoutDepMap, layoutPageMap, pageFileMap, layoutFileMap }
}

/**
 * @template {DomStackOpts} [CurrentOpts=DomStackOpts] - The type of options for the DomStack instance
 */
export class DomStack {
  /** @type {string} */ #src = ''
  /** @type {string} */ #dest = ''
  /** @type {Readonly<CurrentOpts & { ignore: string[] }>} */ opts
  /** @type {FSWatcher?} */ #watcher = null
  /** @type {any[]?} */ #cpxWatchers = null
  /** @type {browserSync.BrowserSyncInstance?} */ #browserSyncServer = null
  /** @type {BuildContext?} */ #esbuildContext = null

  /**
   *
   * @param {string} src - The src path of the page build
   * @param {string} dest - The dest path of the page build
   * @param {CurrentOpts} [opts] - The options for the site build
   */
  constructor (src, dest, opts = /** @type {CurrentOpts} */ ({})) {
    if (!src || typeof src !== 'string') throw new TypeError('src should be a (non-empty) string')
    if (!dest || typeof dest !== 'string') throw new TypeError('dest should be a (non-empty) string')
    if (!opts || typeof opts !== 'object') throw new TypeError('opts should be an object')

    this.#src = src
    this.#dest = dest

    const copyDirs = opts?.copy ?? []

    this.opts = {
      ...opts,
      ignore: [
        ...DEFAULT_IGNORES,
        basename(dest),
        ...copyDirs.map(dir => basename(dir)),
        ...makeArray(opts.ignore),
      ],
    }

    if (copyDirs && copyDirs.length > 0) {
      const absDest = resolve(this.#dest)
      for (const copyDir of copyDirs) {
        // Copy dirs can be in the src dir (nested builds), but not in the dest dir.
        const absCopyDir = resolve(copyDir)
        const relToDest = relative(absDest, absCopyDir)
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
   * @return {Promise<Results>}
   */
  async watch ({
    serve,
  } = {
    serve: true,
  }) {
    if (this.watching) throw new Error('Already watching.')

    const src = this.#src
    const dest = this.#dest
    const opts = this.opts

    // --- Initial full build using watch-mode esbuild (stable filenames, no hashes) ---
    // We do NOT call builder() here — it would run esbuild with hashed filenames and
    // then we'd run esbuild again below in watch mode with stable filenames, producing
    // a double build. Instead we inline the build steps, using watch-mode esbuild from
    // the start so only one set of output files is ever written.
    const siteData = await identifyPages(src, opts)
    await ensureDest(dest, siteData)

    /** @type {Results} */
    const report = {
      warnings: [...siteData.warnings],
      siteData,
      esbuildResults: /** @type {any} */ (null),
    }

    if (siteData.errors.length > 0) {
      errorLogger(new DomStackAggregateError(siteData.errors, 'Page walk finished but there were errors.', siteData))
    }

    // Run static copy and esbuild concurrently; esbuild uses watch mode (stable names)
    let esbuildReady = false

    /**
     * Run a partial or full page build.
     * @param {Set<PageInfo>} [pageFilter]
     * @param {Set<TemplateInfo>} [templateFilter]
     */
    const runPageBuild = async (pageFilter, templateFilter) => {
      /** @type {BuildPagesOpts} */
      const buildPagesOpts = {}
      if (pageFilter) buildPagesOpts.pageFilterPaths = [...pageFilter].map(p => p.pageFile.filepath)
      if (templateFilter) buildPagesOpts.templateFilterPaths = [...templateFilter].map(t => t.templateFile.filepath)
      try {
        const pageBuildResults = await buildPages(src, dest, siteData, opts, buildPagesOpts)

        buildLogger(pageBuildResults)
        return pageBuildResults
      } catch (err) {
        errorLogger(err)
        return null
      }
    }

    const makeEsbuildOnEnd = () => (/** @type {BuildResult} */ result) => {
      if (!esbuildReady) return
      if (result.errors.length > 0) {
        console.error('esbuild rebuild errors:', result.errors)
        return
      }
      console.log('esbuild rebuilt JS/CSS, re-rendering all pages...')
      runPageBuild().catch(errorLogger)
    }

    // Run static copy and esbuild (watch mode) concurrently for the initial build.
    // esbuild.context() does a real build synchronously before returning, so after
    // this Promise.all completes, siteData has the correct stable output paths.
    const [esbuildResults, staticResults, copyResults] = await Promise.all([
      buildEsbuild(src, dest, siteData, opts, {
        watch: true,
        onEnd: makeEsbuildOnEnd(),
      }),
      buildStatic(src, dest, siteData, { ...opts, static: true }),
      buildCopy(src, dest, siteData, opts),
    ])
    esbuildReady = true

    report.esbuildResults = esbuildResults
    report.staticResults = staticResults
    report.copyResults = copyResults

    if (esbuildResults.errors.length > 0) {
      console.error('Initial esbuild (watch) errors:', esbuildResults.errors)
    }
    if (staticResults?.errors.length > 0) {
      console.error('Initial static build errors:', staticResults.errors)
    }
    if (copyResults?.errors.length > 0) {
      console.error('Initial copy errors:', copyResults.errors)
    }
    if (esbuildResults.context) {
      this.#esbuildContext = esbuildResults.context
    }

    // Run initial page build now that esbuild has written stable output files
    const initialPageResults = await runPageBuild()
    if (initialPageResults) {
      report.pageBuildResults = initialPageResults
    }
    console.log('Initial JS, CSS and Page Build Complete')

    // --- Build watch maps ---
    let { layoutDepMap, layoutPageMap, pageFileMap, layoutFileMap } = await buildWatchMaps(siteData)

    const rebuildMaps = async () => {
      const maps = await buildWatchMaps(siteData)
      layoutDepMap = maps.layoutDepMap
      layoutPageMap = maps.layoutPageMap
      pageFileMap = maps.pageFileMap
      layoutFileMap = maps.layoutFileMap
    }

    /**
     * Full structural rebuild: re-identify pages, restart esbuild context, rebuild maps.
     */
    const fullRebuild = async () => {
      console.log('Structural change detected, running full rebuild...')
      try {
        if (this.#esbuildContext) {
          await this.#esbuildContext.dispose()
          this.#esbuildContext = null
          esbuildReady = false
        }

        const newSiteData = await identifyPages(src, opts)
        Object.assign(siteData, newSiteData)
        await ensureDest(dest, siteData)

        const newEsbuildResults = await buildEsbuild(src, dest, siteData, opts, {
          watch: true,
          onEnd: makeEsbuildOnEnd(),
        })
        esbuildReady = true

        if (newEsbuildResults.context) {
          this.#esbuildContext = newEsbuildResults.context
        }

        await runPageBuild()
        await rebuildMaps()
        console.log('Full rebuild complete')
      } catch (err) {
        errorLogger(err)
        if (!esbuildReady) {
          console.error('esbuild failed to restart. Fix the error above and save any file to retry.')
        }
      }
    }

    // --- cpx copy watchers ---
    const copyDirs = getCopyDirs(opts.copy)
    this.#cpxWatchers = [
      cpx.watch(getCopyGlob(src), dest, { ignore: opts.ignore }),
      ...copyDirs.map(copyDir => cpx.watch(copyDir, dest))
    ]

    if (serve) {
      const bs = browserSync.create()
      this.#browserSyncServer = bs
      bs.watch(basename(dest), { ignoreInitial: true }).on('change', bs.reload)
      bs.init({ server: dest })
    }

    this.#cpxWatchers.forEach(w => {
      w.on('watch-ready', () => {
        console.log('Copy watcher ready')
        w.on('copy', (/** @type{{ srcPath: string, dstPath: string }} */e) => {
          console.log(`Copy ${e.srcPath} to ${e.dstPath}`)
        })
        w.on('remove', (/** @type{{ path: string }} */e) => {
          console.log(`Remove ${e.path}`)
        })
        w.on('watch-error', (/** @type{Error} */err) => {
          console.log(`Copy error: ${err.message}`)
        })
      })
    })

    // --- chokidar page/layout/template watcher ---
    const ig = ignore().add(opts.ignore ?? [])
    const anymatch = (/** @type {string} */name) => ig.ignores(relname(src, name))

    const watcher = chokidar.watch(src, {
      /**
       * @param {string} filePath
       * @param {Stats} [stats]
       * @returns {boolean}
       */
      ignored: (filePath, stats) => {
        return (
          anymatch(filePath) ||
          Boolean((stats?.isFile() && !/\.(js|mjs|cjs|ts|mts|cts|css|html|md)$/.test(filePath)))
        )
      },
      persistent: true,
    })

    this.#watcher = watcher
    await once(watcher, 'ready')

    watcher.on('add', async path => {
      console.log(`File ${path} has been added`)
      await fullRebuild()
    })

    watcher.on('unlink', async path => {
      console.log(`File ${path} has been removed`)
      await fullRebuild()
    })

    watcher.on('change', async path => {
      assert(src)
      assert(dest)
      console.log(`File ${path} has been changed`)

      const fileName = basename(path)
      const absPath = resolve(path)

      // 1. global.vars.* — data change, rebuild all pages
      if (globalVarsNames.has(fileName)) {
        console.log('global.vars changed, rebuilding all pages...')
        runPageBuild().catch(errorLogger)
        return
      }

      // 2. global.data.* — data aggregation change, rebuild all pages
      if (globalDataNames.has(fileName)) {
        console.log('global.data changed, rebuilding all pages...')
        runPageBuild().catch(errorLogger)
        return
      }

      // 3. esbuild.settings.* — full esbuild context restart + all pages
      if (esbuildSettingsNames.has(fileName)) {
        console.log('esbuild.settings changed, restarting esbuild...')
        await fullRebuild()
        return
      }

      // 4. markdown-it.settings.* — rebuild all .md pages only (rendering change)
      if (markdownItSettingsNames.has(fileName)) {
        const mdPages = new Set(siteData.pages.filter(p => p.type === 'md'))
        console.log(`markdown-it.settings changed, rebuilding ${mdPages.size} .md page(s)...`)
        runPageBuild(mdPages).catch(errorLogger)
        return
      }

      // 5. Layout file changed — rendering change
      if (layoutFileMap.has(absPath)) {
        const layoutName = /** @type {string} */ (layoutFileMap.get(absPath))
        const affectedPages = layoutPageMap.get(layoutName) ?? new Set()
        console.log(`Layout "${layoutName}" changed, rebuilding ${affectedPages.size} page(s)...`)
        runPageBuild(affectedPages).catch(errorLogger)
        return
      }

      // 6. Dep of a layout changed — rendering change
      if (layoutDepMap.has(absPath)) {
        const affectedLayoutNames = /** @type {Set<string>} */ (layoutDepMap.get(absPath))
        /** @type {Set<PageInfo>} */
        const affectedPages = new Set()
        for (const layoutName of affectedLayoutNames) {
          for (const pageInfo of (layoutPageMap.get(layoutName) ?? [])) {
            affectedPages.add(pageInfo)
          }
        }
        console.log(`Layout dep "${fileName}" changed, rebuilding ${affectedPages.size} page(s)...`)
        runPageBuild(affectedPages).catch(errorLogger)
        return
      }

      // 7. Page file or page.vars changed — data change, rebuild that page
      if (pageFileMap.has(absPath)) {
        const affectedPage = /** @type {PageInfo} */ (pageFileMap.get(absPath))
        console.log(`Page "${relname(src, path)}" changed, rebuilding page...`)
        runPageBuild(new Set([affectedPage])).catch(errorLogger)
        return
      }

      // 8. Template file changed — rebuild that template only
      if (templateSuffixes.some(s => fileName.endsWith(s))) {
        const affectedTemplate = siteData.templates.find(t => t.templateFile.filepath === absPath)
        if (affectedTemplate) {
          console.log(`Template "${fileName}" changed, rebuilding template...`)
          runPageBuild(new Set(), new Set([affectedTemplate])).catch(errorLogger)
          return
        }
      }

      // 9. Layout style/client (.layout.css, .layout.client.*) — esbuild watches these,
      // onEnd will fire a full page rebuild automatically. Nothing to do here.

      // 10. Unrecognized — skip
      console.log(`"${fileName}" changed but did not match any rebuild rule, skipping.`)
    })

    watcher.on('error', errorLogger)

    return report
  }

  async stopWatching () {
    if ((!this.watching || !this.#cpxWatchers)) throw new Error('Not watching')
    if (this.#watcher) this.#watcher.close()
    this.#cpxWatchers.forEach(w => {
      w.close()
    })
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose()
      this.#esbuildContext = null
    }
    this.#watcher = null
    this.#cpxWatchers = null
    this.#browserSyncServer?.exit() // This will kill the process
    this.#browserSyncServer = null
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
 * An error logger
 * @param  {Error | AggregateError | any } err The error to log
 */
function errorLogger (err) {
  if (!(err instanceof Error || err instanceof AggregateError)) throw new Error('Non-error thrown', { cause: err })
  if ('results' in err) delete err.results
  console.error(inspect(err, { depth: 999, colors: true }))

  console.log('\nBuild Failed!\n\n')
  console.error(err)
}

/**
 * An build logger
 * @param  {PageBuildStepResult | Results} results
 */
function buildLogger (results) {
  if (results?.warnings?.length > 0) {
    console.log('\nThere were build warnings:\n')
  }
  for (const warning of results?.warnings ?? []) {
    if ('message' in warning) {
      console.log(`  ${warning.message}`)
    } else {
      console.warn(warning)
    }
  }

  if ('siteData' in results) {
    console.log(`Pages: ${results.siteData.pages.length} Layouts: ${Object.keys(results.siteData.layouts).length} Templates: ${results.siteData.templates.length}`)
  } else {
    console.log(`Pages built: ${results.report?.pages?.length ?? 0} Templates built: ${results.report?.templates?.length ?? 0}`)
  }
  console.log('\nBuild Success!\n\n')
}
