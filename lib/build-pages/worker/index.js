/**
 * @import { PageBuildStep } from '../index.js'
 */

import { PageWorkerPool } from './page-worker-pool.js'

/**
 * Run a page build in a fresh, single-use worker. No speculative worker is
 * created here; only watch sessions explicitly opt into warming their pool.
 * @type {PageBuildStep}
 */
export function buildPages (src, dest, siteData, opts) {
  return new PageWorkerPool().build(src, dest, siteData, opts)
}
