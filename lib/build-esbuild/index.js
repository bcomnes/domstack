/**
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { DomstackManifestKind, DomstackManifestRecord } from '../domstack-manifest/index.js'
 * @import { Logger as PinoLogger } from 'pino'
 */

import { mkdir, writeFile } from 'fs/promises'
import { join, relative, basename, dirname, resolve, extname } from 'path'
import esbuild from 'esbuild'
import { OutputRegistry } from '../output-registry.js'
import { rethrowEsbuildOutputConflict, validateEsbuildEntryOutputs } from './output-conflicts.js'
import { globalBundleAssets, pageBundleAssets, layoutBundleAssets } from '../file-conventions.js'
import { resolveVars } from '../build-pages/resolve-vars.js'
import {
  createDomstackManifestRecord,
  DEFAULT_DOMSTACK_MANIFEST_FILENAME,
  isDomstackManifestEnabled,
} from '../domstack-manifest/index.js'
import { toPosix } from '../helpers/path.js'
import { createDomStackLogger } from '../logger.js'

const __dirname = import.meta.dirname
const DOM_STACK_DEFAULTS_PREFIX = 'domstack-defaults'
const SERVICE_WORKER_OUTPUT_RELNAME = 'service-worker.js'

/**
 * @typedef {esbuild.Format} EsbuildFormat
 * @typedef {esbuild.LogLevel} EsbuildLogLevel
 * @typedef {{[relpath: string]: string}} OutputMap
 * @typedef {esbuild.BuildOptions} EsbuildBuildOptions
 * @typedef {{ dispose: () => Promise<void> }} DisposableBuildContext
 * @typedef {{ define?: Record<string, string>, manifestVersion?: string }} ServiceWorkerBuildDefines
 * @typedef {{
 *   buildResults?: esbuild.BuildResult,
 *   buildOpts?: EsbuildBuildOptions,
 *   outputMap?: OutputMap
 * }} EsbuildReport

 * @typedef {BuildStep<
 *          'esbuild',
 *         EsbuildReport
 * >} EsBuildStep
 */

/**
 * @typedef {Awaited<ReturnType<EsBuildStep>>} EsBuildStepResults
 */

/**
 * Convert an esbuild diagnostic into plain data that survives error inspection,
 * structured logging, and serialization across process boundaries.
 *
 * @param {esbuild.Message} message
 */
function serializeEsbuildMessage (message) {
  return {
    id: message.id,
    pluginName: message.pluginName,
    text: message.text,
    location: message.location ? { ...message.location } : null,
    notes: message.notes.map(note => ({
      text: note.text,
      location: note.location ? { ...note.location } : null,
    })),
    detail: message.detail instanceof Error
      ? { name: message.detail.name, message: message.detail.message, stack: message.detail.stack }
      : message.detail == null ? message.detail : String(message.detail),
  }
}

/**
 * Materialize esbuild's accessor-backed errors and warnings as enumerable arrays.
 * Non-esbuild errors are returned unchanged.
 *
 * @param {unknown} value
 * @returns {Error}
 */
export function serializeEsbuildError (value) {
  if (!(value instanceof Error)) return new Error(String(value))

  const failure = /** @type {Error & { errors?: esbuild.Message[], warnings?: esbuild.Message[] }} */ (value)
  if (!Array.isArray(failure.errors) && !Array.isArray(failure.warnings)) return value

  const serialized = new Error(value.message)
  serialized.name = value.name
  if (value.stack) serialized.stack = value.stack
  Object.assign(serialized, {
    errors: (failure.errors ?? []).map(serializeEsbuildMessage),
    warnings: (failure.warnings ?? []).map(serializeEsbuildMessage),
  })
  return serialized
}

/**
 * Extract a relpath→relpath output map from esbuild metafile outputs.
 *
 * @param {esbuild.Metafile} metafile
 * @param {string} src
 * @param {string} dest
 * @returns {OutputMap}
 */
export function extractOutputMap (metafile, src, dest) {
  /** @type {OutputMap} */
  const outputMap = {}
  Object.keys(metafile.outputs).forEach(file => {
    const entryPoint = metafile.outputs[file]?.entryPoint
    if (entryPoint) {
      // Esbuild metafiles can use platform separators, while siteData keys are POSIX relnames.
      outputMap[toPosix(relative(src, entryPoint))] = toPosix(relative(dest, file))
    }
  })
  return outputMap
}

/**
 * Stamp output relpaths from the outputMap back onto siteData in place.
 *
 * @param {OutputMap} outputMap
 * @param {SiteData} siteData
 */
function updateSiteDataOutputPaths (outputMap, siteData) {
  for (const page of siteData.pages) {
    updateOutputFileInfo(outputMap, page.pageStyle)
    updateOutputFileInfo(outputMap, page.clientBundle)

    if (page.workers) {
      for (const workerFile of Object.values(page.workers)) {
        updateOutputFileInfo(outputMap, workerFile)
      }
    }
  }

  updateOutputFileInfo(outputMap, siteData.globalClient)
  updateOutputFileInfo(outputMap, siteData.globalStyle)
  updateOutputFileInfo(outputMap, siteData.serviceWorker)

  for (const layout of Object.values(siteData.layouts)) {
    updateOutputFileInfo(outputMap, layout.layoutStyle)
    updateOutputFileInfo(outputMap, layout.layoutClient)
  }

  if (siteData.defaultLayout) {
    const defaultClient = Object.values(outputMap).find(p => /^domstack-defaults.*\.js$/.test(p))
    const defaultStyle = Object.values(outputMap).find(p => /^domstack-defaults.*\.css$/.test(p))
    siteData.defaultClient = defaultClient ?? null
    siteData.defaultStyle = defaultStyle ?? null
  }
}

/**
 * @param {OutputMap} outputMap
 * @param {{ relname: string, outputRelname?: string, outputName?: string } | null | undefined} fileInfo
 */
function updateOutputFileInfo (outputMap, fileInfo) {
  if (!fileInfo) return

  const outputRelname = outputMap[fileInfo.relname]
  if (!outputRelname) return

  fileInfo.outputRelname = outputRelname
  fileInfo.outputName = basename(outputRelname)
}

/**
 * Create browser-side esbuild options from siteData + opts.
 * The root service worker intentionally uses a separate build derived from these base options.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {DomStackOpts | null} opts
 * @param {{ watch?: boolean }} [modeOpts]
 * @returns {Promise<esbuild.BuildOptions>}
 */
async function createBrowserBuildOpts (src, dest, siteData, opts, modeOpts = {}) {
  const entryPoints = /** @type {(string | { in: string, out: string })[]} */ (globalBundleAssets(siteData).map(asset => join(src, asset.relname)))

  if (siteData.defaultLayout) {
    entryPoints.push(
      { in: join(__dirname, '../defaults/default.style.css'), out: join(DOM_STACK_DEFAULTS_PREFIX, 'default.style.css') },
      { in: join(__dirname, '../defaults/default.client.js'), out: join(DOM_STACK_DEFAULTS_PREFIX, 'default.client.js') }
    )
  }

  for (const page of siteData.pages) {
    for (const asset of pageBundleAssets(page)) entryPoints.push(join(src, asset.relname))
  }

  for (const layout of Object.values(siteData.layouts)) {
    for (const asset of layoutBundleAssets(layout)) entryPoints.push(join(src, asset.relname))
  }

  const browserVars = await resolveVars({
    varsPath: siteData?.globalVars?.filepath,
    key: 'browser',
  })

  const target = Array.isArray(opts?.target) ? opts.target : []

  const watch = modeOpts.watch ?? false
  /** @type {{ [varName: string]: string }} */
  const domstackDefines = createDomstackDefines({ opts, siteData, watch })
  /** @type {{ [varName: string]: string }} */
  const define = { ...domstackDefines }
  if (browserVars) {
    for (const [k, v] of Object.entries(browserVars)) {
      if (Object.hasOwn(define, k)) {
        throw new Error(`Conflict: "${k}" is reserved by domstack.`)
      }
      define[k] = JSON.stringify(v)
    }
  }

  /** @type {esbuild.BuildOptions} */
  const buildOpts = {
    entryPoints,
    /** @type {EsbuildLogLevel} */
    logLevel: 'silent',
    bundle: true,
    write: false,
    /** @type {EsbuildFormat} */
    format: 'esm',
    splitting: true,
    sourcemap: true,
    outdir: dest,
    outbase: src,
    target,
    define,
    metafile: true,
    // In watch mode use stable unhashed entry filenames so page HTML references remain stable.
    // Shared chunks still use content hashes so watch stays close to production behavior.
    entryNames: watch ? '[dir]/[name]' : '[dir]/[name]-[hash]',
    chunkNames: 'chunks/[ext]/[name]-[hash]',
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.gif': 'dataurl',
      '.svg': 'dataurl',
      '.webp': 'dataurl',
      '.avif': 'dataurl',
      '.ico': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.eot': 'file',
      '.otf': 'file',
    }
  }

  const esbuildSettingsExtends = siteData.esbuildSettings
    ? (await import(siteData.esbuildSettings.filepath)).default
    : (/** @type {typeof buildOpts} */ esbuildOpts) => esbuildOpts

  const extendedBuildOpts = await esbuildSettingsExtends(buildOpts)

  if (browserVars && Object.keys(browserVars).length > 0 && extendedBuildOpts.define !== buildOpts.define) {
    throw new Error(
      'Conflict: both the "browser" export in global.vars and "define" in esbuild.settings are set. ' +
      'Use one or the other to define browser constants.'
    )
  }

  return {
    ...extendedBuildOpts,
    // DomStack must own the write boundary and inventory even when settings
    // override these options. opts.metafile only controls publishing the JSON.
    write: false,
    metafile: true,
    define: preserveDomstackDefines(extendedBuildOpts.define, domstackDefines),
  }
}

/**
 * Keep domstack-owned browser build facts available even when esbuild.settings
 * replaces the define object. User settings may add custom defines, but they may
 * not override domstack's reserved DOMSTACK_* values.
 *
 * @param {esbuild.BuildOptions['define']} define
 * @param {{ [varName: string]: string }} domstackDefines
 * @returns {{ [varName: string]: string }}
 */
function preserveDomstackDefines (define, domstackDefines) {
  const mergedDefine = { ...(define ?? {}) }

  for (const [key, value] of Object.entries(domstackDefines)) {
    if (Object.hasOwn(mergedDefine, key) && mergedDefine[key] !== value) {
      throw new Error(`Conflict: "${key}" is reserved by domstack.`)
    }
    mergedDefine[key] = value
  }

  return mergedDefine
}

/**
 * @param {esbuild.BuildResult} result
 * @param {string} [dest]
 * @param {string} [writeDest]
 */
async function writeEsbuildOutputFiles (result, dest, writeDest) {
  for (const output of result.outputFiles ?? []) {
    const target = dest && writeDest ? resolve(writeDest, relative(dest, output.path)) : output.path
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, output.contents)
  }
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {esbuild.BuildResult} params.result
 * @param {boolean} params.shouldWrite
 */
async function writeMetafile ({ dest, result, shouldWrite }) {
  if (!result.metafile || !shouldWrite) return

  await writeFile(join(dest, 'domstack-esbuild-meta.json'), JSON.stringify(result.metafile, null, ' '))
}

/**
 * @param {object} params
 * @param {string} params.dest
 * @param {esbuild.BuildResult} params.result
 * @param {SiteData} params.siteData
 * @param {string} params.src
 * @returns {OutputMap}
 */
function applyBuildOutputMap ({ dest, result, siteData, src }) {
  const outputMap = result.metafile ? extractOutputMap(result.metafile, src, dest) : {}
  updateSiteDataOutputPaths(outputMap, siteData)
  return outputMap
}

/**
 * @returns {EsbuildReport}
 */
function emptyEsbuildReport () {
  return {}
}

/**
 * Build all of the bundles using esbuild.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {DomStackOpts | null} opts
 * @param {OutputRegistry} [registry]
 * @param {boolean} [watch]
 * @param {string} [publicDest] - Compile paths relative to the published destination, even when staging writes.
 * @returns {Promise<EsBuildStepResults>}
 */
export async function buildEsbuild (src, dest, siteData, opts, registry = new OutputRegistry(), watch = false, publicDest = dest) {
  try {
    const extendedBuildOpts = await createBrowserBuildOpts(src, publicDest, siteData, opts, { watch })

    const buildResults = await buildControlled(extendedBuildOpts)

    const outputMap = applyBuildOutputMap({ dest: publicDest, result: buildResults, siteData, src })
    const outputs = createEsbuildOutputRecords({
      src,
      dest: publicDest,
      siteData,
      buildResults,
      includeMetafileRecord: opts?.metafile !== false,
    })
    registry.claimRecords(outputs, 'esbuild:browser:')
    for (const output of outputs) output.filepath = resolve(dest, output.outputRelname)
    await writeEsbuildOutputFiles(buildResults, publicDest, dest)
    await writeMetafile({ dest, result: buildResults, shouldWrite: opts?.metafile !== false })

    return {
      type: 'esbuild',
      errors: buildResults.errors,
      warnings: buildResults.warnings,
      outputs,
      report: {
        buildResults,
        buildOpts: extendedBuildOpts,
        outputMap,
      },
    }
  } catch (err) {
    return {
      type: 'esbuild',
      errors: [
        new Error('Error building JS+CSS with esbuild', { cause: serializeEsbuildError(err) }),
      ],
      warnings: [],
      outputs: [],
      report: emptyEsbuildReport(),
    }
  }
}

/**
 * Build the site service worker after the domstack manifest is finalized.
 * The service worker is deliberately omitted from the domstack manifest so the
 * finalized manifest version can be embedded into the worker without a circular
 * content hash dependency.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {EsbuildBuildOptions | undefined} browserBuildOpts
 * @param {ServiceWorkerBuildDefines} [defines]
 * @param {OutputRegistry} [registry]
 * @returns {Promise<EsBuildStepResults>}
 */
export async function buildServiceWorkerEsbuild (src, dest, siteData, browserBuildOpts, defines = {}, registry = new OutputRegistry()) {
  if (!siteData.serviceWorker) {
    return {
      type: 'esbuild',
      errors: [],
      warnings: [],
      outputs: [],
      report: emptyEsbuildReport(),
    }
  }

  try {
    if (!browserBuildOpts) {
      throw new Error('Cannot build the service worker without resolved browser build options.')
    }
    const serviceWorkerBuildOpts = createServiceWorkerBuildOpts({
      buildOpts: browserBuildOpts,
      defines,
      serviceWorker: siteData.serviceWorker,
      src,
    })
    const serviceWorkerBuildResults = await buildControlled(serviceWorkerBuildOpts)

    const publicDest = serviceWorkerBuildOpts.outdir ?? dest
    const outputMap = applyBuildOutputMap({ dest: publicDest, result: serviceWorkerBuildResults, siteData, src })
    const outputs = createEsbuildOutputRecords({
      src,
      dest: publicDest,
      siteData,
      buildResults: serviceWorkerBuildResults,
      includeMetafileRecord: false,
    })
    registry.claimRecords(outputs, 'esbuild:service-worker:')
    for (const output of outputs) output.filepath = resolve(dest, output.outputRelname)
    await writeEsbuildOutputFiles(serviceWorkerBuildResults, publicDest, dest)

    return {
      type: 'esbuild',
      errors: serviceWorkerBuildResults.errors,
      warnings: serviceWorkerBuildResults.warnings,
      outputs,
      report: {
        buildResults: serviceWorkerBuildResults,
        buildOpts: serviceWorkerBuildOpts,
        outputMap,
      },
    }
  } catch (err) {
    return {
      type: 'esbuild',
      errors: [
        new Error('Error building service worker with esbuild', { cause: serializeEsbuildError(err) }),
      ],
      warnings: [],
      outputs: [],
      report: emptyEsbuildReport(),
    }
  }
}

/**
 * Production entry filenames are content-hashed globally. Service workers need
 * a stable root URL, so they get a tiny second build with a fixed entry name.
 * Emitting at /service-worker.js also gives the worker root scope by default.
 *
 * @param {object} params
 * @param {esbuild.BuildOptions} params.buildOpts
 * @param {ServiceWorkerBuildDefines} params.defines
 * @param {NonNullable<SiteData['serviceWorker']>} params.serviceWorker
 * @param {string} params.src
 * @returns {esbuild.BuildOptions}
 */
function createServiceWorkerBuildOpts ({ buildOpts, defines, serviceWorker, src }) {
  return {
    ...buildOpts,
    define: createServiceWorkerDefineMap(buildOpts.define, defines),
    entryPoints: [
      {
        in: join(src, serviceWorker.relname),
        out: 'service-worker',
      },
    ],
    entryNames: '[name]',
    splitting: false,
  }
}

/**
 * @param {esbuild.BuildOptions['define']} baseDefine
 * @param {ServiceWorkerBuildDefines} defines
 * @returns {{ [varName: string]: string }}
 */
function createServiceWorkerDefineMap (baseDefine, defines) {
  const define = { ...(baseDefine ?? {}) }
  const serviceWorkerDefine = defines.define ?? {}

  for (const [key, value] of Object.entries(serviceWorkerDefine)) {
    if (Object.hasOwn(define, key) && define[key] !== value) {
      throw new Error(`Conflict: "${key}" is already defined for the service-worker build.`)
    }
    define[key] = value
  }

  define['process.env.DOMSTACK_MANIFEST_VERSION'] = JSON.stringify(defines.manifestVersion ?? '')
  return define
}

/**
 * Provide domstack-owned build facts to all browser-side bundles.
 *
 * @param {object} params
 * @param {DomStackOpts | null} params.opts
 * @param {SiteData} params.siteData
 * @param {boolean} params.watch
 */
function createDomstackDefines ({ opts, siteData, watch }) {
  const hasServiceWorker = Boolean(siteData.serviceWorker)
  const domstackManifestSettingsPath = siteData?.domstackManifestSettings?.filepath

  return {
    'process.env.DOMSTACK_MANIFEST_URL': JSON.stringify(`/${DEFAULT_DOMSTACK_MANIFEST_FILENAME}`),
    'process.env.DOMSTACK_MANIFEST_VERSION': JSON.stringify(''),
    'process.env.DOMSTACK_MANIFEST_ENABLED': JSON.stringify(String(!watch && isDomstackManifestEnabled({ domstackManifestSettingsPath, opts: opts ?? undefined }))),
    'process.env.DOMSTACK_SERVICE_WORKER_URL': JSON.stringify(hasServiceWorker ? `/${SERVICE_WORKER_OUTPUT_RELNAME}` : ''),
    'process.env.DOMSTACK_SERVICE_WORKER_SCOPE': JSON.stringify(hasServiceWorker ? '/' : ''),
  }
}

/**
 * Create esbuild watch contexts with stable unhashed entry filenames.
 * The browser context keeps production-like code splitting.
 * The service-worker context is separate and self-contained so watch-mode cleanup can run reliably.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {DomStackOpts} opts
 * @param {{ onEnd?: (result: esbuild.BuildResult) => void, logger?: PinoLogger, writeDest?: () => string, promoteOutputs?: (outputs: DomstackManifestRecord[], phase: 'browser' | 'service-worker', write: () => Promise<void>) => Promise<void> }} [watchOpts]
 * @returns {Promise<{ context: DisposableBuildContext, outputMap: OutputMap, outputs: DomstackManifestRecord[], buildResults: esbuild.BuildResult, buildOpts: EsbuildBuildOptions }>}
 */
export async function buildEsbuildWatch (src, dest, siteData, opts, watchOpts = {}) {
  const logger = watchOpts.logger ?? opts.logger ?? createDomStackLogger()
  const extendedBuildOpts = await createBrowserBuildOpts(src, dest, siteData, opts, { watch: true })
  const browserWatch = await createWatchBuild({
    buildOpts: extendedBuildOpts,
    dest,
    label: 'JS/CSS',
    logger,
    ...(watchOpts.onEnd ? { onEnd: watchOpts.onEnd } : {}),
    promote: (result, write) => watchOpts.promoteOutputs
      ? watchOpts.promoteOutputs(createEsbuildOutputRecords({ src, dest, siteData, buildResults: result, includeMetafileRecord: opts?.metafile !== false }), 'browser', write)
      : write(),
    shouldWriteMetafile: opts?.metafile !== false,
    ...(watchOpts.writeDest ? { writeDest: watchOpts.writeDest } : {}),
  })

  const initialResult = browserWatch.initialResult

  /** @type {esbuild.BuildContext[]} */
  const contexts = [browserWatch.context]
  try {
    const outputMap = applyBuildOutputMap({ dest, result: initialResult, siteData, src })
    const outputs = createEsbuildOutputRecords({
      src,
      dest,
      siteData,
      buildResults: initialResult,
      includeMetafileRecord: opts?.metafile !== false,
    })

    if (siteData.serviceWorker) {
      // Keep service-worker-only defines and no-policy watch cleanup behavior out of browser bundles.
      const serviceWorkerBuildOpts = createServiceWorkerBuildOpts({
        buildOpts: extendedBuildOpts,
        defines: {},
        serviceWorker: siteData.serviceWorker,
        src,
      })
      const serviceWorkerWatch = await createWatchBuild({
        buildOpts: serviceWorkerBuildOpts,
        dest,
        label: 'Service worker',
        logger,
        promote: (result, write) => watchOpts.promoteOutputs
          ? watchOpts.promoteOutputs(createEsbuildOutputRecords({ src, dest, siteData, buildResults: result, includeMetafileRecord: false }), 'service-worker', write)
          : write(),
        shouldWriteMetafile: false,
        ...(watchOpts.writeDest ? { writeDest: watchOpts.writeDest } : {}),
      })
      contexts.push(serviceWorkerWatch.context)
      applyBuildOutputMap({
        dest,
        result: serviceWorkerWatch.initialResult,
        siteData,
        src,
      })
      outputs.push(...createEsbuildOutputRecords({
        src,
        dest,
        siteData,
        buildResults: serviceWorkerWatch.initialResult,
        includeMetafileRecord: false,
      }))
    }

    if (!siteData.serviceWorker) await watchOpts.promoteOutputs?.([], 'service-worker', async () => {})
    return {
      context: createDisposableBuildContext(contexts),
      outputMap,
      outputs,
      buildResults: initialResult,
      buildOpts: extendedBuildOpts,
    }
  } catch (error) {
    const cleanup = await Promise.allSettled(contexts.map(context => context.dispose()))
    const failures = cleanup.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError([error, ...failures], 'Esbuild watch startup and cleanup failed')
    throw error
  }
}

/**
 * @param {object} params
 * @param {esbuild.BuildOptions} params.buildOpts
 * @param {string} params.dest
 * @param {string} params.label
 * @param {PinoLogger} params.logger
 * @param {(result: esbuild.BuildResult) => void | Promise<void>} [params.onEnd]
 * @param {(result: esbuild.BuildResult, write: () => Promise<void>) => Promise<void>} [params.promote]
 * @param {boolean} params.shouldWriteMetafile
 * @param {() => string} [params.writeDest]
 * @returns {Promise<{ context: esbuild.BuildContext, initialResult: esbuild.BuildResult }>}
 */
async function createWatchBuild ({ buildOpts, dest, label, logger, onEnd, promote, shouldWriteMetafile, writeDest }) {
  validateEsbuildEntryOutputs(buildOpts)
  const initial = Promise.withResolvers()
  // Attach a rejection handler before watch() can deliver a failing initial build.
  initial.promise.catch(() => {})
  let isInitialBuild = true
  const plugins = buildOpts.plugins ?? []

  /** @type {esbuild.Plugin} */
  const onEndPlugin = {
    name: `domstack-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-on-end`,
    setup (build) {
      build.onEnd(async result => {
        const first = isInitialBuild
        isInitialBuild = false
        try {
          if (result.errors.length > 0) {
            rethrowEsbuildOutputConflict(result.errors, buildOpts)
            const failure = Object.assign(new Error(`${label} build failed`), {
              errors: result.errors.map(serializeEsbuildMessage),
              warnings: result.warnings.map(serializeEsbuildMessage),
            })
            if (first) {
              initial.reject(failure)
              return
            }
            logger.error({ errors: failure.errors, warnings: failure.warnings }, `${label} rebuild failed`)
          } else {
            if (result.warnings.length) {
              logger.warn({ warnings: result.warnings.map(serializeEsbuildMessage) }, `${label} build warnings`)
            }
            const write = async () => {
              const target = writeDest?.() ?? dest
              await writeEsbuildOutputFiles(result, dest, target)
              await writeMetafile({ dest: target, result, shouldWrite: shouldWriteMetafile })
            }
            if (promote) await promote(result, write)
            else await write()
            if (first) logger.debug(`${label} initial build complete`)
            else logger.info(`${label} rebuild complete`)
          }
          if (first) initial.resolve(result)
          else if (onEnd) await onEnd(result)
        } catch (error) {
          if (first) initial.reject(error)
          else logger.error({ err: error }, `${label} rebuild processing failed`)
        }
      })
    }
  }

  const contextOpts = { ...buildOpts, plugins: [...plugins, onEndPlugin] }

  /** @type {esbuild.BuildContext | undefined} */
  let context
  try {
    // @ts-ignore esbuild context() accepts same opts as build()
    context = await esbuild.context(contextOpts)
    await context.watch()
    const initialResult = await initial.promise

    return { context, initialResult }
  } catch (err) {
    await context?.dispose()
    throw serializeEsbuildError(err)
  }
}

/** @param {esbuild.BuildOptions} opts */
async function buildControlled (opts) {
  validateEsbuildEntryOutputs(opts)
  try {
    return await esbuild.build(opts)
  } catch (error) {
    const failure = /** @type {esbuild.BuildFailure} */ (error)
    rethrowEsbuildOutputConflict(failure.errors ?? [], opts)
    throw error
  }
}

/**
 * @param {esbuild.BuildContext[]} contexts
 * @returns {DisposableBuildContext}
 */
function createDisposableBuildContext (contexts) {
  return {
    async dispose () {
      const results = await Promise.allSettled(contexts.map(context => context.dispose()))
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, 'Esbuild watch cleanup failed')
    },
  }
}

/**
 * @param {object} params
 * @param {string} params.src
 * @param {string} params.dest
 * @param {SiteData} params.siteData
 * @param {esbuild.BuildResult} params.buildResults
 * @param {boolean} params.includeMetafileRecord
 * @returns {DomstackManifestRecord[]}
 */
export function createEsbuildOutputRecords ({ src, dest, siteData, buildResults, includeMetafileRecord }) {
  /** @type {DomstackManifestRecord[]} */
  const outputs = []
  const metafile = buildResults.metafile
  if (!metafile) return outputs

  const workerOutputRelnames = new Set()
  for (const page of siteData.pages) {
    if (!page.workers) continue
    for (const worker of Object.values(page.workers)) {
      if (worker.outputRelname) workerOutputRelnames.add(toPosix(worker.outputRelname))
    }
  }
  const serviceWorkerOutputRelname = siteData.serviceWorker?.outputRelname
    ? toPosix(siteData.serviceWorker.outputRelname)
    : undefined

  for (const [outputPath, outputMeta] of Object.entries(metafile.outputs)) {
    const filepath = resolve(outputPath)
    const outputRelname = toPosix(relative(dest, filepath))
    const kind = classifyEsbuildOutput({
      outputRelname,
      entryPoint: outputMeta.entryPoint,
      workerOutputRelnames,
      serviceWorkerOutputRelname,
    })

    outputs.push(createDomstackManifestRecord({
      dest,
      filepath,
      outputRelname,
      kind,
      ...(outputMeta.entryPoint
        ? {
            entryPoint: outputMeta.entryPoint,
            sourceRelname: toPosix(relative(src, resolve(outputMeta.entryPoint))),
          }
        : {}),
    }))
  }

  if (includeMetafileRecord) {
    outputs.push(createDomstackManifestRecord({
      dest,
      outputRelname: 'domstack-esbuild-meta.json',
      kind: 'metadata',
    }))
  }

  return outputs
}

/**
 * Classify a dest-relative esbuild output.
 *
 * @param {object} params
 * @param {string} params.outputRelname
 * @param {string | undefined} params.entryPoint
 * @param {Set<string>} params.workerOutputRelnames
 * @param {string | undefined} [params.serviceWorkerOutputRelname]
 * @returns {DomstackManifestKind}
 */
function classifyEsbuildOutput ({ outputRelname, entryPoint, workerOutputRelnames, serviceWorkerOutputRelname }) {
  const ext = extname(outputRelname)

  if (ext === '.map') return 'sourcemap'
  if (serviceWorkerOutputRelname && outputRelname === serviceWorkerOutputRelname) return 'service-worker'
  if (workerOutputRelnames.has(outputRelname)) return 'worker'
  if (ext === '.css') return 'style'
  if (ext === '.js' && entryPoint) return 'script'
  return 'chunk'
}
