/**
 * @import { DomStackOpts as DomStackOpts, Results } from './lib/builder.js'
 * @import { FSWatcher, Stats } from 'node:fs'
 * @import { PostVarsFunction, AsyncPostVarsFunction, AsyncLayoutFunction, LayoutFunction } from './lib/build-pages/page-data.js'
 * @import { PageFunction, AsyncPageFunction } from './lib/build-pages/page-builders/page-writer.js'
 * @import { TemplateFunction } from './lib/build-pages/page-builders/template-builder.js'
 * @import { TemplateAsyncIterator } from './lib/build-pages/page-builders/template-builder.js'
 * @import { TemplateOutputOverride } from './lib/build-pages/page-builders/template-builder.js'
 * @import { BuildOptions } from 'esbuild'
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

import { getCopyGlob } from './lib/build-static/index.js'
import { getCopyDirs } from './lib/build-copy/index.js'
import { builder } from './lib/builder.js'
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
 * @template {Record<string, any>} Vars - The type of variables for the post vars function
 * @template [PageReturn=any] PageReturn - The return type of the page function (defaults to any)
 * @template [LayoutReturn=string] LayoutReturn - The return type of the layout function (defaults to string)
 * @typedef {PostVarsFunction<Vars, PageReturn, LayoutReturn>} PostVarsFunction
 */

/**
 * @template {Record<string, any>} Vars - The type of variables for the async post vars function
 * @template [PageReturn=any] PageReturn - The return type of the page function (defaults to any)
 * @template [LayoutReturn=string] LayoutReturn - The return type of the layout function (defaults to string)
 * @typedef {AsyncPostVarsFunction<Vars, PageReturn, LayoutReturn>} AsyncPostVarsFunction
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
 * @template {DomStackOpts} [CurrentOpts=DomStackOpts] - The type of options for the DomStack instance
 */
export class DomStack {
  /** @type {string} */ #src = ''
  /** @type {string} */ #dest = ''
  /** @type {Readonly<CurrentOpts & { ignore: string[] }>} */ opts
  /** @type {FSWatcher?} */ #watcher = null
  /** @type {any[]?} */ #cpxWatchers = null
  /** @type {browserSync.BrowserSyncInstance?} */ #browserSyncServer = null

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

    /** @type Results */
    let report

    try {
      report = await builder(this.#src, this.#dest, { ...this.opts, static: false })
      console.log('Initial JS, CSS and Page Build Complete')
    } catch (err) {
      errorLogger(err)
      if (!(err instanceof DomStackAggregateError)) throw new Error('Non-aggregate error thrown', { cause: err })
      report = err.results
    }

    const copyDirs = getCopyDirs(this.opts.copy)

    this.#cpxWatchers = [
      cpx.watch(getCopyGlob(this.#src), this.#dest, { ignore: this.opts.ignore }),
      ...copyDirs.map(copyDir => cpx.watch(copyDir, this.#dest))
    ]
    if (serve) {
      const bs = browserSync.create()
      this.#browserSyncServer = bs
      bs.watch(basename(this.#dest), { ignoreInitial: true }).on('change', bs.reload)
      bs.init({
        server: this.#dest,
      })
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
        // Combine your existing 'anymatch' function with the new extension check
        return (
          anymatch(filePath) ||
          Boolean((stats?.isFile() && !/\.(js|css|html|md)$/.test(filePath)))
        )
      },
      persistent: true,
    })

    this._watcher = watcher

    await once(watcher, 'ready')

    watcher.on('add', path => {
      console.log(`File ${path} has been added`)
      builder(this.#src, this.#dest, { ...this.opts, static: false })
        .then(buildLogger)
        .catch(errorLogger)
    })
    watcher.on('change', path => {
      assert(this.#src)
      assert(this.#dest)
      console.log(`File ${path} has been changed`)
      builder(this.#src, this.#dest, { ...this.opts, static: false })
        .then(buildLogger)
        .catch(errorLogger)
    })
    watcher.on('unlink', path => {
      console.log(`File ${path} has been removed`)
      builder(this.#src, this.#dest, { ...this.opts, static: false })
        .then(buildLogger)
        .catch(errorLogger)
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
 * @param  {Results} results
 */
function buildLogger (results) {
  if (results?.warnings?.length > 0) {
    console.log(
      '\nThere were build warnings:\n'
    )
  }
  for (const warning of results?.warnings) {
    if ('message' in warning) {
      console.log(`  ${warning.message}`)
    } else {
      console.warn(warning)
    }
  }

  console.log(`Pages: ${results.siteData.pages.length} Layouts: ${Object.keys(results.siteData.layouts).length} Templates: ${results.siteData.templates.length}`)
  console.log('\nBuild Success!\n\n')
}
