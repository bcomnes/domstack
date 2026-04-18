/**
 * @import { BuildStepResult, BuildStep } from '../builder.js'
 */

// @ts-expect-error
import cpx from 'cpx2'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
const copy = cpx.copy

/**
 * @typedef {BuildStepResult<'static', CopyBuilderReport>} CopyBuildStepResult
 * @typedef {BuildStep<'static', CopyBuilderReport>} CopyBuildStep
 * @typedef {Awaited<ReturnType<typeof copy>>} CopyBuilderReport
 */

/**
 * @param  {string[]} copy
 * @return {Promise<string[]>}
 */
export async function getCopyDirs (copy = []) {
  const globs = await Promise.all(copy.map(async (entry) => {
    try {
      const stats = await stat(entry)
      if (stats.isDirectory()) {
        return join(entry, '**')
      }
    } catch {
      // Path not accessible yet — treat as directory glob
      return join(entry, '**')
    }
    return entry
  }))
  return globs
}

/**
 * run CPX2 on src folder
 *
 * @type {CopyBuildStep}
 */
export async function buildCopy (_src, dest, _siteData, opts) {
  /** @type {CopyBuildStepResult} */
  const results = {
    type: 'static',
    report: {},
    errors: [],
    warnings: [],
  }

  const copyGlobs = await getCopyDirs(opts?.copy)

  const copyTasks = copyGlobs.map((copyGlob) => {
    return copy(copyGlob, dest)
  })

  const settled = await Promise.allSettled(copyTasks)

  for (const [index, result] of Object.entries(settled)) {
    // @ts-expect-error
    const copyGlob = copyGlobs[index]
    if (result.status === 'rejected') {
      const buildError = new Error('Error copying copy folders', { cause: result.reason })
      results.errors.push(buildError)
    } else {
      results.report[copyGlob] = result.value
    }
  }
  return results
}
