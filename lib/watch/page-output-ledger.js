/**
 * @import { PageReport, WorkerBuildStepResult } from '../build-pages/index.js'
 * @import { PageOutputCache } from '../build-pages/page-builders/page-output-writer.js'
 */
import { lstat, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertInsideDest } from '../helpers/path.js'

/** Internal output ownership and write cache, retained across watch sessions. */
export class PageOutputLedger {
  /** @type {string} */ #dest
  /** @type {Map<string, Set<string>>} source page or *.pages.* filepath → owned absolute output paths */
  #pageOutputMap = new Map()
  /** @type {Map<string, Set<string>>} template filepath → currently claimed absolute output paths */
  #templateOutputMap = new Map()
  /** @type {PageOutputCache} Successful writes, including those before an iterator failure. */
  #pageOutputCache = new Map()

  /** @param {string} dest */
  constructor (dest) {
    this.#dest = resolve(dest)
  }

  /** @returns {PageOutputCache} */
  get cache () {
    return this.#pageOutputCache
  }

  /**
   * Record every worker result, including successful builds before reconciliation.
   * Union writes with prior ownership so failures cannot orphan emitted files.
   * Report fields remain available to the caller.
   * @param {Pick<WorkerBuildStepResult, 'report'>} results
   */
  recordWrites (results) {
    this.#pageOutputCache = results.report.pageOutputCache ?? this.#pageOutputCache
    mergePageOutputs(this.#dest, results.report.pages, this.#pageOutputMap)
  }

  /**
   * Reconcile a successful page phase after recordWrites. Untouched page and
   * template owners still protect their outputs during targeted builds.
   * Ownership replacement and cache pruning commit only after cleanup succeeds.
   * @param {Pick<WorkerBuildStepResult, 'report' | 'outputs'>} results
   * @param {{ filtered: boolean }} options
   */
  async reconcileSuccessfulBuild (results, { filtered }) {
    const dest = this.#dest
    const pages = mergePageOutputs(dest, results.report.pages)
    let templates = filtered ? this.#templateOutputMap : new Map()
    if (filtered && results.report.templates.length) templates = new Map(templates)

    if (filtered) {
      // Factories can successfully rebuild to zero pages; regular pages always
      // report their HTML output, even when their page-output hook is gone.
      const rebuiltFactories = new Set(results.report.rebuiltPagesFilePaths)
      for (const [owner, outputs] of this.#pageOutputMap) {
        if (!pages.has(owner) && !rebuiltFactories.has(owner)) pages.set(owner, outputs)
      }
    }
    for (const report of results.report.templates) {
      const outputs = new Set()
      for (const output of report.outputs) outputs.add(resolve(dest, report.templateInfo.path, output))
      templates.set(report.templateInfo.templateFile.filepath, outputs)
    }

    const otherClaims = new Set()
    const pageOwnedPaths = new Set()
    for (const outputs of pages.values()) {
      for (const filepath of outputs) pageOwnedPaths.add(filepath)
    }
    for (const output of results.outputs) {
      const filepath = resolve(dest, output.outputRelname)
      if (!pageOwnedPaths.has(filepath)) otherClaims.add(filepath)
    }
    for (const outputs of templates.values()) {
      for (const filepath of outputs) {
        if (!pageOwnedPaths.has(filepath)) otherClaims.add(filepath)
      }
    }
    const stale = new Set()
    for (const [owner, outputs] of this.#pageOutputMap) {
      // Untouched owners retain the same set, so none of their files can be stale.
      if (pages.get(owner) === outputs) continue
      for (const filepath of outputs) {
        if (!pageOwnedPaths.has(filepath) && !otherClaims.has(filepath)) stale.add(filepath)
      }
    }
    for (const filepath of stale) await removeStalePageOutput(dest, filepath)

    for (const filepath of this.#pageOutputCache.keys()) {
      if (!pageOwnedPaths.has(filepath)) this.#pageOutputCache.delete(filepath)
    }
    this.#pageOutputMap = pages
    this.#templateOutputMap = templates
  }
}

/**
 * @param {string} dest
 * @param {Pick<PageReport, 'sourcePageFilePath' | 'pagesFilePath' | 'outputs'>[]} pageReports
 * @param {Map<string, Set<string>>} [outputsByOwner]
 * @returns {Map<string, Set<string>>}
 */
function mergePageOutputs (dest, pageReports, outputsByOwner = new Map()) {
  for (const report of pageReports) {
    const owner = report.pagesFilePath ?? report.sourcePageFilePath
    if (!owner) continue
    let outputs = outputsByOwner.get(owner)
    if (!outputs) {
      outputs = new Set()
      outputsByOwner.set(owner, outputs)
    }
    for (const output of report.outputs ?? []) outputs.add(resolve(dest, output.outputRelname))
  }
  return outputsByOwner
}

/**
 * Never follow a replaced output directory outside the destination. A symlink
 * at the output itself is safe to unlink; directories are never removed.
 * @param {string} dest
 * @param {string} filepath
 */
async function removeStalePageOutput (dest, filepath) {
  assertInsideDest(dest, filepath)
  if (filepath === dest) throw new Error('Refusing to remove the build destination')
  try {
    for (let ancestor = dirname(filepath); ; ancestor = dirname(ancestor)) {
      const stats = await lstat(ancestor)
      if (stats.isSymbolicLink() || !stats.isDirectory()) return
      if (ancestor === dest) break
    }
    const stats = await lstat(filepath)
    if (!stats.isDirectory()) await rm(filepath, { force: true })
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err
  }
}
