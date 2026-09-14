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
 * @import { WatchSnapshot, WatchEvent, WatchPlan } from './lib/watch-plan.js'
 * @import { OutputClaim } from './lib/output-registry.js'
 * @import { PageBuildStepResult } from './lib/build-pages/index.js'
 * @typedef {{ dispose: () => Promise<void> }} DisposableBuildContext
 * @typedef {{ pageFilePath: string, sourcePageFilePath?: string | undefined, pagesFilePath?: string | undefined, layoutNames: string[], outputs?: DomstackManifestRecord[] | undefined }} WatchedPageReport
 * @typedef {object} WatchSession
 * @property {'starting' | 'watching' | 'stopping'} state
 * @property {AbortController} cancellation - Cancels event waits, not resource acquisition.
 * @property {Promise<unknown>} startupWork - The current resource-acquiring startup phase; never the user callback.
 * @property {Promise<void> | null} shutdown - Shared by explicit stops and startup failure cleanup.
 */
import { once } from 'events'
import assert from 'node:assert'
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import chokidar from 'chokidar'
import { basename, dirname, join, relative, resolve } from 'node:path'
// @ts-expect-error
import makeArray from 'make-array'
import ignore from 'ignore'
import { watch as cpxWatch } from 'cpx2'
import { inspect } from 'util'
import { createServer } from '@domstack/sync'
import { find } from '@11ty/dependency-tree-typescript'

import { assertInsideDest, toPosix } from './lib/helpers/path.js'
import { getCopyGlob } from './lib/build-static/index.js'
import { getCopyDirs } from './lib/build-copy/index.js'
import { isProcessedFile, globalBundleAssets, pageBundleAssets, layoutBundleAssets } from './lib/file-conventions.js'
import { builder } from './lib/builder.js'
import { buildEsbuildWatch } from './lib/build-esbuild/index.js'
import { buildPages } from './lib/build-pages/index.js'
import { identifyPages } from './lib/identify-pages.js'
import { classifyWatchEvent, planWatchEvent, planBundleChange } from './lib/watch-plan.js'
import { DomStackAggregateError } from './lib/helpers/domstack-aggregate-error.js'
import { createDomStackLogger } from './lib/logger.js'
import { OutputRegistry, isCaseInsensitiveDest } from './lib/output-registry.js'

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
  /** @type {ReturnType<typeof cpxWatch>[]} */ #cpxWatchers = []
  /** @type {string[]} */ #cpxWatchStages = []
  /** @type {Map<string, () => Promise<void>>} */ #pendingCopyUpdates = new Map()
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

  /** @type {Map<string, Set<string>>} *.pages.* filepath → layouts used by its generated pages */
  #pagesFileLayoutMap = new Map()
  /** @type {WatchDependencyState | null} subscriptions and fingerprints from the last successful page build */
  #watchDependencies = null
  /** @type {boolean} Failed builds may leave the previous routing state incomplete. */
  #pageBuildFailed = false
  /** @type {OutputClaim[]} Output ownership from the latest successful watch build. */
  #outputClaims = []
  #outputLock = Promise.resolve()
  #caseInsensitive = false
  /** @type {string | null} Unpublished initial watch outputs, retained for recovery. */
  #initialStage = null

  // One session owns the resources above until shutdown finishes.
  // Normal path: absent → starting → watching → stopping → absent.
  // Startup failure or cancellation: starting → stopping → absent.
  /** @type {WatchSession | null} */
  #watchSession = null

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

  /** True from the start of watch() until shutdown completes, including startup. */
  get watching () {
    return this.#watchSession !== null
  }

  build () {
    return builder(this.#src, this.#dest, { static: true, ...this.opts })
  }

  /**
   * Build and watch a domstack build
   *
   * Stopping during startup still returns the initial build report, but does not
   * activate watch events. Await stopWatching() for completed resource cleanup.
   *
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
    /** @type {WatchSession} */
    const session = {
      state: 'starting',
      cancellation: new AbortController(),
      startupWork: Promise.resolve(),
      shutdown: null,
    }
    this.#watchSession = session
    try {
      return await this.#startWatch(session, { serve, onInitialBuild })
    } catch (error) {
      try {
        await this.#stopWatchSession(session)
      } catch (cleanupError) {
        // The callback may already be propagating this same shutdown failure.
        if (error === cleanupError) throw error
        throw new AggregateError([error, cleanupError], 'Watch startup and cleanup failed')
      }
      throw error
    }
  }

  /**
   * Resource acquisition must finish before shutdown can release its results.
   * Readiness waits, on the other hand, must be cancelled when watchers close.
   * The user callback is outside the acquisition phases so it can await a stop.
   *
   * @param {WatchSession} session
   * @param {{ serve: boolean, onInitialBuild: ((results: Results) => void | Promise<void>) | undefined }} params
   */
  async #startWatch (session, { serve, onInitialBuild }) {
    const { signal } = session.cancellation
    const preparation = this.#prepareWatch(signal)
    session.startupWork = preparation
    const { report, watcher, ready } = await preparation

    await ready
    if (signal.aborted) return report

    await onInitialBuild?.(report)
    if (signal.aborted) return report

    if (serve) {
      session.startupWork = this.#startWatchServer()
      await session.startupWork
      if (signal.aborted) return report
    }

    session.state = 'watching'
    for (const update of this.#pendingCopyUpdates.values()) this.#enqueueBuild(session, update)
    this.#pendingCopyUpdates.clear()
    const enqueue = (/** @type {() => Promise<unknown>} */ fn) => {
      this.#enqueueBuild(session, fn)
    }

    watcher.on('add', path => {
      enqueue(() => this.#handleWatchEvent(path, 'added'))
    })
    watcher.on('change', path => {
      assert(this.#src)
      assert(this.#dest)
      enqueue(() => this.#handleWatchEvent(path, 'change'))
    })
    watcher.on('unlink', path => {
      enqueue(() => this.#handleWatchEvent(path, 'removed'))
    })
    watcher.on('error', err => errorLogger(err, this.#logger))

    return report
  }

  /** @param {AbortSignal} signal */
  async #prepareWatch (signal) {
    // ── Initial build (inline, not via builder()) ────────────────────────
    const siteData = await identifyPages(this.#src, this.opts)

    if (siteData.errors.length > 0) {
      throw new DomStackAggregateError(siteData.errors, 'Page walk finished but there were errors.', siteData)
    }

    await mkdir(this.#dest, { recursive: true })
    this.#initialStage = await mkdtemp(join(resolve(this.#dest), '.domstack-stage-'))

    this.#caseInsensitive = await isCaseInsensitiveDest(this.#dest)
    // The watchers' initial inventories are the only copy scan at startup.
    const copyDirs = getCopyDirs(this.opts.copy ?? [])
    const copyStartup = await Promise.allSettled([
      ...(this.opts.static === false ? [] : [this.#startCopyWatcher(getCopyGlob(this.#src), signal, 'static', this.opts.ignore ?? [])]),
      ...copyDirs.map((copyDir, index) => this.#startCopyWatcher(copyDir, signal, 'copy', [], `copy-root:${index}:`)),
    ])
    const copyErrors = copyStartup.filter(result => result.status === 'rejected').map(result => result.reason)
    if (copyErrors.length) throw new AggregateError(copyErrors, 'Copy watch startup failed')
    await this.#drainPendingCopyUpdates()

    // Start esbuild in watch mode (stable filenames, no hash)
    let esbuildContext
    try {
      const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts, {
        logger: this.#logger,
        writeDest: () => this.#initialStage ?? this.#dest,
        promoteOutputs: (outputs, phase, write) => this.#promoteEsbuildOutputs(outputs, phase, write),
      })
      esbuildContext = context
    } catch (err) {
      throw new Error('Error starting esbuild watch context', { cause: err })
    }
    this.#esbuildContext = esbuildContext
    this.#siteData = siteData

    await this.#drainPendingCopyUpdates()
    // Build pages (initial full build)
    let report
    try {
      const pageBuildResults = await buildPages(this.#src, this.#initialStage ?? this.#dest, siteData, {
        ...this.opts,
        trackWatchDependencies: true,
        previousOutputClaims: this.#outputClaims,
        caseInsensitive: this.#caseInsensitive,
        promoteOutputs: (report, write) => this.#promotePageOutputs(report, write),
      })
      this.#remapInitialPageReport(pageBuildResults)
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

      this.#pagesFileLayoutMap = getPagesFileLayoutMap(pageBuildResults.report.pages)
      this.#updatePageLayoutNames(pageBuildResults.report.pages, true)
      this.#pageBuildFailed = false
      this.#watchDependencies = pageBuildResults.report.watchDependencies ?? null
      delete pageBuildResults.report.newClaims
      delete pageBuildResults.report.replacedOwnerIds
      delete pageBuildResults.report.watchDependencies
      delete pageBuildResults.report.rebuiltPagesFilePaths
      buildLogger(report, this.#logger)
      this.#logger.debug('Initial JS, CSS and Page Build Complete')
    } catch (err) {
      if (!(err instanceof DomStackAggregateError)) throw new Error('Non-aggregate error thrown', { cause: err })
      this.#pageBuildFailed = true
      report = err.results
      errorLogger(err, this.#logger)
    }

    // Build watch maps after initial build
    await this.#rebuildMaps(siteData)

    // Copy readiness is cancellable: cpx2 invalidates pending scans on close.
    await this.#drainPendingCopyUpdates()
    if (!signal.aborted && !this.#pageBuildFailed) await this.#publishInitialStage()
    await this.#drainPendingCopyUpdates()

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
          Boolean((stats?.isFile() && !isProcessedFile(filePath)))
        )
      },
      persistent: true,
      // Increase the atomic write window so editors that do slow atomic saves
      // (write to a temp file then rename) emit a `change` event rather than
      // `unlink` + `add`, which would otherwise trigger unnecessary full rebuilds.
      atomic: 300,
    })

    this.#watcher = watcher
    // Attach the listener before returning; the watcher can become ready before
    // the caller resumes. Cancellation settles this wait even without a ready event.
    const ready = once(watcher, 'ready', { signal }).catch(error => {
      if (!signal.aborted || error.name !== 'AbortError') throw error
    })

    return { report, watcher, ready }
  }

  /**
   * @param {string} source
   * @param {AbortSignal} signal
   * @param {'static' | 'copy'} kind
   * @param {string[]} [ignores]
   * @param {string} [ownerPrefix] - Matches buildCopy's configured root identity.
   */
  async #startCopyWatcher (source, signal, kind, ignores = [], ownerPrefix = '') {
    const stageDest = await mkdtemp(join(this.#dest, '.domstack-copy-watch-'))
    this.#cpxWatchStages.push(stageDest)
    const watcher = cpxWatch(source, stageDest, { ignore: ignores })
    this.#cpxWatchers.push(watcher)
    // Isolate each source before cpx writes, including case and file/dir aliases.
    // Retain cpx's logical mapping; only its private physical destination changes.
    const toDestination = watcher.toDestination
    const logicalOutputs = new Map()
    watcher.toDestination = sourcePath => {
      const path = join(stageDest, createHash('sha256').update(sourcePath).digest('hex'))
      logicalOutputs.set(path, toPosix(relative(stageDest, toDestination(sourcePath))))
      return path
    }
    const ownerByOutput = new Map()
    let ready = false
    let initialCopies = 0
    watcher.on('copy', (/** @type{{ srcPath: string, dstPath: string }} */e) => {
      const outputRelname = logicalOutputs.get(e.dstPath)
      const sourceRelname = toPosix(relative(this.#src, resolve(e.srcPath)))
      const owner = { id: `${ownerPrefix}${kind}:${sourceRelname}`, type: kind, path: sourceRelname }
      ownerByOutput.set(e.dstPath, owner)
      if (!ready) initialCopies++
      this.#logger.debug(`Copy ${e.srcPath} to ${e.dstPath}`)
      if (this.#watchSession) {
        const update = async () => {
          try {
            await stat(e.srcPath)
            await this.#promoteCopyOutput(e.dstPath, outputRelname, owner)
          } catch (error) {
            if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
            await this.#removeCopyOutput(outputRelname, owner)
          }
        }
        if (!ready || this.#watchSession.state === 'starting') this.#pendingCopyUpdates.set(e.dstPath, update)
        else this.#enqueueBuild(this.#watchSession, update)
      }
    })
    watcher.on('remove', (/** @type{{ path: string }} */e) => {
      const outputRelname = logicalOutputs.get(e.path)
      const owner = ownerByOutput.get(e.path)
      ownerByOutput.delete(e.path)
      if (owner && this.#watchSession) {
        const update = () => this.#removeCopyOutput(outputRelname, owner)
        if (!ready || this.#watchSession.state === 'starting') this.#pendingCopyUpdates.set(e.path, update)
        else this.#enqueueBuild(this.#watchSession, update)
      }
    })
    watcher.on('watch-error', (/** @type{Error} */err) => {
      this.#logger.error(`Copy error: ${err.message}`)
    })

    // cpx2 reports startup failure as "watch-error", not EventEmitter's "error".
    // A closed session may never emit readiness, so cancellation must also settle
    // this wait. This does not drain file operations already started by cpx2.
    const { promise, resolve: resolveReady, reject } = Promise.withResolvers()
    const onAbort = () => resolveReady(undefined)
    watcher.once('watch-ready', resolveReady)
    watcher.once('watch-error', reject)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal.aborted) return
      await promise
      if (signal.aborted) return
      ready = true
      this.#logger.info(`Static asset watcher ready (${initialCopies} initial copy operations)`)
    } finally {
      watcher.off('watch-ready', resolveReady)
      watcher.off('watch-error', reject)
      signal.removeEventListener('abort', onAbort)
    }
  }

  async #drainPendingCopyUpdates () {
    while (this.#pendingCopyUpdates.size > 0) {
      const updates = [...this.#pendingCopyUpdates.values()]
      this.#pendingCopyUpdates.clear()
      for (const update of updates) await update()
    }
  }

  /**
   * Serialize ownership checks, promotion, and commits independently of the
   * watch build queue: esbuild callbacks also run during queued context startup.
   * @param {() => OutputClaim[]} nextClaims
   * @param {() => Promise<void>} write
   */
  #commitOutputs (nextClaims, write) {
    const transaction = this.#outputLock.then(async () => {
      const next = nextClaims()
      const paths = new Set(next.map(claim => claim.outputRelname))
      for (const claim of this.#outputClaims) {
        if (paths.has(claim.outputRelname)) continue
        const writeDest = this.#initialStage ?? this.#dest
        const target = resolve(writeDest, claim.outputRelname)
        assertInsideDest(writeDest, target)
        await rm(target, { force: true })
        // Only remove empty directories; never recursively delete unowned files.
        for (let dir = dirname(target); dir !== resolve(writeDest); dir = dirname(dir)) {
          try { await rmdir(dir) } catch { break }
        }
      }
      await write()
      this.#outputClaims = next
    })
    this.#outputLock = transaction.catch(() => {})
    return transaction
  }

  /** Publish initial watch outputs only once every initial producer succeeds. */
  async #publishInitialStage () {
    const publish = this.#outputLock.then(async () => {
      if (!this.#initialStage) return
      await mkdir(this.#dest, { recursive: true })
      await cp(this.#initialStage, await realpath(this.#dest), { recursive: true, force: true })
      await rm(this.#initialStage, { recursive: true, force: true })
      this.#initialStage = null
    })
    this.#outputLock = publish.catch(() => {})
    await publish
  }

  /** @param {PageBuildStepResult} result */
  #remapInitialPageReport (result) {
    if (!this.#initialStage) return
    for (const output of result.outputs) output.filepath = resolve(this.#dest, output.outputRelname)
    for (const page of result.report.pages) page.pageFilePath = resolve(this.#dest, relative(this.#initialStage, page.pageFilePath))
  }

  /**
   * @param {DomstackManifestRecord[]} outputs
   * @param {'browser' | 'service-worker'} phase
   * @param {() => Promise<void>} write
   */
  #promoteEsbuildOutputs (outputs, phase, write) {
    return this.#commitOutputs(() => replaceEsbuildClaims(this.#outputClaims, outputs, phase, this.#caseInsensitive), write)
  }

  /**
   * Revalidate the worker's selected producers against current ownership, not
   * its possibly stale pre-render snapshot.
   * @param {PageBuildStepResult} report
   * @param {() => Promise<void>} write
   */
  #promotePageOutputs (report, write) {
    return this.#commitOutputs(() => {
      const replaced = new Set(report.report.replacedOwnerIds ?? [])
      const registry = new OutputRegistry(this.#outputClaims, { replaceOwnerIds: replaced, caseInsensitive: this.#caseInsensitive })
      for (const claim of report.report.newClaims ?? []) registry.claim(claim.outputRelname, claim.owner)
      return registry.snapshot()
    }, write)
  }

  /**
   * @param {string} stagedPath
   * @param {string} outputRelname
   * @param {{ id: string, type: string, path: string }} owner
   */
  async #promoteCopyOutput (stagedPath, outputRelname, owner) {
    await this.#commitOutputs(() => {
      const registry = new OutputRegistry(this.#outputClaims, { replaceOwnerIds: [owner.id], caseInsensitive: this.#caseInsensitive })
      registry.claim(outputRelname, owner)
      return registry.snapshot()
    }, async () => {
      const writeDest = this.#initialStage ?? this.#dest
      const target = resolve(writeDest, outputRelname)
      assertInsideDest(writeDest, target)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(stagedPath, target)
    })
    this.#logger.info(`Static asset updated: ${owner.path}`)
  }

  /**
   * @param {string} outputRelname
   * @param {{ id: string, type: string, path: string }} owner
   */
  async #removeCopyOutput (outputRelname, owner) {
    await this.#commitOutputs(() => this.#outputClaims.filter(claim => claim.owner.id !== owner.id || claim.outputRelname !== outputRelname), async () => {})
    this.#logger.info(`Remove ${outputRelname}`)
  }

  async #startWatchServer () {
    this.#syncServer = await createServer({
      server: this.#dest,
      files: basename(this.#dest),
      ignore: ['**/domstack-esbuild-meta.json'],
      logger: this.#logger.child({ component: 'sync', logPrefix: '[domstack-sync]' }),
    })
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

    try {
      const results = await builder(this.#src, this.#dest, { ...this.opts, domstackManifest: false }, {
        watch: true,
        caseInsensitive: this.#caseInsensitive,
        promoteOutputs: (claims, write) => this.#commitOutputs(() => claims, write),
      })
      if (this.#initialStage) {
        await rm(this.#initialStage, { recursive: true, force: true })
        this.#initialStage = null
      }
      const { siteData, pageBuildResults } = results
      this.#siteData = siteData
      if (pageBuildResults) {
        this.#updatePageLayoutNames(pageBuildResults.report.pages, true)
        this.#pagesFileLayoutMap = getPagesFileLayoutMap(pageBuildResults.report.pages)
        this.#watchDependencies = pageBuildResults.report.watchDependencies ?? null
      }
      this.#pageBuildFailed = false
      const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts, {
        logger: this.#logger,
        promoteOutputs: (outputs, phase, write) => this.#promoteEsbuildOutputs(outputs, phase, write),
      })
      this.#esbuildContext = context
      await this.#rebuildMaps(siteData)
      buildLogger(results, this.#logger)
    } catch (error) {
      this.#pageBuildFailed = true
      throw error
    }
  }

  /** @returns {WatchSnapshot | undefined} */
  #watchSnapshot () {
    if (!this.#siteData) return
    return {
      siteData: this.#siteData,
      layoutDepMap: this.#layoutDepMap,
      layoutPageMap: this.#layoutPageMap,
      pageFileMap: this.#pageFileMap,
      layoutFileMap: this.#layoutFileMap,
      pageDepMap: this.#pageDepMap,
      templateDepMap: this.#templateDepMap,
      pagesFileDepMap: this.#pagesFileDepMap,
      pagesFileLayoutMap: this.#pagesFileLayoutMap,
      globalDataDepPaths: this.#globalDataDepPaths,
      pageBuildFailed: this.#pageBuildFailed,
      esbuildEntryPoints: this.#esbuildEntryPoints,
    }
  }

  /**
   * @param {string} changedPath
   * @param {'change' | 'added' | 'removed'} type
   */
  async #handleWatchEvent (changedPath, type) {
    const snapshot = this.#watchSnapshot()
    if (!snapshot) return
    if (!this.#esbuildContext) {
      await this.#fullRebuild()
      return
    }
    const event = classifyWatchEvent(type, changedPath)
    await this.#executeWatchPlan(planWatchEvent(snapshot, event), event)
  }

  /**
   * Keep resource ownership and successful-build state updates in the executor.
   * @param {WatchPlan} plan
   * @param {WatchEvent} event
   * @returns {Promise<void>}
   */
  async #executeWatchPlan (plan, event) {
    if (plan.message) this.#logger.info(plan.message)
    if (plan.kind === 'skip') return
    if (plan.kind === 'full') {
      await this.#fullRebuild()
      return
    }
    if (plan.kind === 'restart') {
      await this.#restartEsbuildForEvent(event)
      return
    }
    if (!this.#siteData) return
    if (plan.pages || plan.templates) {
      logRebuildTree(event.name, this.#logger, new Set(plan.pages), new Set(plan.templates))
    }
    await this.#runPageBuild(this.#siteData, plan.pageFilterPaths, plan.templateFilterPaths, plan.pagesFileFilterPaths)
  }

  /** @param {WatchEvent} event */
  async #restartEsbuildForEvent (event) {
    const siteData = await identifyPages(this.#src, this.opts)
    if (siteData.errors.length > 0) {
      this.#logger.error(`identifyPages errors:\n${siteData.errors.map(err => ` ${err.message}`).join('\n')}`)
      return
    }
    await mkdir(this.#dest, { recursive: true })
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose()
      this.#esbuildContext = null
    }
    const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts, {
      logger: this.#logger,
      writeDest: () => this.#initialStage ?? this.#dest,
      promoteOutputs: (outputs, phase, write) => this.#promoteEsbuildOutputs(outputs, phase, write),
    })
    this.#esbuildContext = context
    this.#siteData = siteData
    const snapshot = this.#watchSnapshot()
    if (!snapshot) return
    const plan = planBundleChange(snapshot, event, this.#src)
    // Successful page builds refresh their own maps. Service workers have no
    // HTML consumers, but their entry map still changes.
    if (plan.kind === 'skip') await this.#rebuildMaps(siteData)
    await this.#executeWatchPlan(plan, event)
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
      const pageBuildResults = await buildPages(this.#src, this.#initialStage ?? this.#dest, siteData, {
        ...this.opts,
        ...(pageFilterPaths ? { pageFilterPaths } : {}),
        ...(templateFilterPaths ? { templateFilterPaths } : {}),
        ...(pagesFileFilterPaths ? { pagesFileFilterPaths } : {}),
        previousWatchDependencies: this.#watchDependencies,
        trackWatchDependencies: true,
        previousOutputClaims: this.#outputClaims,
        caseInsensitive: this.#caseInsensitive,
        promoteOutputs: (report, write) => this.#promotePageOutputs(report, write),
      })
      this.#remapInitialPageReport(pageBuildResults)
      if (pageBuildResults.errors.length > 0) {
        throw new DomStackAggregateError(pageBuildResults.errors, 'Page build finished but there were errors.', {
          siteData,
          pageBuildResults,
        })
      }
      await this.#publishInitialStage()
      const isFiltered = pageFilterPaths !== null || templateFilterPaths !== null || pagesFileFilterPaths !== null
      this.#updatePageLayoutNames(pageBuildResults.report.pages, !isFiltered)
      if (!isFiltered) {
        this.#pagesFileLayoutMap = getPagesFileLayoutMap(pageBuildResults.report.pages)
      } else if ((pageBuildResults.report.rebuiltPagesFilePaths?.length ?? 0) > 0) {
        updatePagesFileLayoutMap(this.#pagesFileLayoutMap, pageBuildResults.report.rebuiltPagesFilePaths ?? [], pageBuildResults.report.pages)
      }
      this.#watchDependencies = pageBuildResults.report.watchDependencies ?? this.#watchDependencies
      delete pageBuildResults.report.newClaims
      delete pageBuildResults.report.replacedOwnerIds
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
   * @param {WatchSession} session
   * @param {() => Promise<unknown>} fn
   */
  #enqueueBuild (session, fn) {
    if (session.state !== 'watching') return
    this.#buildLock = this.#buildLock.then(async () => {
      if (session.state !== 'watching') return
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
    for (const asset of globalBundleAssets(siteData)) esbuildEntryPoints.add(resolve(asset.filepath))
    if (siteData.serviceWorker) esbuildEntryPoints.add(resolve(siteData.serviceWorker.filepath))
    for (const page of siteData.pages) {
      for (const asset of pageBundleAssets(page)) esbuildEntryPoints.add(resolve(asset.filepath))
    }
    for (const layout of Object.values(siteData.layouts)) {
      for (const asset of layoutBundleAssets(layout)) esbuildEntryPoints.add(resolve(asset.filepath))
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
   * Cancel startup/event waits, drain owned work, and release the session.
   * The user callback is not drained: it may itself be awaiting this stop.
   * Concurrent stops share cleanup; a new watch may start once cleanup settles.
   */
  async stopWatching () {
    if (!this.#watchSession) throw new Error('Not watching')
    return this.#stopWatchSession(this.#watchSession)
  }

  /** @param {WatchSession} session */
  #stopWatchSession (session) {
    // Retain this promise on the session even after cleanup. An old callback may
    // finish or throw after a new session starts; it must not clean up that session.
    if (session.shutdown) return session.shutdown
    session.state = 'stopping'
    session.cancellation.abort()
    session.shutdown = this.#disposeWatchResources(session)
    return session.shutdown
  }

  /** @param {WatchSession} session */
  async #disposeWatchResources (session) {
    // 1. Drain resource acquisition. No new startup phase may begin after a stop.
    //    watch() reports startup errors; shutdown still releases partial resources.
    await session.startupWork.catch(() => {})

    // 2. Stop filesystem producers. The session state already rejects new and
    //    queued rebuilds, including callbacks retained by a previous watch session.
    const closures = [
      () => this.#watcher?.close(),
      ...this.#cpxWatchers.map(w => () => w.close()),
    ]
    const results = await Promise.allSettled(closures.map(close => Promise.resolve().then(close)))

    // 3. Drain the active rebuild before releasing the esbuild context it may replace.
    results.push(...await Promise.allSettled([this.#buildLock]))

    // 4. Release the final contexts and server, even if another cleanup step failed.
    results.push(...await Promise.allSettled([
      Promise.resolve().then(() => this.#esbuildContext?.dispose()),
      Promise.resolve().then(() => this.#syncServer?.exit()),
    ]))
    await this.#outputLock
    results.push(...await Promise.allSettled([...this.#cpxWatchStages, ...(this.#initialStage ? [this.#initialStage] : [])].map(stage => rm(stage, { recursive: true, force: true }))))
    this.#initialStage = null
    this.#watcher = null
    this.#cpxWatchers = []
    this.#cpxWatchStages = []
    this.#pendingCopyUpdates.clear()
    this.#esbuildContext = null
    this.#syncServer = null
    this.#siteData = null
    this.#outputClaims = []
    this.#buildLock = Promise.resolve()
    this.#watchSession = null
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length > 0) throw new AggregateError(errors, 'Watch cleanup failed')
  }

  /**
   * Returns a promise that resolves when all queued rebuilds have finished.
   * @returns {Promise<void>}
   */
  async settled () {
    await this.#buildLock
    await this.#outputLock
  }
}

/**
 * @param {OutputClaim[]} claims
 * @param {DomstackManifestRecord[]} outputs
 * @param {'browser' | 'service-worker'} phase
 * @param {boolean} caseInsensitive
 * @returns {OutputClaim[]}
 */
function replaceEsbuildClaims (claims, outputs, phase, caseInsensitive) {
  const prefix = `esbuild:${phase}:`
  const replaceOwnerIds = claims.filter(claim => claim.owner.id.startsWith(prefix)).map(claim => claim.owner.id)
  const registry = new OutputRegistry(claims, { replaceOwnerIds, caseInsensitive })
  registry.claimRecords(outputs, prefix)
  return registry.snapshot()
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
  logger.error('Build Failed!')
}

/**
 * Log build results.
 * @param  {Partial<Results> | WorkerBuildStepResult} results
 * @param {PinoLogger} logger
 * @param  {string} [dest] - dest path for relativizing output paths in filtered builds
 */
function buildLogger (results, logger, dest) {
  if ((results?.warnings?.length ?? 0) > 0) {
    logger.warn('There were build warnings:')
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
  logger.info('Build Success!')
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
