/**
 * @import { BuildStepResult, BuildStep } from '../builder.js'
 */

import { copy } from 'cpx2'
import { join } from 'node:path'
import { createCopiedDomstackManifestRecords } from '../helpers/cpx2-report.js'

/**
 * @typedef {Record<string, Awaited<ReturnType<typeof copy>>>} CopyBuilderReport
 * @typedef {BuildStepResult<'copy', CopyBuilderReport>} CopyBuildStepResult
 * @typedef {BuildStep<'copy', CopyBuilderReport>} CopyBuildStep
 */

/**
 * @param  {string[]} copy
 * @return {string[]}
 */
export function getCopyDirs (copy = []) {
  const copyGlobs = copy?.map((dir) => join(dir, '**'))
  return copyGlobs
}

/**
 * run CPX2 on src folder
 *
 * @type {CopyBuildStep}
 */
export async function buildCopy (src, dest, _siteData, opts) {
  /** @type {CopyBuildStepResult} */
  const results = {
    type: 'copy',
    report: {},
    outputs: [],
    errors: [],
    warnings: [],
  }

  const copyDirs = getCopyDirs(opts?.copy)

  const copyTasks = copyDirs.map((copyDir) => {
    return copy(copyDir, dest)
  })

  const settled = await Promise.allSettled(copyTasks)

  for (const [index, result] of settled.entries()) {
    if (result.status === 'rejected') {
      const buildError = new Error('Error copying copy folders', { cause: result.reason })
      results.errors.push(buildError)
    } else {
      const copyDir = copyDirs[index]
      if (!copyDir) continue
      results.report[copyDir] = result.value
      results.outputs.push(...createCopiedDomstackManifestRecords({
        src,
        dest,
        report: result.value,
        kind: 'copy',
      }))
    }
  }
  return results
}
