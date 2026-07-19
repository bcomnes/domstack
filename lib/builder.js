/**
 * @import {Message as EsbuildMessage} from 'esbuild'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { DomStackWarning } from './helpers/domstack-warning.js'
 * @import { EsBuildStepResults } from './build-esbuild/index.js'
 * @import { PageBuildStepResult } from './build-pages/index.js'
 * @import { StaticBuildStepResult } from './build-static/index.js'
 * @import { CopyBuildStepResult } from './build-copy/index.js'
 * @import { DomstackManifest } from './domstack-manifest/index.js'
 * @import { DomstackManifestRecord } from './domstack-manifest/index.js'
 * @import { DomstackManifestHooks } from './domstack-manifest/index.js'
 * @import { DomstackManifestTransform } from './domstack-manifest/index.js'
*/

import { buildPages } from './build-pages/index.js'
import { identifyPages } from './identify-pages.js'
import { buildStatic } from './build-static/index.js'
import { buildCopy } from './build-copy/index.js'
import { buildEsbuild, buildServiceWorkerEsbuild } from './build-esbuild/index.js'
import { DomStackAggregateError } from './helpers/domstack-aggregate-error.js'
import { ensureDest } from './helpers/ensure-dest.js'
import {
  buildDomstackManifest,
  isDomstackManifestEnabled,
  resolveDomstackManifestOptions,
  runDomstackManifestBuiltHooks,
  shouldWriteDomstackManifest,
  writeDomstackManifest,
} from './domstack-manifest/index.js'

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
 * @param {DomStackOpts?} opts - Additional options for the build step.
 * @returns {Promise<BuildStepResult<T, R>>} - The results of the build step.
 */

/**
 * @typedef DomStackOpts
 * @property {boolean|undefined} [static=true] - Enable copying non-page, non-bundle static files from `src` into `dest`.
 * @property {boolean|undefined} [metafile=true] - Enable writing the esbuild metadata file.
 * @property {boolean | { write?: boolean, exclude?: string[], manifestVars?: string[] | DomstackManifestTransform, policy?: Record<string, unknown> | Function, hooks?: DomstackManifestHooks } | undefined} [domstackManifest] - Configure the domstack manifest pipeline. Programmatic builds return it and hooks receive it; file writing is opt-in with `true` or `{ write: true }`.
 * @property {string[]|undefined} [ignore=[]] - Ignore patterns applied while discovering and copying source files.
 * @property {string[]|undefined} [target=[]] - Esbuild target values used for JavaScript and CSS bundling.
 * @property {boolean|undefined} [buildDrafts=false] - Build files marked with the `published: false` variable.
 * @property {string[]|undefined} [copy=[]] - Paths to copy into the dest directory. Relative paths are resolved to absolute paths from the current working directory by the DomStack constructor, matching the CLI `--copy` behavior.
 * @property {PinoLogger|undefined} [logger] - Logger used for watch output and embedded sync output.
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
 * @property {DomstackManifest} [domstackManifest]
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

  const domstackManifestSettingsPath = siteData?.domstackManifestSettings?.filepath
  const domstackManifestEnabled = isDomstackManifestEnabled({
    domstackManifestSettingsPath,
    opts,
  })
  const domstackManifestOptions = await resolveDomstackManifestOptions({
    domstackManifestSettingsPath,
    opts,
  })

  const [
    esbuildResults,
    staticResults,
    copyResults,
  ] = await Promise.all([
    buildEsbuild(src, dest, siteData, opts),
    opts.static
      ? buildStatic(src, dest, siteData, opts)
      : Promise.resolve(null),
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
  }

  const baseOutputRecords = collectOutputRecords(
    esbuildResults,
    staticResults,
    copyResults,
    pageBuildResults
  )

  const domstackManifest = domstackManifestEnabled
    ? await buildDomstackManifest({
      dest,
      records: baseOutputRecords,
      options: domstackManifestOptions,
    })
    : undefined

  const domstackManifestBuiltHookResult = domstackManifest
    ? await runDomstackManifestBuiltHooks(dest, domstackManifest, domstackManifestOptions)
    : { serviceWorkerDefines: {} }

  const serviceWorkerBuildDefines = {
    define: domstackManifestBuiltHookResult.serviceWorkerDefines,
    ...(domstackManifest ? { manifestVersion: domstackManifest.version } : {}),
  }

  const serviceWorkerEsbuildResults = await buildServiceWorkerEsbuild(src, dest, siteData, opts, serviceWorkerBuildDefines)

  errors.push(...serviceWorkerEsbuildResults.errors)
  warnings.push(...serviceWorkerEsbuildResults.warnings)

  if (errors.length > 0) {
    const serviceWorkerBuildError = new DomStackAggregateError(errors, 'Service worker build finished but there were errors.', results)
    throw serviceWorkerBuildError
  }

  if (domstackManifest) results.domstackManifest = domstackManifest

  if (domstackManifest && shouldWriteDomstackManifest(opts)) {
    await writeDomstackManifest(dest, domstackManifest)
  }

  return results
}

/**
 * @param  {...{ report?: { outputs?: DomstackManifestRecord[] } } | null | undefined} results
 * @returns {DomstackManifestRecord[]}
 */
function collectOutputRecords (...results) {
  return results.flatMap(result => result?.report?.outputs ?? [])
}
