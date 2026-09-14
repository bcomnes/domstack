/**
 * @import { BuildStepResult, BuildStep, DomStackOpts } from '../builder.js'
 */

/** @import { copy } from 'cpx2' */
import { join } from 'node:path'
import { stagedCopy } from '../helpers/staged-copy.js'
import { OutputRegistry } from '../output-registry.js'

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
 * @param {string} src
 * @param {string} dest
 * @param {unknown} _siteData
 * @param {DomStackOpts | null} [opts]
 * @param {OutputRegistry} [registry]
 */
export async function buildCopy (src, dest, _siteData, opts, registry = new OutputRegistry()) {
  /** @type {CopyBuildStepResult} */
  const results = {
    type: 'copy',
    report: {},
    outputs: [],
    errors: [],
    warnings: [],
  }

  const copyDirs = getCopyDirs(opts?.copy)

  // Each configured root is a producer, even when roots overlap or repeat.
  // Keep this prefix identical to the live watch inventory's mapping identity.
  const copyTasks = copyDirs.map((copyDir, index) => {
    return stagedCopy(copyDir, src, dest, 'copy', registry, [], `copy-root:${index}:`)
  })

  const settled = await Promise.allSettled(copyTasks)

  for (const [index, result] of settled.entries()) {
    if (result.status === 'rejected') {
      const buildError = new Error('Error copying copy folders', { cause: result.reason })
      results.errors.push(buildError)
    } else {
      const copyDir = copyDirs[index]
      if (!copyDir) continue
      results.report[copyDir] = result.value.report
      results.outputs.push(...result.value.outputs)
    }
  }
  return results
}
