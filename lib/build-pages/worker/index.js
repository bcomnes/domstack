/**
 * @import { PageBuildStep, PageBuildStepResult } from '../index.js'
 * @import { BuildPagesFilterOptions, WorkerBuildStepResult } from './protocol.js'
 */

import { Worker } from 'worker_threads'
import { join } from 'path'
import { restoreWorkerError } from './protocol.js'

const __dirname = import.meta.dirname

/**
 * Run a page build in a fresh worker so source modules reload between builds.
 *
 * @type {PageBuildStep}
 */
export function buildPages (src, dest, siteData, opts) {
  // Only page-build filters cross the worker boundary. General build options
  // can contain functions (manifest hooks and predicates) or logger instances,
  // neither of which can be structured-cloned.
  /** @type {BuildPagesFilterOptions} */
  const workerOpts = {
    pageFilterPaths: opts?.pageFilterPaths,
    templateFilterPaths: opts?.templateFilterPaths,
    pagesFileFilterPaths: opts?.pagesFileFilterPaths,
    buildDrafts: opts?.buildDrafts,
    previousWatchDependencies: opts?.previousWatchDependencies,
    trackWatchDependencies: opts?.trackWatchDependencies,
    previousPageOutputCache: opts?.previousPageOutputCache,
    previousGlobalDataBaseline: opts?.globalDataInputChanges?.resetReason === undefined ? opts?.previousGlobalDataBaseline : undefined,
    globalDataInputChanges: opts?.globalDataInputChanges,
    previousMarkdownPreparation: opts?.trackWatchDependencies && opts.globalDataInputChanges && opts.globalDataInputChanges.resetReason === undefined
      ? opts.previousMarkdownPreparation
      : undefined,
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'worker.js'), {
      workerData: { src, dest, siteData, opts: workerOpts },
    })

    worker.once('message', message => {
      /** @type { WorkerBuildStepResult }  */
      const workerReport = message

      /** @type {PageBuildStepResult} */
      const buildReport = {
        type: workerReport.type,
        report: workerReport.report,
        outputs: workerReport.outputs,
        errors: [],
        warnings: workerReport.warnings ?? [],
      }

      if (workerReport.errors.length > 0) {
        buildReport.errors = workerReport.errors.map(({ error, errorData = {} }) => {
          return restoreWorkerError(error, errorData)
        })
      }
      resolve(buildReport)
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) { reject(new Error(`Worker stopped with exit code ${code}`)) }
    })
  })
}
