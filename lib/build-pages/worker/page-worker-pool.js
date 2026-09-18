/**
 * @import { WorkerOptions } from 'node:worker_threads'
 * @import { PageBuildStep, PageBuildStepResult } from '../index.js'
 * @import { WorkerBuildMessage } from './protocol.js'
 */

import { Worker } from 'node:worker_threads'
import { restoreWorkerResult, workerBuildOptions } from './protocol.js'

/** @typedef {(url: URL, options: WorkerOptions) => Worker} WorkerFactory */

const defaultWorkerURL = new URL('./worker.js', import.meta.url)

function executionContext () {
  return { cwd: process.cwd(), env: { ...process.env }, execArgv: [...process.execArgv] }
}

function hasStartupImports () {
  // Preloads/loaders can import site modules before our ready handshake. Skip
  // speculation rather than impose a new application contract or alter flags.
  // Removing quotes deliberately allows false positives in NODE_OPTIONS values.
  const options = [...process.execArgv, process.env['NODE_OPTIONS'] ?? ''].join(' ').replace(/["']/g, '')
  return /(?:^|\s)(?:--(?:import|require|loader|experimental[-_]loader)|-r)/.test(options)
}

/** @param {ReturnType<typeof executionContext>} previous */
function contextIsCurrent (previous) {
  const current = executionContext()
  return previous.cwd === current.cwd &&
    previous.execArgv.length === current.execArgv.length &&
    previous.execArgv.every((arg, index) => arg === current.execArgv[index]) &&
    Object.keys(previous.env).length === Object.keys(current.env).length &&
    Object.keys(previous.env).every(key => Object.hasOwn(current.env, key) && previous.env[key] === current.env[key])
}

/** A worker may execute application code exactly once, even when that job fails. */
class PageWorker {
  context = executionContext()
  /** @type {Worker | undefined} */
  worker
  /** @type {'starting' | 'ready' | 'running' | 'settled'} */
  state = 'starting'
  /** @type {PromiseWithResolvers<void>} */
  readiness = Promise.withResolvers()
  /** @type {PromiseWithResolvers<PageBuildStepResult>} */
  result = Promise.withResolvers()
  /** @type {PromiseWithResolvers<void>} */
  retirement = Promise.withResolvers()
  /** @type {Promise<void> | undefined} */
  retiring

  constructor () {
    // Speculation and failures between ready and dispatch must always be observed.
    this.readiness.promise.catch(() => {})
    this.result.promise.catch(() => {})
    this.retirement.promise.catch(() => {})
  }

  /** @param {WorkerFactory} factory @param {URL} url */
  start (factory, url) {
    try {
      // Let Node inherit execArgv, including preloads. Passing the same array
      // explicitly rejects process-only flags that Node can otherwise inherit.
      this.worker = factory(url, { env: this.context.env })
      this.worker.on('message', this.onMessage)
      this.worker.on('error', this.onError)
      this.worker.on('messageerror', this.onMessageError)
      this.worker.on('exit', this.onExit)
    } catch (error) {
      this.fail(error)
    }
  }

  /** @param {unknown} message */
  onMessage = (message) => {
    if (this.state === 'settled') return
    try {
      if (this.state === 'starting' && message && typeof message === 'object' &&
          'type' in message && message.type === 'ready') {
        this.state = 'ready'
        this.readiness.resolve()
      } else if (this.state === 'running') {
        const result = restoreWorkerResult(message)
        // terminate() normally emits exit 1. Accept the result before retiring.
        this.state = 'settled'
        this.result.resolve(result)
        this.retire()
      } else {
        throw new Error('Unexpected page worker protocol message')
      }
    } catch (error) {
      this.fail(error)
    }
  }

  /** @param {unknown} error */
  onError = (error) => { this.fail(error) }
  /** @param {unknown} error */
  onMessageError = (error) => { this.fail(new Error('Page worker message could not be deserialized', { cause: error })) }
  /** @param {number} code */
  onExit = (code) => { this.fail(new Error(`Page worker exited before result (exit code ${code})`)) }

  /** @param {unknown} error */
  fail (error) {
    if (this.state === 'settled') return
    this.state = 'settled'
    this.readiness.reject(error)
    this.result.reject(error)
    this.retire()
  }

  /** @param {WorkerBuildMessage} message */
  async dispatch (message) {
    try {
      if (this.state !== 'ready' || !this.worker) throw new Error('Page worker is not ready')
      this.state = 'running'
      this.worker.postMessage(message)
    } catch (error) {
      this.fail(error)
    }
    try {
      return await this.result.promise
    } finally {
      await this.retire()
    }
  }

  retire () {
    if (this.retiring) return this.retiring
    this.retiring = this.retirement.promise
    if (this.state !== 'settled') {
      this.state = 'settled'
      const error = new Error('Page worker retired before result')
      this.readiness.reject(error)
      this.result.reject(error)
    }
    // Keep every listener installed until termination finishes, including on errors.
    const worker = this.worker
    const cleanup = () => {
      worker?.off('message', this.onMessage)
      worker?.off('error', this.onError)
      worker?.off('messageerror', this.onMessageError)
      worker?.off('exit', this.onExit)
    }
    try {
      const termination = worker?.terminate()
      Promise.resolve(termination).then(() => {
        cleanup()
        this.retirement.resolve()
      }, error => {
        cleanup()
        this.retirement.reject(error)
      })
    } catch (error) {
      cleanup()
      this.retirement.reject(error)
    }
    return this.retiring
  }
}

/**
 * Internal watch-session prototype. Only unused workers can be prewarmed;
 * application state is never reused. Construction itself does not warm.
 */
export class PageWorkerPool {
  /** @type {PageWorker | undefined} */
  #idle
  /** @type {Set<PageWorker>} */
  #workers = new Set()
  /** @type {Set<Promise<PageBuildStepResult>>} */
  #builds = new Set()
  /** @type {unknown[]} */
  #retirementErrors = []
  #warming = true
  #closed = false
  /** @type {Promise<void> | undefined} */
  #closing
  #factory
  #url

  /**
   * Injection is internal to this module, not a public build option.
   * @param {{ workerFactory?: WorkerFactory, workerURL?: URL }} [options]
   */
  constructor ({ workerFactory = (url, options) => new Worker(url, options), workerURL = defaultWorkerURL } = {}) {
    this.#factory = workerFactory
    this.#url = workerURL
  }

  /** @param {boolean} idle */
  #create (idle) {
    const worker = new PageWorker()
    // Reserve ownership before construction/readiness can fail or be observed.
    this.#workers.add(worker)
    if (idle) this.#idle = worker
    worker.retirement.promise.then(() => {
      this.#forget(worker)
    }, error => {
      this.#retirementErrors.push(error)
      this.#forget(worker)
    })
    worker.start(this.#factory, this.#url)
    return worker
  }

  /** @param {PageWorker} worker */
  #forget (worker) {
    this.#workers.delete(worker)
    if (this.#idle === worker) this.#idle = undefined
  }

  /** Speculative, idempotent, and never automatically retried on failure. */
  warm () {
    if (!this.#warming || this.#closed || this.#workers.size || this.#builds.size || hasStartupImports()) return
    try {
      this.#create(true)
    } catch {
      // A context snapshot can fail too (for example, a deleted cwd).
    }
  }

  /** @type {PageBuildStep} */
  build = (src, dest, siteData, opts) => {
    if (this.#closed) return Promise.reject(new Error('Page worker pool is closed'))
    // Consuming the slot happens before any await, including readiness.
    const idle = this.#idle
    this.#idle = undefined
    const build = this.#run(idle, src, dest, siteData, opts)
    this.#builds.add(build)
    const forget = () => { this.#builds.delete(build) }
    build.then(forget, forget)
    return build
  }

  /**
   * @param {PageWorker | undefined} worker
   * @param {Parameters<PageBuildStep>} args
   * @returns {Promise<PageBuildStepResult>}
   */
  async #run (worker, ...args) {
    let speculative = !!worker
    try {
      while (true) {
        worker ??= this.#create(false)
        try {
          await worker.readiness.promise
          if (worker.state !== 'ready') await worker.result.promise
        } catch (error) {
          await worker.retire()
          if (!speculative) throw error
          worker = undefined
          speculative = false
          continue
        }
        // Build the payload before checking context: option getters may mutate it.
        const [src, dest, siteData, opts] = args
        const message = { type: /** @type {const} */ ('build'), src, dest, siteData, opts: workerBuildOptions(opts) }
        // No await between this check and postMessage. Readiness may have taken
        // arbitrarily long; checking only when consuming the idle slot is unsafe.
        if (!contextIsCurrent(worker.context)) {
          await worker.retire()
          worker = undefined
          speculative = false
          continue
        }
        return await worker.dispatch(message)
      }
    } finally {
      await worker?.retire()
    }
  }

  /** Disable speculation, but allow already-draining pipelines to call build. */
  stopWarming () {
    this.#warming = false
    const idle = this.#idle
    this.#idle = undefined
    if (idle) idle.retire()
  }

  /** Disable new builds and wait for all owned work, including retiring workers. */
  close () {
    if (this.#closing) return this.#closing
    this.#closed = true
    this.stopWarming()
    this.#closing = (async () => {
      await Promise.allSettled([...this.#builds])
      await Promise.allSettled([...this.#workers].map(worker => worker.retirement.promise))
      if (this.#retirementErrors.length) throw new AggregateError(this.#retirementErrors, 'Page worker retirement failed')
    })()
    return this.#closing
  }
}
