/**
 * @import { BuildStepResult, BuildStep } from '../builder.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */

import { copy } from 'cpx2'
import { join } from 'node:path'
import { createCopiedDomstackManifestRecords } from '../domstack-manifest/index.js'

/**
 * @typedef {BuildStepResult<'copy', CopyBuilderReport>} CopyBuildStepResult
 * @typedef {BuildStep<'copy', CopyBuilderReport>} CopyBuildStep
 * @typedef {{ outputs: DomstackManifestRecord[] }} CopyBuilderReport
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

  for (const result of settled) {
    if (result.status === 'rejected') {
      const buildError = new Error('Error copying copy folders', { cause: result.reason })
      results.errors.push(buildError)
    } else {
      results.report.outputs.push(...createCopiedDomstackManifestRecords({
        src: _src,
        dest,
        report: result.value,
        kind: 'copy',
      }))
    }
  }
  return results
}
