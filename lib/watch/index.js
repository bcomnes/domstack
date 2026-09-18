/// <reference path="../../types/thread-stream.d.ts" preserve="true" />

/**
 * @import { DomStackOpts, Results, SiteData } from '../builder.js'
 * @import { FSWatcher } from 'chokidar'
 * @import { PageBuildStepResult } from '../build-pages/index.js'
 * @import { BsInstance } from '@domstack/sync'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { DisposableBuildContext } from '../build-esbuild/index.js'
 * @import { WatchDependencyState } from '../build-pages/global-data/watch-dependencies.js'
 * @import { WatchSnapshot, WatchEvent, WatchPlan } from './plan.js'
 * @import { GlobalDataBaseline, GlobalDataInputChanges } from '../build-pages/global-data/global-data-state.js'
 * @import { MarkdownPreparationState } from '../build-pages/source-preparation/markdown-cache.js'
 * @import { DependencyObservation } from './dependency-index.js'

 * @typedef {object} WatchSession
 * @property {'starting' | 'watching' | 'stopping'} state
 * @property {AbortController} cancellation - Cancels event waits, not resource acquisition.
 * @property {Promise<unknown>} startupWork - The current resource-acquiring startup phase; never the user callback.
 * @property {Promise<void> | null} shutdown - Shared by explicit stops and startup failure cleanup.
 * @property {WatchEvent[]} pendingEvents
 * @property {boolean} drainScheduled
 * @property {GlobalDataBaseline | null} globalDataBaseline
 * @property {MarkdownPreparationState | null} markdownPreparation
 * @property {PageWorkerPool} pageWorkers
 */
import { once } from 'events'
import { setImmediate } from 'node:timers/promises'

import chokidar from 'chokidar'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import ignore from 'ignore'
import { watch as cpxWatch } from 'cpx2'

import { createServer } from '@domstack/sync'

import { getCopyGlob } from '../build-static/index.js'
import { getCopyDirs } from '../build-copy/index.js'
import { buildEsbuildWatch } from '../build-esbuild/index.js'
import { PageWorkerPool } from '../build-pages/worker/page-worker-pool.js'
import { identifyPages } from '../identify-pages.js'
import { classifyWatchEvent, planWatchEvent, planWatchBatch, planBundleChange } from './plan.js'
import { ensureDest } from '../helpers/ensure-dest.js'
import { DomStackAggregateError } from '../helpers/domstack-aggregate-error.js'
import { PageOutputLedger } from './page-output-ledger.js'
import { WatchDependencyIndex } from './dependency-index.js'
import { buildLogger, errorLogger, logRebuildTree } from './logging.js'
import { applyMarkdownPreparationUpdate } from '../build-pages/source-preparation/markdown-cache.js'

/** Internal watch coordinator, retained across sessions by the public DomStack facade. */
export class DomStackWatcher {
  /** @type {string} */ #src = ''
  /** @type {string} */ #dest = ''
  /** @type {() => Readonly<DomStackOpts>} */ #getOptions
  /** @type {FSWatcher?} */ #watcher = null
  /** @type {ReturnType<typeof cpxWatch>[]} */ #cpxWatchers = []
  /** @type {BsInstance?} */ #syncServer = null
  /** @type {DisposableBuildContext?} */ #esbuildContext = null
  /** @type {SiteData?} */ #siteData = null
  /** @type {PinoLogger} */ #logger

  /** @type {WatchDependencyIndex} */ #dependencies
  /** @type {DependencyObservation} */ #isDependencyObserved = () => false
  /** @type {Set<string> | null} Lazy watcher membership snapshot for one analysis pass. */
  #observedDependencyPaths = null
  /** @type {PageOutputLedger} */ #outputs
  /** @type {WatchDependencyState | null} subscriptions and fingerprints from the last successful page build */
  #watchDependencies = null
  /** @type {boolean} Failed builds may leave the previous routing state incomplete. */
  #pageBuildFailed = false

  // One session owns the resources above until shutdown finishes.
  // Normal path: absent → starting → watching → stopping → absent.
  // Startup failure or cancellation: starting → stopping → absent.
  /** @type {WatchSession | null} */
  #watchSession = null

  // Serialized lock so concurrent chokidar events don't pile up
  /** @type {Promise<void>} */
  #buildLock = Promise.resolve()

  /**
   * @param {string} src
   * @param {string} dest
   * @param {() => Readonly<DomStackOpts>} getOptions - Read the facade's current options, including replacements.
   * @param {PinoLogger} logger
   */
  constructor (src, dest, getOptions, logger) {
    this.#src = src
    this.#dest = dest
    this.#getOptions = getOptions
    this.#logger = logger
    this.#dependencies = new WatchDependencyIndex(logger)
    this.#outputs = new PageOutputLedger(dest)
  }

  get opts () {
    return this.#getOptions()
  }

  /** True from the start of watch() until shutdown completes, including startup. */
  get watching () {
    return this.#watchSession !== null
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
      pendingEvents: [],
      drainScheduled: false,
      globalDataBaseline: null,
      markdownPreparation: null,
      pageWorkers: new PageWorkerPool(),
    }
    this.#watchSession = session
    this.#dependencies.clearAnalysis()
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
    const preparation = this.#prepareWatch(session)
    session.startupWork = preparation
    const report = await preparation
    if (signal.aborted) return report

    await onInitialBuild?.(report)
    if (signal.aborted) return report

    if (serve) {
      session.startupWork = this.#startWatchServer()
      await session.startupWork
      if (signal.aborted) return report
    }

    session.state = 'watching'
    this.#scheduleWatchBatch(session)
    if (!session.pendingEvents.length) session.pageWorkers.warm()

    return report
  }

  /** @param {WatchSession} session */
  async #prepareWatch (session) {
    const { signal } = session.cancellation
    // Establish observation before discovery. Initial scan adds are not edits;
    // subsequent events stay buffered until startup and the user callback finish.
    await this.#createSourceWatcher(session)
    // ── Initial build (inline, not via builder()) ────────────────────────
    const siteData = await identifyPages(this.#src, this.opts)

    if (siteData.errors.length > 0) {
      throw new DomStackAggregateError(siteData.errors, 'Page walk finished but there were errors.', siteData)
    }

    await ensureDest(this.#dest, siteData)

    // Start esbuild in watch mode (stable filenames, no hash)
    let esbuildContext
    try {
      const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts, { logger: this.#logger })
      esbuildContext = context
    } catch (err) {
      throw new Error('Error starting esbuild watch context', { cause: err })
    }
    this.#esbuildContext = esbuildContext
    this.#siteData = siteData

    // Build pages (initial full build)
    let report
    try {
      const pageBuildResults = await session.pageWorkers.build(this.#src, this.#dest, siteData, {
        ...this.opts,
        trackWatchDependencies: true,
      })
      await this.#acceptPageBuild(siteData, pageBuildResults, { filtered: false })
      report = {
        warnings: [...siteData.warnings, ...pageBuildResults.warnings],
        siteData,
        pageBuildResults,
      }
      buildLogger(report, this.#logger)
      this.#logger.debug('Initial JS, CSS and Page Build Complete')
    } catch (err) {
      if (!(err instanceof DomStackAggregateError)) throw new Error('Non-aggregate error thrown', { cause: err })
      this.#pageBuildFailed = true
      report = err.results
      errorLogger(err, this.#logger)
      // Failed initial builds still need discovery-based routing for recovery.
      await this.#dependencies.rebuild(siteData)
    }

    // Copy readiness is cancellable: cpx2 invalidates pending scans on close.
    const copyDirs = getCopyDirs(this.opts.copy ?? [])
    const copyStartup = await Promise.allSettled([
      this.#startCopyWatcher(getCopyGlob(this.#src), signal, this.opts.ignore ?? []),
      ...copyDirs.map(copyDir => this.#startCopyWatcher(copyDir, signal)),
    ])
    const copyErrors = copyStartup.filter(result => result.status === 'rejected').map(result => result.reason)
    if (copyErrors.length) throw new AggregateError(copyErrors, 'Copy watch startup failed')

    return report
  }

  /** @param {WatchSession} session */
  #createSourceWatcher (session) {
    const { signal } = session.cancellation
    const ig = ignore().add(this.opts.ignore ?? [])

    const anymatch = (/** @type {string} */name) => ig.ignores(relname(this.#src, name))
    const sourceRoot = resolve(this.#src)
    let reliable = true
    const watcher = chokidar.watch(this.#src, {
      // Observe non-page extensions too (for example statically imported JSON).
      // Route only processed files and known dependencies after maps are ready.
      ignored: filePath => anymatch(filePath),
      persistent: true,
      ignoreInitial: true,
      // Increase the atomic write window so editors that do slow atomic saves
      // (write to a temp file then rename) emit a `change` event rather than
      // `unlink` + `add`, which would otherwise trigger unnecessary full rebuilds.
      atomic: 300,
    })

    this.#watcher = watcher
    const observing = () => reliable && this.#watchSession === session && session.state !== 'stopping' && !watcher.closed
    this.#isDependencyObserved = async filepath => {
      if (!observing()) return false
      const name = relative(sourceRoot, filepath)
      if (!name || name === '..' || name.startsWith(`..${sep}`) || isAbsolute(name) || anymatch(filepath)) return false
      try {
        // Matching the final path is insufficient: traversal can exclude a parent,
        // and Chokidar also ignores atomic-save paths. Require actual membership.
        // Snapshot lazily once per analysis pass, not once per dependency. Events
        // invalidate it and the index epoch prevents in-flight cache publication.
        this.#observedDependencyPaths ??= new Set(Object.entries(watcher.getWatched())
          .flatMap(([directory, names]) => names.map(name => resolve(directory, name))))
        if (!this.#observedDependencyPaths.has(filepath)) return false
        // Missing inputs and symlink aliases cannot establish complete coverage.
        // Observation may also be lost while realpath is pending.
        return await realpath(filepath) === filepath && observing()
      } catch {
        return false
      }
    }
    const record = (/** @type {string} */ path, /** @type {WatchEvent['type']} */ type) => {
      if (session.state === 'stopping' || this.#watchSession !== session) return
      const event = classifyWatchEvent(type, path)
      this.#dependencies.recordEvent(event)
      this.#observedDependencyPaths = null
      session.pendingEvents.push(event)
      this.#scheduleWatchBatch(session)
    }
    watcher.on('add', path => record(path, 'added'))
    watcher.on('change', path => record(path, 'change'))
    watcher.on('unlink', path => record(path, 'removed'))
    watcher.on('error', err => {
      if (session.state === 'stopping' || this.#watchSession !== session) return
      // Lost observation cannot be repaired merely by one successful analysis pass.
      reliable = false
      this.#observedDependencyPaths = null
      this.#dependencies.clearAnalysis()
      errorLogger(err, this.#logger)
    })
    // Attach the listener before returning; the watcher can become ready before
    // the caller resumes. Cancellation settles this wait even without a ready event.
    return once(watcher, 'ready', { signal }).catch(error => {
      if (!signal.aborted || error.name !== 'AbortError') throw error
    })
  }

  /**
   * @param {string} source
   * @param {AbortSignal} signal
   * @param {string[]} [ignores]
   */
  async #startCopyWatcher (source, signal, ignores = []) {
    const watcher = cpxWatch(source, this.#dest, { ignore: ignores })
    this.#cpxWatchers.push(watcher)
    let ready = false
    let initialCopies = 0
    watcher.on('copy', (/** @type{{ srcPath: string, dstPath: string }} */e) => {
      if (!ready) initialCopies++
      this.#logger.debug(`Copy ${e.srcPath} to ${e.dstPath}`)
      if (ready) this.#logger.info(`Static asset updated: ${e.srcPath}`)
    })
    watcher.on('remove', (/** @type{{ path: string }} */e) => {
      this.#logger.info(`Remove ${e.path}`)
    })
    watcher.on('watch-error', (/** @type{Error} */err) => {
      this.#logger.error(`Copy error: ${err.message}`)
    })

    // cpx2 reports startup failure as "watch-error", not EventEmitter's "error".
    // A closed session may never emit readiness, so cancellation must also settle
    // this wait. This does not drain file operations already started by cpx2.
    const { promise, resolve, reject } = Promise.withResolvers()
    const onAbort = () => resolve(undefined)
    watcher.once('watch-ready', resolve)
    watcher.once('watch-error', reject)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal.aborted) return
      await promise
      ready = true
      if (!signal.aborted) this.#logger.info(`Static asset watcher ready (${initialCopies} initial copy operations)`)
    } finally {
      watcher.off('watch-ready', resolve)
      watcher.off('watch-error', reject)
      signal.removeEventListener('abort', onAbort)
    }
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
  async #fullRebuild (/** @type {GlobalDataInputChanges} */ inputChanges) {
    this.#logger.info('Triggering full rebuild...')
    // Dispose the old esbuild context
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose()
      this.#esbuildContext = null
    }

    const siteData = await identifyPages(this.#src, this.opts)

    if (siteData.errors.length > 0) {
      throw new DomStackAggregateError(siteData.errors, 'Page discovery failed.', siteData)
    }

    await ensureDest(this.#dest, siteData)

    const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts, { logger: this.#logger })
    this.#esbuildContext = context
    this.#siteData = siteData

    await this.#runPageBuild(siteData, null, null, null, inputChanges)
  }

  /** @returns {WatchSnapshot | undefined} */
  #watchSnapshot () {
    if (!this.#siteData) return
    return {
      siteData: this.#siteData,
      ...this.#dependencies.snapshot(),
      pageBuildFailed: this.#pageBuildFailed,
    }
  }

  /** @param {WatchEvent[]} events */
  async #handleWatchBatch (events) {
    const snapshot = this.#watchSnapshot()
    if (!snapshot) return
    events = this.#dependencies.filterEvents(events, { pageBuildFailed: this.#pageBuildFailed })
    const event = events[0]
    if (!event) return
    const { plan, inputChanges } = planWatchBatch(snapshot, events)
    // Bundle replanning can skip page work, so it must not bypass a required reset.
    const singlePlan = inputChanges.resetReason === undefined &&
      events.length === 1 && event.type !== 'change' && event.convention?.bundleScope
      ? planWatchEvent(snapshot, event)
      : null
    await this.#executeWatchPlan(
      snapshot.pageBuildFailed
        ? { kind: 'full', message: 'Rediscovering and retrying all pages after the previous build failure...' }
        : singlePlan?.kind === 'restart' ? singlePlan : plan,
      event, inputChanges
    )
  }

  /**
   * Keep resource ownership and successful-build state updates in the executor.
   * @param {WatchPlan} plan
   * @param {WatchEvent} event
   * @param {GlobalDataInputChanges} inputChanges
   * @returns {Promise<void>}
   */
  async #executeWatchPlan (plan, event, inputChanges) {
    if (plan.message) this.#logger.info(plan.message)
    if (plan.kind === 'skip') return
    if (plan.kind === 'full') {
      await this.#fullRebuild(inputChanges)
      return
    }
    if (plan.kind === 'restart') {
      await this.#restartEsbuildForEvent(event, inputChanges)
      return
    }
    if (!this.#siteData) return
    if (this.#logger.isLevelEnabled?.('info') !== false && (plan.pages || plan.templates)) {
      logRebuildTree(event.name, this.#logger, new Set(plan.pages), new Set(plan.templates))
    }
    await this.#runPageBuild(this.#siteData, plan.pageFilterPaths, plan.templateFilterPaths, plan.pagesFileFilterPaths, inputChanges)
  }

  /** @param {WatchEvent} event @param {GlobalDataInputChanges} inputChanges */
  async #restartEsbuildForEvent (event, inputChanges) {
    const siteData = await identifyPages(this.#src, this.opts)
    if (siteData.errors.length > 0) {
      throw new DomStackAggregateError(siteData.errors, 'Page discovery failed.', siteData)
    }
    await ensureDest(this.#dest, siteData)
    if (this.#esbuildContext) {
      await this.#esbuildContext.dispose()
      this.#esbuildContext = null
    }
    const { context } = await buildEsbuildWatch(this.#src, this.#dest, siteData, this.opts, { logger: this.#logger })
    this.#esbuildContext = context
    this.#siteData = siteData
    const snapshot = this.#watchSnapshot()
    if (!snapshot) return
    const plan = planBundleChange(snapshot, event, this.#src)
    // Successful page builds refresh their own maps. Service workers have no
    // HTML consumers, but their entry map still changes.
    if (plan.kind === 'skip') await this.#dependencies.rebuild(siteData)
    await this.#executeWatchPlan(plan, event, inputChanges)
  }

  /**
   * Run a full or filtered page build with the existing esbuild context.
   *
   * @param {SiteData} siteData
   * @param {string[] | null} [pageFilterPaths]
   * @param {string[] | null} [templateFilterPaths]
   * @param {string[] | null} [pagesFileFilterPaths]
   * @param {GlobalDataInputChanges} [inputChanges]
   */
  async #runPageBuild (siteData, pageFilterPaths = null, templateFilterPaths = null, pagesFileFilterPaths = null, inputChanges) {
    const session = this.#watchSession
    if (!session) throw new Error('Page rebuild requires a watch session')
    // Retry the complete page phase after a failure: neither subscriptions nor
    // layout routing from a failed build can safely drive an incremental retry.
    if (this.#pageBuildFailed) pageFilterPaths = templateFilterPaths = pagesFileFilterPaths = null
    try {
      const pageBuildResults = await session.pageWorkers.build(this.#src, this.#dest, siteData, {
        ...this.opts,
        ...(pageFilterPaths ? { pageFilterPaths } : {}),
        ...(templateFilterPaths ? { templateFilterPaths } : {}),
        ...(pagesFileFilterPaths ? { pagesFileFilterPaths } : {}),
        previousGlobalDataBaseline: this.#watchSession?.globalDataBaseline,
        previousMarkdownPreparation: this.#watchSession?.markdownPreparation,
        globalDataInputChanges: inputChanges,
        previousWatchDependencies: this.#watchDependencies,
        previousPageOutputCache: this.#outputs.cache,
        trackWatchDependencies: true,
      })
      const isFiltered = pageFilterPaths !== null || templateFilterPaths !== null || pagesFileFilterPaths !== null
      await this.#acceptPageBuild(siteData, pageBuildResults, { filtered: isFiltered })
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
   * Account for filesystem effects before accepting a new successful baseline.
   * Used by both initial builds and rebuilds; callers own their error policy.
   * @param {SiteData} siteData
   * @param {PageBuildStepResult} pageBuildResults
   * @param {{ filtered: boolean }} options
   */
  async #acceptPageBuild (siteData, pageBuildResults, { filtered }) {
    const preparationUpdate = pageBuildResults.report.markdownPreparationUpdate
    delete pageBuildResults.report.markdownPreparationUpdate
    this.#outputs.recordWrites(pageBuildResults)
    delete pageBuildResults.report.pageOutputCache
    if (pageBuildResults.errors.length > 0) {
      throw new DomStackAggregateError(pageBuildResults.errors, 'Page build finished but there were errors.', {
        siteData,
        pageBuildResults,
      })
    }

    // A cleanup failure leaves writes recorded, but cannot advance data state.
    await this.#outputs.reconcileSuccessfulBuild(pageBuildResults, { filtered })
    this.#dependencies.recordLayouts(pageBuildResults.report, { filtered })
    try {
      await this.#dependencies.rebuild(siteData, {
        reuseAnalysis: filtered && !this.#pageBuildFailed && this.#watchSession?.state === 'watching',
        isObserved: this.#isDependencyObserved,
      })
    } finally {
      this.#observedDependencyPaths = null
    }
    this.#watchDependencies = pageBuildResults.report.watchDependencies ?? this.#watchDependencies
    if (this.#watchSession) {
      this.#watchSession.globalDataBaseline = pageBuildResults.report.globalDataBaseline ?? null
      // Failed dependency analysis is recoverable, but cannot accept preparation
      // whose next invalidation would depend on incomplete routing information.
      if (!this.#dependencies.snapshot().dependencyAnalysisFailed) {
        this.#watchSession.markdownPreparation = preparationUpdate
          ? applyMarkdownPreparationUpdate(this.#watchSession.markdownPreparation, preparationUpdate)
          : null
      }
    }
    delete pageBuildResults.report.globalDataBaseline
    delete pageBuildResults.report.watchDependencies
    delete pageBuildResults.report.rebuiltPagesFilePaths
    this.#pageBuildFailed = false
  }

  /** @param {WatchSession} session */
  #scheduleWatchBatch (session) {
    if (session.state !== 'watching' || session.drainScheduled || !session.pendingEvents.length) return
    session.drainScheduled = true
    this.#buildLock = this.#buildLock.then(async () => {
      try {
        while (session.state === 'watching' && session.pendingEvents.length) {
          // Coalesce the current event-loop turn, then detach. Events observed
          // during asynchronous build work belong to the next batch, never this one.
          await setImmediate()
          if (session.state !== 'watching') break
          const events = session.pendingEvents
          session.pendingEvents = []
          try {
            await this.#handleWatchBatch(events)
          } catch (err) {
            this.#pageBuildFailed = true
            errorLogger(err, this.#logger)
          }
        }
      } finally {
        session.drainScheduled = false
        // Speculate only after the entire batch drain, never alongside page work.
        if (this.#watchSession === session && session.state === 'watching' && !session.pendingEvents.length) {
          session.pageWorkers.warm()
        }
      }
    })
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
    session.pageWorkers.stopWarming()
    this.#dependencies.clearAnalysis()
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
      Promise.resolve().then(() => session.pageWorkers.close()),
      Promise.resolve().then(() => this.#esbuildContext?.dispose()),
      Promise.resolve().then(() => this.#syncServer?.exit()),
    ]))
    session.pendingEvents = []
    session.globalDataBaseline = null
    session.markdownPreparation = null
    this.#dependencies.clearAnalysis()
    this.#isDependencyObserved = () => false
    this.#observedDependencyPaths = null
    this.#watchDependencies = null
    this.#pageBuildFailed = false
    this.#watcher = null
    this.#cpxWatchers = []
    this.#esbuildContext = null
    this.#syncServer = null
    this.#siteData = null
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
