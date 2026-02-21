/**
 * @import {Message as EsbuildMessage} from 'esbuild'
 * @import { DomStackWarning } from './helpers/dom-stack-warning.js'
 * @import { EsBuildStepResults } from './build-esbuild/index.js'
 * @import { PageBuildStepResult } from './build-pages/index.js'
 * @import { StaticBuildStepResult } from './build-static/index.js'
 * @import { CopyBuildStepResult } from './build-copy/index.js'
*/

import { buildPages } from './build-pages/index.js'
import { identifyPages } from './identify-pages.js'
import { buildStatic } from './build-static/index.js'
import { buildCopy } from './build-copy/index.js'
import { buildEsbuild } from './build-esbuild/index.js'
import { DomStackAggregateError } from './helpers/dom-stack-aggregate-error.js'
import { ensureDest } from './helpers/ensure-dest.js'

/**
 * @typedef {Array<Error | EsbuildMessage>} BuildStepErrors
 * @typedef {Array<EsbuildMessage | DomStackWarning>} BuildStepWarnings
 */

/**
 * @template T, R
 * @typedef BuildStepResult
 * @property {T} type - Identifier for the type of build step.
 * @property {BuildStepErrors} errors - Any errors that occurred during the build step.
 * @property {BuildStepWarnings} warnings - Any warnings that occurred during the build step.
 * @property {R} report - A property whose structure is defined by the caller.
 */

/**
 * @template T, R
 * @callback BuildStep
 *
 * A function that represents a step in the build process. All build steps should
 * conform to this interface for consistency.
 *
 * @param {string} src - The source directory from which the site should be built.
 * @param {string} dest - The destination directory where the built site should be placed.
 * @param {SiteData} siteData - Data related to the site being built.
 * @param {DomStackOpts} [opts] - Additional options for the build step.
 * @returns {Promise<BuildStepResult<T, R>>} - The results of the build step.
 */

/**
 * @typedef DomStackOpts
 * @property {boolean|undefined} [static=true] - Enable/disable static file processing
 * @property {boolean|undefined} [metafile=true] - Enable/disable the writing of the esbuild metadata file.
 * @property {string[]|undefined} [ignore=[]] - Array of ignore strings
 * @property {string[]|undefined} [target=[]] - Array of target strings to pass to esbuild
 * @property {boolean|undefined} [buildDrafts=false] - Build draft files with the published:false variable
 * @property {string[]|undefined} [copy=[]] - Array of paths to copy their contents into the dest directory
 * @property {string[]|undefined} [pageFilterPaths] - Internal: only build pages whose pageFile.filepath is in this array
 * @property {string[]|undefined} [templateFilterPaths] - Internal: only build templates whose templateFile.filepath is in this array
 */

/**
 * The data generated about the site generate dby identifyPages
 * @typedef {Awaited<ReturnType<identifyPages>>} SiteData
 */

/**
 * @typedef Results
 * @property {SiteData} siteData
 * @property {EsBuildStepResults} esbuildResults
 * @property {StaticBuildStepResult} [staticResults]
 * @property {CopyBuildStepResult} [copyResults]
 * @property {PageBuildStepResult} [pageBuildResults]
 * @property {BuildStepWarnings} warnings
 */

/**
 * Builds a domstack site from src to dest with a few options.
 *
 *
 * @function
 * @export
 * @param {string} src - The source directory from which the site should be built.
 * @param {string} dest - The destination directory where the built site should be placed.
 * @param {DomStackOpts} opts - Options for the build process.
 * @returns {Promise<Results>}
 *
 * @example
 *
 * const buildOptions = {
 *   static: true
 * };
 *
 * try {
 *   const buildResults = await builder('./src', './dist', { static: true })
 *   console.log(buildResults)
 * } catch (error) {
 *   console.error(error)
 * }
 */
export async function builder (src, dest, opts) {
  const errors = [] /** @type {BuildStepErrors} */
  const warnings = [] /** @type {BuildStepWarnings} */

  const siteData = await identifyPages(src, opts) /** @type {SiteData} */

  errors.push(...siteData.errors)
  warnings.push(...siteData.warnings)

  if (siteData.errors.length > 0) {
    const pageWalkErrors = new DomStackAggregateError(siteData.errors, 'Page walk finished but there were errors.', siteData)
    throw pageWalkErrors
  }

  await ensureDest(dest, siteData)

  const [
    esbuildResults,
    staticResults,
    copyResults,
  ] = await Promise.all([
    buildEsbuild(src, dest, siteData, opts),
    opts.static
      ? buildStatic(src, dest, siteData, opts)
      : Promise.resolve(),
    buildCopy(src, dest, siteData, opts),
  ])

  /** @type {Results} */
  const results = {
    warnings,
    siteData,
    esbuildResults,
  }

  errors.push(...esbuildResults.errors)
  warnings.push(...esbuildResults.warnings)

  if (staticResults) {
    errors.push(...staticResults.errors)
    warnings.push(...staticResults.warnings)
    results.staticResults = staticResults
  }

  errors.push(...copyResults.errors)
  warnings.push(...copyResults.warnings)
  results.copyResults = copyResults

  if (errors.length > 0) {
    const preBuildError = new DomStackAggregateError(errors, 'Prebuild finished but there were errors.', results)
    throw preBuildError
  }

  const pageBuildResults = await buildPages(src, dest, siteData, opts)

  errors.push(...pageBuildResults.errors)
  warnings.push(...pageBuildResults.warnings)
  results.pageBuildResults = pageBuildResults

  if (errors.length > 0) {
    const buildError = new DomStackAggregateError(errors, 'Build finished but there were errors.', results)
    throw buildError
  } else {
    return results
  }
}
