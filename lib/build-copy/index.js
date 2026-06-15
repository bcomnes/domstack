/**
 * @import { BuildStepResult, BuildStep } from '../builder.js'
 * @import { BuildOutputRecord } from '../build-output-manifest/index.js'
 */

import { copy } from 'cpx2'
import { join } from 'node:path'
import { createCopiedOutputRecords } from '../build-output-manifest/index.js'

/**
 * @typedef {BuildStepResult<'copy', CopyBuilderReport>} CopyBuildStepResult
 * @typedef {BuildStep<'copy', CopyBuilderReport>} CopyBuildStep
 * @typedef {Record<string, Awaited<ReturnType<typeof copy>>> & { outputs: BuildOutputRecord[] }} CopyBuilderReport
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
export async function buildCopy (_src, dest, _siteData, opts) {
  /** @type {CopyBuildStepResult} */
  const results = {
    type: 'copy',
    report: { outputs: [] },
    errors: [],
    warnings: [],
  }

  const copyDirs = getCopyDirs(opts?.copy)

  const copyTasks = copyDirs.map((copyDir) => {
    return copy(copyDir, dest)
  })

  const settled = await Promise.allSettled(copyTasks)

  for (const [index, result] of Object.entries(settled)) {
    // @ts-expect-error
    const copyDir = copyDirs[index]
    if (result.status === 'rejected') {
      const buildError = new Error('Error copying copy folders', { cause: result.reason })
      results.errors.push(buildError)
    } else {
      /** @type {Record<string, object>} */ (results.report)[copyDir] = result.value
      results.report.outputs.push(...createCopiedOutputRecords({
        src: _src,
        dest,
        report: result.value,
        kind: 'copy',
      }))
    }
  }
  return results
}
