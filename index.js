/// <reference path="./types/thread-stream.d.ts" preserve="true" />

/**
 * @import { DomStackOpts, Results } from './lib/builder.js'
 * @import { TestBuildResult } from './types.js'

 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'

import { builder } from './lib/builder.js'
import { createDomStackLogger } from './lib/logger.js'
import { DomStackWatcher } from './lib/watch/index.js'

export { PageData } from './lib/build-pages/page/page-data.js'
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
  /** @type {DomStackWatcher} */ #watcher

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
    const logger = opts.logger ?? createDomStackLogger()
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

    // Reuse the coordinator so output ownership survives stop/start cycles.
    this.#watcher = new DomStackWatcher(src, dest, () => this.opts, logger)
  }

  /** True from the start of watch() until shutdown completes, including startup. */
  get watching () {
    return this.#watcher.watching
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
  async watch (params = { serve: true }) {
    return this.#watcher.watch(params)
  }

  /**
   * Cancel startup/event waits, drain owned work, and release the session.
   * The user callback is not drained: it may itself be awaiting this stop.
   * Concurrent stops share cleanup; a new watch may start once cleanup settles.
   * @returns {Promise<void>}
   */
  async stopWatching () {
    return this.#watcher.stopWatching()
  }

  /**
   * Returns a promise that resolves when all queued rebuilds have finished.
   * @returns {Promise<void>}
   */
  async settled () {
    await this.#watcher.settled()
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
      ...[buildOpts.ignore ?? []].flat(),
    ],
  }
}
