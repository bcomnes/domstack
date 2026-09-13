/**
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { DomstackManifestKind, DomstackManifestRecord } from '../domstack-manifest/index.js'
 * @import { Logger as PinoLogger } from 'pino'
 */

import { writeFile } from 'fs/promises'
import { importSettings } from './import-settings.js'
import { join, relative, basename, resolve, extname, posix, win32 } from 'path'
import esbuild from 'esbuild'
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
 * @typedef {NonNullable<esbuild.BuildOptions['entryPoints']>} EsbuildEntryPoints
 * @typedef {{ bundleRoot: string | null, buildResults: esbuild.BuildResult, buildOpts: EsbuildBuildOptions, outputMap: OutputMap }} EsbuildGroupReport
 * @typedef {{ bundleRoot: string | null, buildOpts: EsbuildBuildOptions }} BrowserBuild
 * @typedef {{ buildOpts: EsbuildBuildOptions, builds: BrowserBuild[] }} BrowserBuildConfiguration
 * @typedef {{
 *   buildResults?: esbuild.BuildResult,
 *   buildOpts?: EsbuildBuildOptions,
 *   outputMap?: OutputMap,
 *   builds?: EsbuildGroupReport[]
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

  if (value instanceof AggregateError) {
    const serialized = new AggregateError(value.errors.map(serializeEsbuildError), value.message,
      Object.hasOwn(value, 'cause') ? { cause: value.cause } : undefined)
    serialized.name = value.name
    if (value.stack) serialized.stack = value.stack
    // Keep nested failures visible to structured loggers as well as inspection.
    Object.defineProperty(serialized, 'errors', { enumerable: true })
    return serialized
  }

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
 * @returns {Promise<BrowserBuildConfiguration>}
 */
async function createBrowserBuildConfiguration (src, dest, siteData, opts, modeOpts = {}) {
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
    write: true,
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

  const esbuildSettings = siteData.esbuildSettings
    ? await importSettings(siteData.esbuildSettings.filepath)
    : null
  const esbuildSettingsExtends = esbuildSettings
    ? esbuildSettings.default
    : (/** @type {typeof buildOpts} */ esbuildOpts) => esbuildOpts

  if (typeof esbuildSettingsExtends !== 'function') {
    throw new TypeError('esbuild.settings must default-export a function.')
  }

  const extendedBuildOpts = await esbuildSettingsExtends(buildOpts)

  if (browserVars && Object.keys(browserVars).length > 0 && extendedBuildOpts.define !== buildOpts.define) {
    throw new Error(
      'Conflict: both the "browser" export in global.vars and "define" in esbuild.settings are set. ' +
      'Use one or the other to define browser constants.'
    )
  }

  const effectiveBuildOpts = {
    ...extendedBuildOpts,
    define: preserveDomstackDefines(extendedBuildOpts.define, domstackDefines),
  }
  const bundleRoots = normalizeBundleRoots(esbuildSettings?.bundleRoots)

  return {
    buildOpts: effectiveBuildOpts,
    builds: createBundleBuilds(effectiveBuildOpts, src, bundleRoots),
  }
}

/**
 * Normalize source-relative bundle roots into deterministic POSIX paths.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeBundleRoots (value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('bundleRoots must be an array of source-relative directory paths.')

  const roots = value.map((root, index) => {
    if (typeof root !== 'string' || root.length === 0) {
      throw new TypeError(`bundleRoots[${index}] must be a non-empty string.`)
    }

    const portableRoot = root.replaceAll('\\', '/')
    if (posix.isAbsolute(portableRoot) || win32.isAbsolute(root) || /^[a-z]:/i.test(portableRoot)) {
      throw new TypeError(`bundle root "${root}" must be relative to the source directory.`)
    }

    const normalized = posix.normalize(portableRoot).replace(/\/$/, '')
    if (/^[a-z]:/i.test(normalized)) throw new TypeError(`bundle root "${root}" must be relative to the source directory.`)
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
      throw new TypeError(`bundle root "${root}" must name a directory inside the source directory.`)
    }
    return normalized
  }).sort()

  const uniqueRoots = new Set(roots)
  if (uniqueRoots.size !== roots.length) throw new TypeError('bundleRoots must not contain duplicate paths.')
  return roots
}

/**
 * Partition effective esbuild entry points into a default build and named roots.
 * Entries in nested roots use the deepest matching root.
 *
 * @param {EsbuildBuildOptions} buildOpts
 * @param {string} src
 * @param {string[]} bundleRoots
 * @returns {BrowserBuild[]}
 */
export function createBundleBuilds (buildOpts, src, bundleRoots) {
  if (bundleRoots.length === 0) return [{ bundleRoot: null, buildOpts }]

  if (buildOpts.stdin !== undefined) throw new TypeError('bundleRoots does not support stdin. Use explicit entryPoints instead.')
  const entryPoints = buildOpts.entryPoints ?? []
  if (entryInputs(entryPoints).some(input => input.includes('*'))) {
    throw new TypeError('bundleRoots does not support glob entryPoints. Use explicit file paths instead.')
  }
  /** @type {Map<string | null, EsbuildEntryPoints>} */
  const groups = new Map()
  groups.set(null, createEmptyEntryPoints(entryPoints))
  for (const root of bundleRoots) groups.set(root, createEmptyEntryPoints(entryPoints))

  if (Array.isArray(entryPoints)) {
    for (const entryPoint of entryPoints) {
      const input = typeof entryPoint === 'string' ? entryPoint : entryPoint.in
      addEntryPoint(groups.get(findBundleRoot(input, buildOpts, src, bundleRoots)) ?? [], entryPoint)
    }
  } else {
    for (const [out, input] of Object.entries(entryPoints)) {
      const entries = groups.get(findBundleRoot(input, buildOpts, src, bundleRoots))
      if (entries && !Array.isArray(entries)) entries[out] = input
    }
  }

  return [null, ...bundleRoots].flatMap(bundleRoot => {
    const groupedEntryPoints = groups.get(bundleRoot)
    if (!groupedEntryPoints || entryPointCount(groupedEntryPoints) === 0) return []

    const groupBuildOpts = {
      ...buildOpts,
      entryPoints: groupedEntryPoints,
      ...(bundleRoot
        ? {
            chunkNames: prefixOutputTemplate(bundleRoot, buildOpts.chunkNames ?? 'chunks/[ext]/[name]-[hash]'),
            assetNames: prefixOutputTemplate(bundleRoot, buildOpts.assetNames ?? '[name]-[hash]'),
          }
        : {}),
    }
    return [{ bundleRoot, buildOpts: groupBuildOpts }]
  })
}

/** @param {esbuild.BuildOptions['entryPoints']} entryPoints */
function entryInputs (entryPoints) {
  return Array.isArray(entryPoints)
    ? entryPoints.map(entry => typeof entry === 'string' ? entry : entry.in)
    : Object.values(entryPoints ?? {})
}

/**
 * @param {EsbuildEntryPoints} entryPoints
 * @returns {EsbuildEntryPoints}
 */
function createEmptyEntryPoints (entryPoints) {
  return Array.isArray(entryPoints)
    ? /** @type {EsbuildEntryPoints} */ ([])
    : /** @type {EsbuildEntryPoints} */ ({})
}

/**
 * @param {esbuild.BuildOptions['entryPoints']} entryPoints
 * @param {string | { in: string, out: string }} entryPoint
 */
function addEntryPoint (entryPoints, entryPoint) {
  if (Array.isArray(entryPoints)) entryPoints.push(entryPoint)
}

/** @param {NonNullable<esbuild.BuildOptions['entryPoints']>} entryPoints */
function entryPointCount (entryPoints) {
  return Array.isArray(entryPoints) ? entryPoints.length : Object.keys(entryPoints).length
}

/**
 * @param {string} input
 * @param {EsbuildBuildOptions} buildOpts
 * @param {string} src
 * @param {string[]} bundleRoots
 * @returns {string | null}
 */
function findBundleRoot (input, buildOpts, src, bundleRoots) {
  const inputPath = resolve(buildOpts.absWorkingDir ?? process.cwd(), input)
  let match = null
  for (const root of bundleRoots) {
    const relativeInput = relative(resolve(src, root), inputPath)
    const insideRoot = relativeInput === '' || (
      relativeInput !== '..' &&
      !relativeInput.startsWith('../') &&
      !relativeInput.startsWith('..\\') &&
      !win32.isAbsolute(relativeInput)
    )
    if (insideRoot) {
      if (match === null || root.split('/').length > match.split('/').length) match = root
    }
  }
  return match
}

/**
 * Keep chunks and file-loader assets from independent contexts under their bundle root.
 *
 * @param {string} bundleRoot
 * @param {string} template
 */
function prefixOutputTemplate (bundleRoot, template) {
  return `${bundleRoot}/${template.replaceAll('\\', '/').replace(/^\/+/, '')}`
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
 * @type {EsBuildStep}
 */
export async function buildEsbuild (src, dest, siteData, opts) {
  try {
    const configuration = await createBrowserBuildConfiguration(src, dest, siteData, opts, { watch: false })
    const settled = await Promise.allSettled(configuration.builds.map(async build => {
      const buildResults = await esbuild.build(build.buildOpts)
      return {
        ...build,
        buildResults,
        outputMap: buildResults.metafile ? extractOutputMap(buildResults.metafile, src, dest) : {},
      }
    }))
    const failures = settled.filter(result => result.status === 'rejected').map(result => serializeEsbuildError(result.reason))
    if (failures.length === 1) throw failures[0]
    if (failures.length) throw new AggregateError(failures, 'Bundle root builds failed')
    const groupReports = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    const buildResults = aggregateBuildResults(groupReports.map(report => report.buildResults))

    await writeMetafile({ dest, result: buildResults, shouldWrite: opts?.metafile !== false })
    const outputMap = browserOutputMap(groupReports, src, dest)
    updateSiteDataOutputPaths(outputMap, siteData)
    const outputs = createEsbuildOutputRecords({
      src,
      dest,
      siteData,
      buildResults,
      includeMetafileRecord: opts?.metafile !== false,
    })

    return {
      type: 'esbuild',
      errors: buildResults.errors,
      warnings: buildResults.warnings,
      outputs,
      report: {
        buildResults,
        buildOpts: configuration.buildOpts,
        outputMap,
        builds: groupReports,
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
 * Present independent esbuild builds as one compatibility result and metafile.
 * Exact per-context results remain available in report.builds. Multi-build mangle
 * caches are intentionally not merged: independent builds may choose conflicting
 * renamings. Consumers must persist/reuse caches per group, not as a shared cache.
 *
 * @param {esbuild.BuildResult[]} results
 * @returns {esbuild.BuildResult}
 */
function aggregateBuildResults (results) {
  if (results.length === 1) return /** @type {esbuild.BuildResult} */ (results[0])

  /** @type {esbuild.Metafile} */
  const metafile = { inputs: {}, outputs: {} }
  const outputFilePaths = new Set()
  for (const result of results) {
    for (const file of result.outputFiles ?? []) {
      const outputPath = resolve(file.path)
      if (outputFilePaths.has(outputPath)) {
        throw new Error(`Bundle roots produced conflicting esbuild output "${file.path}".`)
      }
      outputFilePaths.add(outputPath)
    }
    Object.assign(metafile.inputs, result.metafile?.inputs)
    for (const [outputPath, outputMeta] of Object.entries(result.metafile?.outputs ?? {})) {
      if (Object.hasOwn(metafile.outputs, outputPath)) {
        throw new Error(`Bundle roots produced conflicting esbuild output "${outputPath}".`)
      }
      metafile.outputs[outputPath] = outputMeta
    }
  }

  return /** @type {esbuild.BuildResult} */ ({
    errors: results.flatMap(result => result.errors),
    warnings: results.flatMap(result => result.warnings),
    ...(results.some(result => result.metafile) ? { metafile } : {}),
    ...(results.some(result => result.outputFiles) ? { outputFiles: results.flatMap(result => result.outputFiles ?? []) } : {}),
  })
}

/**
 * Preserve dynamic-import mappings, but explicit entries always use their owning
 * build's output rather than a separately bundled copy in another graph.
 * @param {{ buildOpts: EsbuildBuildOptions, buildResults: esbuild.BuildResult }[]} reports
 * @param {string} src
 * @param {string} dest
 */
function browserOutputMap (reports, src, dest) {
  const maps = reports.map(report => report.buildResults.metafile ? extractOutputMap(report.buildResults.metafile, src, dest) : {})
  const outputMap = Object.assign({}, ...maps)
  reports.forEach((report, index) => {
    for (const input of entryInputs(report.buildOpts.entryPoints)) {
      const key = toPosix(relative(src, resolve(report.buildOpts.absWorkingDir ?? process.cwd(), input)))
      const output = maps[index]?.[key]
      if (output) outputMap[key] = output
    }
  })
  return /** @type {OutputMap} */ (outputMap)
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
 * @returns {Promise<EsBuildStepResults>}
 */
export async function buildServiceWorkerEsbuild (src, dest, siteData, browserBuildOpts, defines = {}) {
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
    const serviceWorkerBuildResults = await esbuild.build(serviceWorkerBuildOpts)
    const outputMap = applyBuildOutputMap({ dest, result: serviceWorkerBuildResults, siteData, src })

    return {
      type: 'esbuild',
      errors: serviceWorkerBuildResults.errors,
      warnings: serviceWorkerBuildResults.warnings,
      outputs: [],
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
 * @param {{ onEnd?: (result: esbuild.BuildResult) => void, logger?: PinoLogger }} [watchOpts]
 * @returns {Promise<{ context: DisposableBuildContext, outputMap: OutputMap, buildResults: esbuild.BuildResult, buildOpts: EsbuildBuildOptions }>}
 */
export async function buildEsbuildWatch (src, dest, siteData, opts, watchOpts = {}) {
  const logger = watchOpts.logger ?? opts.logger ?? createDomStackLogger()
  const configuration = await createBrowserBuildConfiguration(src, dest, siteData, opts, { watch: true })
  /** @type {esbuild.BuildContext[]} */
  const contexts = []
  /** @type {Map<BrowserBuild, esbuild.BuildResult>} */
  const latestResults = new Map()
  let rebuildProcessing = Promise.resolve()
  let initialized = false
  const reports = () => configuration.builds.flatMap(build => {
    const buildResults = latestResults.get(build)
    return buildResults ? [{ ...build, buildResults }] : []
  })

  const processRebuild = (/** @type {BrowserBuild} */ build, /** @type {esbuild.BuildResult} */ result) => {
    const pending = rebuildProcessing.then(async () => {
      if (result.errors.length === 0) {
        latestResults.set(build, result)
        if (initialized) {
          const aggregate = aggregateBuildResults(reports().map(report => report.buildResults))
          await writeMetafile({ dest, result: aggregate, shouldWrite: opts?.metafile !== false })
        }
      }
      await watchOpts.onEnd?.(result)
    })
    rebuildProcessing = pending.catch(() => {})
    return pending
  }

  try {
    for (const build of configuration.builds) {
      const label = build.bundleRoot ? `JS/CSS (${build.bundleRoot})` : 'JS/CSS'
      const browserWatch = await createWatchBuild({
        buildOpts: build.buildOpts,
        dest,
        label,
        logger,
        onEnd: result => processRebuild(build, result),
        shouldWriteMetafile: false,
      })
      contexts.push(browserWatch.context)
      latestResults.set(build, browserWatch.initialResult)
    }

    const initialization = rebuildProcessing.then(async () => {
      const currentReports = reports()
      const initialResult = aggregateBuildResults(currentReports.map(report => report.buildResults))
      await writeMetafile({ dest, result: initialResult, shouldWrite: opts?.metafile !== false })
      initialized = true
      const outputMap = browserOutputMap(currentReports, src, dest)
      updateSiteDataOutputPaths(outputMap, siteData)
      return { initialResult, outputMap }
    })
    rebuildProcessing = initialization.then(() => {}, () => {})
    const { initialResult, outputMap } = await initialization

    if (siteData.serviceWorker) {
      // Keep service-worker-only defines and no-policy watch cleanup behavior out of browser bundles.
      const serviceWorkerBuildOpts = createServiceWorkerBuildOpts({
        buildOpts: configuration.buildOpts,
        defines: {},
        serviceWorker: siteData.serviceWorker,
        src,
      })
      const serviceWorkerWatch = await createWatchBuild({
        buildOpts: serviceWorkerBuildOpts,
        dest,
        label: 'Service worker',
        logger,
        shouldWriteMetafile: false,
      })
      contexts.push(serviceWorkerWatch.context)
      applyBuildOutputMap({
        dest,
        result: serviceWorkerWatch.initialResult,
        siteData,
        src,
      })
    }

    return {
      context: createDisposableBuildContext(contexts, () => rebuildProcessing),
      outputMap,
      buildResults: initialResult,
      buildOpts: configuration.buildOpts,
    }
  } catch (error) {
    const cleanup = await Promise.allSettled(contexts.map(context => context.dispose()))
    await rebuildProcessing
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
 * @param {boolean} params.shouldWriteMetafile
 * @returns {Promise<{ context: esbuild.BuildContext, initialResult: esbuild.BuildResult }>}
 */
async function createWatchBuild ({ buildOpts, dest, label, logger, onEnd, shouldWriteMetafile }) {
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
            await writeMetafile({ dest, result, shouldWrite: shouldWriteMetafile })
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

/**
 * @param {esbuild.BuildContext[]} contexts
 * @param {() => Promise<void>} [drain]
 * @returns {DisposableBuildContext}
 */
function createDisposableBuildContext (contexts, drain) {
  return {
    async dispose () {
      const results = await Promise.allSettled(contexts.map(context => context.dispose()))
      results.push(...await Promise.allSettled([Promise.resolve().then(() => drain?.())]))
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
      entryPoint: outputMeta.entryPoint,
      sourceRelname: outputMeta.entryPoint ? toPosix(relative(src, resolve(outputMeta.entryPoint))) : undefined,
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
