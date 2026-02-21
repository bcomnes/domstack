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
 * @import { PageBuildStepResult } from './lib/build-pages/index.js'
*/
import { once } from 'events'
import { cpus } from 'os'
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
import { identifyPages, globalVarsNames, globalDataNames, esbuildSettingsNames, markdownItSettingsNames, templateSuffixes } from './lib/identify-pages.js'
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

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

const DEFAULT_IGNORES = /** @type {const} */ ([
  '.*',
  'coverage',
  'node_modules',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])


/**
 * Find transitive ESM dependencies of a file.
 * @param {string} filepath
 * @returns {Promise<string[]>}
 */
async function findDepsOf (filepath) {
  try {
    return await findDeps(filepath)
  } catch (err) {
    console.warn(`Warning: could not resolve deps of ${filepath}:`, err instanceof Error ? err.message : err)
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
 *   pageDepMap: Map<string, Set<PageInfo>>,
 *   templateDepMap: Map<string, Set<TemplateInfo>>,
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
  /** @type {Map<string, Set<PageInfo>>} depFilepath -> Set<PageInfo> */
  const pageDepMap = new Map()
  /** @type {Map<string, Set<TemplateInfo>>} depFilepath -> Set<TemplateInfo> */
  const templateDepMap = new Map()

  // Build layoutDepMap and layoutFileMap via static dep analysis
  await pMap(Object.values(siteData.layouts), async (layout) => {
    layoutFileMap.set(layout.filepath, layout.layoutName)
    const deps = await findDepsOf(layout.filepath)
    for (const dep of deps) {
      if (!layoutDepMap.has(dep)) layoutDepMap.set(dep, new Set())
      layoutDepMap.get(dep)?.add(layout.layoutName)
    }
  }, { concurrency: MAX_CONCURRENCY })

  // Build layoutPageMap, pageFileMap, and pageDepMap by resolving each page's layout var
  // and static dep analysis of its page file and page.vars file.
  // This runs in the main process — ESM cache is acceptable since we only need
  // to know the layout name string, not call the module.
  await pMap(siteData.pages, async (pageInfo) => {
    pageFileMap.set(pageInfo.pageFile.filepath, pageInfo)
    if (pageInfo.pageVars) pageFileMap.set(pageInfo.pageVars.filepath, pageInfo)

    const pageVars = await resolveVars({ varsPath: pageInfo.pageVars?.filepath }).catch(() => ({}))
    const layoutName = String((/** @type {Record<string, any>} */ (pageVars))['layout'] ?? 'root')

    if (!layoutPageMap.has(layoutName)) layoutPageMap.set(layoutName, new Set())
    layoutPageMap.get(layoutName)?.add(pageInfo)

    // Track transitive deps of page.js and page.vars so changes to shared modules trigger a page rebuild
    const filesToTrack = [pageInfo.pageFile.filepath]
    if (pageInfo.pageVars) filesToTrack.push(pageInfo.pageVars.filepath)
    for (const file of filesToTrack) {
      const deps = await findDepsOf(file)
      for (const dep of deps) {
        if (!pageDepMap.has(dep)) pageDepMap.set(dep, new Set())
        pageDepMap.get(dep)?.add(pageInfo)
      }
    }
  }, { concurrency: MAX_CONCURRENCY })

  // Build templateDepMap via static dep analysis of each template file
  await pMap(siteData.templates, async (templateInfo) => {
    const deps = await findDepsOf(templateInfo.templateFile.filepath)
    for (const dep of deps) {
      if (!templateDepMap.has(dep)) templateDepMap.set(dep, new Set())
      templateDepMap.get(dep)?.add(templateInfo)
    }
  }, { concurrency: MAX_CONCURRENCY })

  return { layoutDepMap, layoutPageMap, pageFileMap, layoutFileMap, pageDepMap, templateDepMap }
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
      /** @type {DomStackOpts} */
      const buildOpts = { ...opts }
      if (pageFilter) buildOpts.pageFilterPaths = [...pageFilter].map(p => p.pageFile.filepath)
      if (templateFilter) buildOpts.templateFilterPaths = [...templateFilter].map(t => t.templateFile.filepath)
      try {
        const pageBuildResults = await buildPages(src, dest, siteData, buildOpts)

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
      // Stable filenames in watch mode mean page HTML doesn't change when bundles rebuild.
      // Browser-sync reloads the browser directly — no page rebuild needed.
      console.log('esbuild rebuilt JS/CSS')
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
    let { layoutDepMap, layoutPageMap, pageFileMap, layoutFileMap, pageDepMap, templateDepMap } = await buildWatchMaps(siteData)

    const rebuildMaps = async () => {
      const maps = await buildWatchMaps(siteData)
      layoutDepMap = maps.layoutDepMap       // depFilepath -> Set<layoutName>
      layoutPageMap = maps.layoutPageMap     // layoutName -> Set<PageInfo>
      pageFileMap = maps.pageFileMap         // pageFile/pageVars filepath -> PageInfo
      layoutFileMap = maps.layoutFileMap     // layout filepath -> layoutName
      pageDepMap = maps.pageDepMap           // depFilepath -> Set<PageInfo> (via page.js + page.vars deps)
      templateDepMap = maps.templateDepMap   // depFilepath -> Set<TemplateInfo>
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
      const fileName = basename(path)
      const absPath = resolve(path)

      // 1. global.vars.* — always do a full rebuild. The `browser` key is read by
      // buildEsbuild() in the main process and passed to esbuild as `define` substitutions.
      // esbuild's own watcher does NOT track global.vars as an input, so any change could
      // affect bundle output and requires restarting esbuild with fresh `define` values.
      if (globalVarsNames.includes(fileName)) {
        console.log('global.vars changed, running full rebuild...')
        await fullRebuild()
        return
      }

      // 2. global.data.* — data aggregation change, rebuild all pages
      if (globalDataNames.includes(fileName)) {
        console.log('global.data changed, rebuilding all pages...')
        runPageBuild().catch(errorLogger)
        return
      }

      // 3. esbuild.settings.* — full esbuild context restart + all pages
      if (esbuildSettingsNames.includes(fileName)) {
        console.log('esbuild.settings changed, restarting esbuild...')
        await fullRebuild()
        return
      }

      // 4. markdown-it.settings.* — rebuild all .md pages only (rendering change)
      if (markdownItSettingsNames.includes(fileName)) {
        const mdPages = new Set(siteData.pages.filter(p => p.type === 'md'))
        logRebuildTree(fileName, mdPages)
        runPageBuild(mdPages).catch(errorLogger)
        return
      }

      // 5. Layout file changed — rendering change
      if (layoutFileMap.has(absPath)) {
        const layoutName = /** @type {string} */ (layoutFileMap.get(absPath))
        const affectedPages = layoutPageMap.get(layoutName) ?? new Set()
        logRebuildTree(fileName, affectedPages)
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
        logRebuildTree(fileName, affectedPages)
        runPageBuild(affectedPages).catch(errorLogger)
        return
      }

      // 7. Page file or page.vars changed — data change, rebuild that page
      if (pageFileMap.has(absPath)) {
        const affectedPage = /** @type {PageInfo} */ (pageFileMap.get(absPath))
        logRebuildTree(relname(src, path), new Set([affectedPage]))
        runPageBuild(new Set([affectedPage])).catch(errorLogger)
        return
      }

      // 8. Template file changed — rebuild that template only
      if (templateSuffixes.some(s => fileName.endsWith(s))) {
        const affectedTemplate = siteData.templates.find(t => t.templateFile.filepath === absPath)
        if (affectedTemplate) {
          logRebuildTree(fileName, undefined, new Set([affectedTemplate]))
          runPageBuild(new Set(), new Set([affectedTemplate])).catch(errorLogger)
          return
        }
      }

      // 9. Dep of a page.js or page.vars file — data change, rebuild affected pages
      if (pageDepMap.has(absPath)) {
        const affectedPages = /** @type {Set<PageInfo>} */ (pageDepMap.get(absPath))
        logRebuildTree(fileName, affectedPages)
        runPageBuild(new Set([...affectedPages])).catch(errorLogger)
        return
      }

      // 10. Dep of a template file — rebuild affected templates only
      if (templateDepMap.has(absPath)) {
        const affectedTemplates = /** @type {Set<TemplateInfo>} */ (templateDepMap.get(absPath))
        logRebuildTree(fileName, undefined, affectedTemplates)
        runPageBuild(new Set(), affectedTemplates).catch(errorLogger)
        return
      }

      // 11. Any JS/CSS bundle (client.js, page.css, .layout.css, .layout.client.*, etc.)
      // esbuild's own watcher picks these up and rebuilds the bundle. Since watch mode
      // uses stable (unhashed) filenames, page HTML doesn't change — browser-sync reloads
      // the browser directly. Nothing to do here.
      const esbuildEntryPoints = new Set([
        siteData.globalClient?.filepath,
        siteData.globalStyle?.filepath,
        ...siteData.pages.flatMap(p => [p.clientBundle?.filepath, p.pageStyle?.filepath, ...Object.values(p.workers ?? {}).map(w => w.filepath)]),
        ...Object.values(siteData.layouts).flatMap(l => [l.layoutClient?.filepath, l.layoutStyle?.filepath]),
      ].filter(Boolean))
      if (esbuildEntryPoints.has(absPath)) {
        console.log(`"${fileName}" changed — esbuild will rebuild (browser-sync will reload)`)
        return
      }

      // 12. Unrecognized — skip
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
 * Log a rebuild tree showing what triggered a rebuild and what will be rebuilt.
 * @param {string} trigger - The changed file (display name)
 * @param {Set<PageInfo>} [pages]
 * @param {Set<import('./lib/identify-pages.js').TemplateInfo>} [templates]
 */
function logRebuildTree (trigger, pages, templates) {
  const lines = [`"${trigger}" changed:`]
  for (const p of pages ?? []) {
    lines.push(`  → ${p.outputRelname}`)
  }
  for (const t of templates ?? []) {
    lines.push(`  → ${t.outputName} (template)`)
  }
  console.log(lines.join('\n'))
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
