/**
 * @import { BuildStep, BuildStepResult, DomStackOpts } from '../builder.js'
 */
import { processedExtensions } from '../file-conventions.js'
/** @import { copy } from 'cpx2' */
import { stagedCopy } from '../helpers/staged-copy.js'
import { OutputRegistry } from '../output-registry.js'

/**
 * @typedef {Awaited<ReturnType<typeof copy>> | Record<string, never>} StaticBuilderReport
 */

/**
 * @typedef {BuildStepResult<'static', StaticBuilderReport>} StaticBuildStepResult
 */

/**
 * @typedef {BuildStep<'static', StaticBuilderReport>} StaticBuildStep
 */

/**
 * @param  {string} src - The base path to the copy glob
 * @return {string}     - The copy clob
 */
export function getCopyGlob (src) {
  // Always ignore files we typically process. Otherwise it gets really confusing.
  return `${src}/**/!(${processedExtensions.map(ext => `*.${ext}`).join('|')})`
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
export async function buildStatic (src, dest, _siteData, opts, registry = new OutputRegistry()) {
  /** @type {StaticBuildStepResult} */
  const results = {
    type: 'static',
    report: {},
    outputs: [],
    errors: [],
    warnings: [],
  }

  try {
    if (opts?.static === false) return results
    const copied = await stagedCopy(getCopyGlob(src), src, dest, 'static', registry, opts?.ignore)
    results.report = copied.report
    results.outputs = copied.outputs
  } catch (err) {
    const buildError = new Error('Error copying static files', { cause: err })
    results.errors.push(buildError)
  }

  return results
}
