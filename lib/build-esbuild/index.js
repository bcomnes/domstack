/**
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { DomstackManifestKind, DomstackManifestRecord } from '../domstack-manifest/index.js'
 */

import { writeFile } from 'fs/promises'
import { join, relative, basename, resolve, extname } from 'path'
import esbuild from 'esbuild'
import { resolveVars } from '../build-pages/resolve-vars.js'
import {
  createDomstackManifestRecord,
  DEFAULT_DOMSTACK_MANIFEST_FILENAME,
  isDomstackManifestEnabled,
} from '../domstack-manifest/index.js'
import { toPosix } from '../helpers/path.js'

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

 * @typedef {BuildStep<
 *          'esbuild',
 *         {
 *           outputs: DomstackManifestRecord[]
 *         }
 * >} EsBuildStep
 */

/**
 * @typedef {Awaited<ReturnType<EsBuildStep>>} EsBuildStepResults
 */

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
  const entryPoints = []
  if (siteData.globalClient) entryPoints.push(join(src, siteData.globalClient.relname))
  if (siteData.globalStyle) entryPoints.push(join(src, siteData.globalStyle.relname))

  if (siteData.defaultLayout) {
    entryPoints.push(
      { in: join(__dirname, '../defaults/default.style.css'), out: join(DOM_STACK_DEFAULTS_PREFIX, 'default.style.css') },
      { in: join(__dirname, '../defaults/default.client.js'), out: join(DOM_STACK_DEFAULTS_PREFIX, 'default.client.js') }
    )
  }

  for (const page of siteData.pages) {
    if (page.clientBundle) entryPoints.push(join(src, page.clientBundle.relname))
    if (page.pageStyle) entryPoints.push(join(src, page.pageStyle.relname))

    if (page.workers) {
      for (const workerFile of Object.values(page.workers)) {
        entryPoints.push(join(src, workerFile.relname))
      }
    }
  }

  for (const layout of Object.values(siteData.layouts)) {
    if (layout.layoutClient) entryPoints.push(join(src, layout.layoutClient.relname))
    if (layout.layoutStyle) entryPoints.push(join(src, layout.layoutStyle.relname))
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
 * @returns {{ outputs: DomstackManifestRecord[] }}
 */
function emptyEsbuildReport () {
  return { outputs: [] }
}

/**
 * Build all of the bundles using esbuild.
 *
 * @type {EsBuildStep}
 */
export async function buildEsbuild (src, dest, siteData, opts) {
  try {
    const extendedBuildOpts = await createBrowserBuildOpts(src, dest, siteData, opts, { watch: false })

    const buildResults = await esbuild.build(extendedBuildOpts)

    await writeMetafile({ dest, result: buildResults, shouldWrite: opts?.metafile !== false })
    applyBuildOutputMap({ dest, result: buildResults, siteData, src })
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
      report: {
        outputs,
      },
    }
  } catch (err) {
    return {
      type: 'esbuild',
      errors: [
        new Error('Error building JS+CSS with esbuild', { cause: err }),
      ],
      warnings: [],
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
 * @param {DomStackOpts} opts
 * @param {ServiceWorkerBuildDefines} [defines]
 * @returns {Promise<EsBuildStepResults>}
 */
export async function buildServiceWorkerEsbuild (src, dest, siteData, opts, defines = {}) {
  if (!siteData.serviceWorker) {
    return {
      type: 'esbuild',
      errors: [],
      warnings: [],
      report: emptyEsbuildReport(),
    }
  }

  try {
    const extendedBuildOpts = await createBrowserBuildOpts(src, dest, siteData, opts, { watch: false })
    const serviceWorkerBuildOpts = createServiceWorkerBuildOpts({
      buildOpts: extendedBuildOpts,
      defines,
      serviceWorker: siteData.serviceWorker,
      src,
    })
    const serviceWorkerBuildResults = await esbuild.build(serviceWorkerBuildOpts)
    applyBuildOutputMap({ dest, result: serviceWorkerBuildResults, siteData, src })

    return {
      type: 'esbuild',
      errors: serviceWorkerBuildResults.errors,
      warnings: serviceWorkerBuildResults.warnings,
      report: emptyEsbuildReport(),
    }
  } catch (err) {
    return {
      type: 'esbuild',
      errors: [
        new Error('Error building service worker with esbuild', { cause: err }),
      ],
      warnings: [],
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
 * @param {{ onEnd?: (result: esbuild.BuildResult) => void }} [watchOpts]
 * @returns {Promise<{ context: DisposableBuildContext, outputMap: OutputMap, buildResults: esbuild.BuildResult, buildOpts: EsbuildBuildOptions }>}
 */
export async function buildEsbuildWatch (src, dest, siteData, opts, watchOpts = {}) {
  const extendedBuildOpts = await createBrowserBuildOpts(src, dest, siteData, opts, { watch: true })
  const browserWatch = await createWatchBuild({
    buildOpts: extendedBuildOpts,
    dest,
    label: 'JS/CSS',
    onEnd: watchOpts.onEnd,
    shouldWriteMetafile: opts?.metafile !== false,
  })

  const initialResult = browserWatch.initialResult

  await writeMetafile({ dest, result: initialResult, shouldWrite: opts?.metafile !== false })
  const outputMap = applyBuildOutputMap({ dest, result: initialResult, siteData, src })

  /** @type {esbuild.BuildContext[]} */
  const contexts = [browserWatch.context]

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
      shouldWriteMetafile: false,
    })
    applyBuildOutputMap({
      dest,
      result: serviceWorkerWatch.initialResult,
      siteData,
      src,
    })
    contexts.push(serviceWorkerWatch.context)
  }

  return {
    context: createDisposableBuildContext(contexts),
    outputMap,
    buildResults: initialResult,
    buildOpts: extendedBuildOpts,
  }
}

/**
 * @param {object} params
 * @param {esbuild.BuildOptions} params.buildOpts
 * @param {string} params.dest
 * @param {string} params.label
 * @param {(result: esbuild.BuildResult) => void | Promise<void>} [params.onEnd]
 * @param {boolean} params.shouldWriteMetafile
 * @returns {Promise<{ context: esbuild.BuildContext, initialResult: esbuild.BuildResult }>}
 */
async function createWatchBuild ({ buildOpts, dest, label, onEnd, shouldWriteMetafile }) {
  let startedWatching = false
  const plugins = buildOpts.plugins ?? []

  /** @type {esbuild.Plugin} */
  const onEndPlugin = {
    name: `domstack-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-on-end`,
    setup (build) {
      build.onEnd(async result => {
        if (result.errors.length > 0) {
          console.error(`${label} rebuild failed:`)
          for (const err of result.errors) {
            console.error(' ', err.text)
          }
        } else {
          console.log(`${label} rebuild complete.`)
        }
        await writeMetafile({ dest, result, shouldWrite: shouldWriteMetafile })
        if (startedWatching && onEnd) await onEnd(result)
      })
    }
  }

  const contextOpts = { ...buildOpts, plugins: [...plugins, onEndPlugin] }

  // @ts-ignore esbuild context() accepts same opts as build()
  const context = await esbuild.context(contextOpts)
  const initialResult = await context.rebuild()

  await context.watch()
  startedWatching = true

  return { context, initialResult }
}

/**
 * @param {esbuild.BuildContext[]} contexts
 * @returns {DisposableBuildContext}
 */
function createDisposableBuildContext (contexts) {
  return {
    async dispose () {
      await Promise.all(contexts.map(context => context.dispose()))
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
