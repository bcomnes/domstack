/**
 * @import {Message as EsbuildMessage} from 'esbuild'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { DomStackWarning } from './helpers/domstack-warning.js'
 * @import { EsBuildStepResults } from './build-esbuild/index.js'
 * @import { PageBuildStepResult } from './build-pages/index.js'
 * @import { StaticBuildStepResult } from './build-static/index.js'
 * @import { CopyBuildStepResult } from './build-copy/index.js'
 * @import { OutputClaim } from './output-registry.js'
 * @import { DomstackManifest, DomstackManifestConfig, DomstackManifestRecord } from './domstack-manifest/index.js'
*/

import { buildPages } from './build-pages/index.js'
import { identifyPages } from './identify-pages.js'
import { buildStatic } from './build-static/index.js'
import { buildCopy } from './build-copy/index.js'
import { buildEsbuild, buildServiceWorkerEsbuild } from './build-esbuild/index.js'
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { toPosix } from './helpers/path.js'
import { prepareAdditionalOutputPromotion } from './helpers/additional-output-promotion.js'
import { DomStackAggregateError } from './helpers/domstack-aggregate-error.js'

import { OutputRegistry, isCaseInsensitiveDest } from './output-registry.js'

import { remapCopyReport } from './helpers/staged-copy.js'
import {
  DEFAULT_DOMSTACK_MANIFEST_FILENAME,
  isDomstackManifestEnabled,
  reconcileDomstackManifest,
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
 * @property {DomstackManifestRecord[]} outputs - Files emitted by this step for manifest reconciliation.
 * @property {R} report - A property whose structure is defined by the caller.
 */

/**
 * @typedef {BuildStepResult<string, unknown>} BuildOutputStepResult
 */

/**
 * @template T, R
 * @template [Options=DomStackOpts]
 * @callback BuildStep
 *
 * A function that represents a step in the build process. All build steps should
 * conform to this interface for consistency.
 *
 * @param {string} src - The source directory from which the site should be built.
 * @param {string} dest - The destination directory where the built site should be placed.
 * @param {SiteData} siteData - Data related to the site being built.
 * @param {Options?} opts - Additional options for the build step.
 * @returns {Promise<BuildStepResult<T, R>>} - The results of the build step.
 */

/**
 * @typedef DomStackOpts
 * @property {boolean|undefined} [static=true] - Enable copying non-page, non-bundle static files from `src` into `dest`.
 * @property {boolean|undefined} [metafile=true] - Enable writing the esbuild metadata file.
 * @property {boolean | DomstackManifestConfig} [domstackManifest] - Configure the domstack manifest pipeline. Programmatic builds return it and hooks receive it; file writing is opt-in with `true` or `{ write: true }`.
 * @property {string[]|undefined} [ignore=[]] - Ignore patterns applied while discovering and copying source files.
 * @property {string[]|undefined} [target=[]] - Esbuild target values used for JavaScript and CSS bundling.
 * @property {boolean|undefined} [buildDrafts=false] - Build files marked with the `published: false` variable.
 * @property {string[]|undefined} [copy=[]] - Paths to copy into the dest directory. Relative paths are resolved to absolute paths from the current working directory by the DomStack constructor, matching the CLI `--copy` behavior.
 * @property {PinoLogger|undefined} [logger] - Pino logger instance used for watch output and embedded sync output.
 */

/**
 * Site discovery data returned by identifyPages().
 *
 * `pages` contains source-backed pages discovered from the source tree. Generated
 * pages are created later in the page worker and are not added to this discovery
 * result.
 *
 * @typedef {Awaited<ReturnType<typeof identifyPages>>} SiteData
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
 * @property {OutputClaim[]} [outputClaims] - Internal full-watch ownership snapshot.
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
 * @param {{ watch?: boolean, caseInsensitive?: boolean, promoteOutputs?: (claims: OutputClaim[], write: () => Promise<void>, preflight: (removablePaths: string[]) => Promise<void>) => Promise<void> }} [internal]
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
export async function builder (src, dest, opts, internal = {}) {
  if (!internal.watch) {
    const results = await buildInto(src, dest, opts, dest, false, internal.caseInsensitive)
    delete results.outputClaims
    return results
  }
  await mkdir(dest, { recursive: true })
  const stageDest = await mkdtemp(join(resolve(dest), '.domstack-stage-'))
  try {
    const results = await buildInto(src, stageDest, { ...opts, ignore: [...(opts.ignore ?? []), '.domstack-stage-*'] }, dest, internal.watch ?? false, internal.caseInsensitive)
    let unchanged = new Set()
    const preflight = async (/** @type {string[]} */ removablePaths) => {
      unchanged = await prepareAdditionalOutputPromotion(dest, results.pageBuildResults?.outputs ?? [], removablePaths)
    }

    const write = async () => {
      await mkdir(dest, { recursive: true })
      await cp(stageDest, await realpath(dest), {
        recursive: true,
        force: true,
        filter: source => !unchanged.has(toPosix(relative(stageDest, source))),
      })
    }
    if (internal.promoteOutputs) await internal.promoteOutputs(results.outputClaims ?? [], write, preflight)
    else {
      await preflight([])
      await write()
    }
    remapBuildResults(results, stageDest, dest)
    delete results.outputClaims
    return results
  } catch (error) {
    if (error instanceof DomStackAggregateError && error.results?.esbuildResults) remapBuildResults(error.results, stageDest, dest)
    throw error
  } finally {
    await rm(stageDest, { recursive: true, force: true })
  }
}

/**
 * Build into the requested destination (or the caller's full-watch stage).
 *
 * @param {string} src
 * @param {string} dest
 * @param {DomStackOpts} opts
 * @param {string} publicDest
 * @param {boolean} watch
 * @param {boolean} [casePolicy]
 * @returns {Promise<Results>}
 */
async function buildInto (src, dest, opts, publicDest, watch, casePolicy) {
  const errors = [] /** @type {BuildStepErrors} */
  const warnings = [] /** @type {BuildStepWarnings} */

  const siteData = await identifyPages(src, { ...(opts.ignore ? { ignore: opts.ignore } : {}), ...(opts.buildDrafts !== undefined ? { buildDrafts: opts.buildDrafts } : {}) }) /** @type {SiteData} */

  errors.push(...siteData.errors)
  warnings.push(...siteData.warnings)

  if (siteData.errors.length > 0) {
    const pageWalkErrors = new DomStackAggregateError(siteData.errors, 'Page walk finished but there were errors.', siteData)
    throw pageWalkErrors
  }

  await mkdir(dest, { recursive: true })

  const domstackManifestSettingsPath = siteData?.domstackManifestSettings?.filepath
  const domstackManifestEnabled = isDomstackManifestEnabled({
    domstackManifestSettingsPath,
    opts,
  })
  const domstackManifestOptions = await resolveDomstackManifestOptions({
    domstackManifestSettingsPath,
    opts,
  })

  const caseInsensitive = casePolicy ?? await isCaseInsensitiveDest(publicDest)
  const outputRegistry = new OutputRegistry([], { caseInsensitive })
  const [
    esbuildResults,
    staticResults,
    copyResults,
  ] = await Promise.all([
    buildEsbuild(src, dest, siteData, opts, outputRegistry, watch, publicDest),
    opts.static !== false
      ? buildStatic(src, dest, siteData, opts, outputRegistry)
      : Promise.resolve(null),
    buildCopy(src, dest, siteData, opts, outputRegistry),
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

  const pageBuildResults = await buildPages(src, dest, siteData, {
    ...opts,
    previousOutputClaims: outputRegistry.snapshot(),
    caseInsensitive,
    trackWatchDependencies: watch,
  })

  errors.push(...pageBuildResults.errors)
  warnings.push(...pageBuildResults.warnings)
  results.pageBuildResults = pageBuildResults

  if (errors.length > 0) {
    const buildError = new DomStackAggregateError(errors, 'Build finished but there were errors.', results)
    throw buildError
  }

  outputRegistry.releaseOwnerIds(pageBuildResults.report.replacedOwnerIds ?? [])
  for (const claim of pageBuildResults.report.newClaims ?? []) outputRegistry.claim(claim.outputRelname, claim.owner)
  delete pageBuildResults.report.newClaims
  delete pageBuildResults.report.replacedOwnerIds

  const baseOutputRecords = collectOutputRecords(
    esbuildResults,
    staticResults,
    copyResults,
    pageBuildResults
  )

  const domstackManifestReconciliation = domstackManifestEnabled
    ? await reconcileDomstackManifest({
      dest,
      records: baseOutputRecords,
      options: domstackManifestOptions,
    })
    : undefined

  if (domstackManifestReconciliation) {
    warnings.push(...domstackManifestReconciliation.warnings)
  }
  const domstackManifest = domstackManifestReconciliation?.manifest

  const domstackManifestBuiltHookResult = domstackManifest
    ? await runDomstackManifestBuiltHooks(dest, domstackManifest, domstackManifestOptions, {
      publicDest,
      claimOutput: (outputRelname, hookIndex) => outputRegistry.claim(outputRelname, {
        id: `manifest-hook:${hookIndex}`,
        type: 'manifest hook',
        path: `manifestBuilt hook #${hookIndex + 1}`,
      }),
    })
    : { serviceWorkerDefines: {} }

  const serviceWorkerBuildDefines = {
    define: domstackManifestBuiltHookResult.serviceWorkerDefines,
    ...(domstackManifest ? { manifestVersion: domstackManifest.version } : {}),
  }

  const serviceWorkerEsbuildResults = await buildServiceWorkerEsbuild(
    src,
    dest,
    siteData,
    esbuildResults.report.buildOpts,
    serviceWorkerBuildDefines,
    outputRegistry
  )

  errors.push(...serviceWorkerEsbuildResults.errors)
  warnings.push(...serviceWorkerEsbuildResults.warnings)

  if (errors.length > 0) {
    const serviceWorkerBuildError = new DomStackAggregateError(errors, 'Service worker build finished but there were errors.', results)
    throw serviceWorkerBuildError
  }

  if (domstackManifest) results.domstackManifest = domstackManifest

  if (domstackManifest && shouldWriteDomstackManifest(opts)) {
    outputRegistry.claim(DEFAULT_DOMSTACK_MANIFEST_FILENAME, {
      id: 'domstack-manifest',
      type: 'metadata',
      path: 'generated domstack manifest',
    })
    await writeDomstackManifest(dest, domstackManifest)
  }

  results.outputClaims = outputRegistry.snapshot()
  return results
}

/**
 * @param {...(BuildOutputStepResult | null | undefined)} results
 * @returns {DomstackManifestRecord[]}
 */
function collectOutputRecords (...results) {
  return results.flatMap(result => result?.outputs ?? [])
}

/**
 * Staging is internal; public reports continue to describe the requested dest.
 *
 * @param {Results} results
 * @param {string} stageDest
 * @param {string} dest
 */
function remapBuildResults (results, stageDest, dest) {
  const steps = [
    results.esbuildResults,
    results.staticResults,
    results.copyResults,
    results.pageBuildResults,
  ]
  for (const record of collectOutputRecords(...steps)) {
    record.filepath = resolve(dest, record.outputRelname)
  }

  for (const page of results.pageBuildResults?.report.pages ?? []) {
    page.pageFilePath = resolve(dest, page.pageFilePath.slice(resolve(stageDest).length + 1))
  }

  if (results.staticResults) remapCopyReport(results.staticResults.report, dest)
  for (const report of Object.values(results.copyResults?.report ?? {})) remapCopyReport(report, dest)
}
