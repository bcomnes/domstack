/**
 * @import { BuildStepResult } from '../builder.js'
 * @import { BuildStep } from '../builder.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */
import { copy } from 'cpx2'
import { createCopiedDomstackManifestRecords } from '../helpers/cpx2-report.js'

/**
 * @typedef {{ outputs: DomstackManifestRecord[] }} StaticBuilderReport
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
  return `${src}/**/!(*.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.cjs|*.mjs|*.css|*.html|*.md)`
}

/**
 * run CPX2 on src folder
 *
 * @type {StaticBuildStep}
 */
export async function buildStatic (src, dest, _siteData, opts) {
  /** @type {StaticBuildStepResult} */
  const results = {
    type: 'static',
    report: /** @type {StaticBuilderReport} */ ({ outputs: [] }),
    errors: [],
    warnings: [],
  }

  try {
    const report = await copy(getCopyGlob(src), dest, ...(opts?.ignore ? [{ ignore: opts.ignore }] : []))
    results.report.outputs = createCopiedDomstackManifestRecords({
      src,
      dest,
      report,
      kind: 'static',
    })
  } catch (err) {
    const buildError = new Error('Error copying static files', { cause: err })
    results.errors.push(buildError)
  }

  return results
}
