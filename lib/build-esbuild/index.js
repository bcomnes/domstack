/**
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */

import { writeFile } from 'fs/promises'
import { join, relative, basename, resolve } from 'path'
import esbuild from 'esbuild'
import { resolveVars } from '../build-pages/resolve-vars.js'
import {
  classifyEsbuildOutput,
  createDomstackManifestRecord,
  getDomstackManifestFilename,
  shouldWriteDomstackManifest,
  toPosix,
} from '../domstack-manifest/index.js'

const __dirname = import.meta.dirname
const DOM_STACK_DEFAULTS_PREFIX = 'domstack-defaults'
const SERVICE_WORKER_OUTPUT_RELNAME = 'service-worker.js'

/**
 * @typedef {esbuild.Format} EsbuildFormat
 * @typedef {esbuild.LogLevel} EsbuildLogLevel
 * @typedef {{[relpath: string]: string}} OutputMap
 * @typedef {esbuild.BuildOptions} EsbuildBuildOptions

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
    if (page.pageStyle) {
      const outputRelname = outputMap[page.pageStyle.relname]
      if (outputRelname) {
        page.pageStyle.outputRelname = outputRelname
        page.pageStyle.outputName = basename(outputRelname)
      }
    }

    if (page.clientBundle) {
      const outputRelname = outputMap[page.clientBundle.relname]
      if (outputRelname) {
        page.clientBundle.outputRelname = outputRelname
        page.clientBundle.outputName = basename(outputRelname)
      }
    }

    if (page.workers) {
      for (const workerFile of Object.values(page.workers)) {
        const outputRelname = outputMap[workerFile.relname]
        if (outputRelname) {
          workerFile.outputRelname = outputRelname
          workerFile.outputName = basename(outputRelname)
        }
      }
    }
  }

  if (siteData.globalClient) {
    const outputRelname = outputMap[siteData.globalClient.relname]
    if (outputRelname) {
      siteData.globalClient.outputRelname = outputRelname
      siteData.globalClient.outputName = basename(outputRelname)
    }
  }

  if (siteData.globalStyle) {
    const outputRelname = outputMap[siteData.globalStyle.relname]
    if (outputRelname) {
      siteData.globalStyle.outputRelname = outputRelname
      siteData.globalStyle.outputName = basename(outputRelname)
    }
  }

  if (siteData.serviceWorker) {
    const outputRelname = outputMap[siteData.serviceWorker.relname]
    if (outputRelname) {
      siteData.serviceWorker.outputRelname = outputRelname
      siteData.serviceWorker.outputName = basename(outputRelname)
    }
  }

  for (const layout of Object.values(siteData.layouts)) {
    if (layout.layoutStyle) {
      const outputRelname = outputMap[layout.layoutStyle.relname]
      if (outputRelname) {
        layout.layoutStyle.outputRelname = outputRelname
        layout.layoutStyle.outputName = basename(outputRelname)
      }
    }

    if (layout.layoutClient) {
      const outputRelname = outputMap[layout.layoutClient.relname]
      if (outputRelname) {
        layout.layoutClient.outputRelname = outputRelname
        layout.layoutClient.outputName = basename(outputRelname)
      }
    }
  }

  if (siteData.defaultLayout) {
    const defaultClient = Object.values(outputMap).find(p => /^domstack-defaults.*\.js$/.test(p))
    const defaultStyle = Object.values(outputMap).find(p => /^domstack-defaults.*\.css$/.test(p))
    siteData.defaultClient = defaultClient ?? null
    siteData.defaultStyle = defaultStyle ?? null
  }
}

/**
 * Assemble the esbuild entry points and define map from siteData + opts.
 * Shared between one-shot build and watch context creation.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {DomStackOpts | null} opts
 * @param {{ watch?: boolean }} [modeOpts]
 * @returns {Promise<esbuild.BuildOptions>}
 */
async function assembleBuildOpts (src, dest, siteData, opts, modeOpts = {}) {
  const entryPoints = []
  if (siteData.globalClient) entryPoints.push(join(src, siteData.globalClient.relname))
  if (siteData.globalStyle) entryPoints.push(join(src, siteData.globalStyle.relname))
  if (modeOpts.watch && siteData.serviceWorker) {
    // The source may live anywhere under src, but the site service worker emits
    // at /service-worker.js so it gets root scope without Service-Worker-Allowed
    // headers. Production uses a separate stable-name build below because normal
    // production entry names are content-hashed; watch keeps it in the live context.
    entryPoints.push({
      in: join(src, siteData.serviceWorker.relname),
      out: 'service-worker',
    })
  }
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
    // In watch mode use stable (unhashed) entry filenames so the output map never changes.
    // Chunks always use a hash to avoid collisions when multiple entry points produce chunks with the same name.
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
 * Build all of the bundles using esbuild.
 *
 * @type {EsBuildStep}
 */
export async function buildEsbuild (src, dest, siteData, opts) {
  try {
    const extendedBuildOpts = await assembleBuildOpts(src, dest, siteData, opts, { watch: false })

    const buildResults = await esbuild.build(extendedBuildOpts)
    const serviceWorkerBuildOpts = createServiceWorkerBuildOpts({ buildOpts: extendedBuildOpts, src, siteData })
    const serviceWorkerBuildResults = serviceWorkerBuildOpts
      ? await esbuild.build(serviceWorkerBuildOpts)
      : undefined
    const combinedBuildResults = mergeBuildResults(buildResults, serviceWorkerBuildResults)

    if (combinedBuildResults.metafile && opts?.metafile !== false) {
      await writeFile(join(dest, 'domstack-esbuild-meta.json'), JSON.stringify(combinedBuildResults.metafile, null, ' '))
    }

    const outputMap = combinedBuildResults.metafile ? extractOutputMap(combinedBuildResults.metafile, src, dest) : {}
    updateSiteDataOutputPaths(outputMap, siteData)
    const outputs = createEsbuildOutputRecords({
      src,
      dest,
      siteData,
      buildResults: combinedBuildResults,
      includeMetafileRecord: opts?.metafile !== false,
    })

    return {
      type: 'esbuild',
      errors: combinedBuildResults.errors,
      warnings: combinedBuildResults.warnings,
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
      report: {
        outputs: [],
      },
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
 * @param {string} params.src
 * @param {SiteData} params.siteData
 * @returns {esbuild.BuildOptions | null}
 */
function createServiceWorkerBuildOpts ({ buildOpts, src, siteData }) {
  if (!siteData.serviceWorker) return null

  return {
    ...buildOpts,
    entryPoints: [
      {
        in: join(src, siteData.serviceWorker.relname),
        out: 'service-worker',
      },
    ],
    entryNames: '[name]',
  }
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

  return {
    'process.env.DOMSTACK_MANIFEST_URL': JSON.stringify(domstackManifestFilenameToUrl(getDomstackManifestFilename(opts ?? undefined))),
    'process.env.DOMSTACK_MANIFEST_ENABLED': JSON.stringify(String(!watch && shouldWriteDomstackManifest(opts ?? undefined))),
    'process.env.DOMSTACK_SERVICE_WORKER_URL': JSON.stringify(hasServiceWorker ? `/${SERVICE_WORKER_OUTPUT_RELNAME}` : ''),
    'process.env.DOMSTACK_SERVICE_WORKER_SCOPE': JSON.stringify(hasServiceWorker ? '/' : ''),
  }
}

/**
 * Convert the configured domstack manifest filename into the public file URL.
 *
 * @param {string} filename
 */
function domstackManifestFilenameToUrl (filename) {
  return `/${toPosix(filename).replace(/^\/+/, '')}`
}

/**
 * @param  {...(esbuild.BuildResult | undefined)} results
 * @returns {esbuild.BuildResult}
 */
function mergeBuildResults (...results) {
  const buildResults = /** @type {esbuild.BuildResult[]} */ (results.filter(Boolean))
  const metafiles = /** @type {esbuild.Metafile[]} */ (
    buildResults.map(result => result.metafile).filter(Boolean)
  )

  return /** @type {esbuild.BuildResult} */ ({
    errors: buildResults.flatMap(result => result.errors),
    warnings: buildResults.flatMap(result => result.warnings),
    metafile: mergeMetafiles(...metafiles),
  })
}

/**
 * @param  {...esbuild.Metafile} metafiles
 * @returns {esbuild.Metafile | undefined}
 */
function mergeMetafiles (...metafiles) {
  if (metafiles.length === 0) return undefined

  return {
    inputs: Object.assign({}, ...metafiles.map(metafile => metafile.inputs)),
    outputs: Object.assign({}, ...metafiles.map(metafile => metafile.outputs)),
  }
}

/**
 * Create an esbuild watch context with stable (unhashed) output filenames.
 * Calls onEnd after each rebuild. Returns the context for disposal.
 *
 * @param {string} src
 * @param {string} dest
 * @param {SiteData} siteData
 * @param {DomStackOpts} opts
 * @param {{ onEnd?: (result: esbuild.BuildResult) => void }} [watchOpts]
 * @returns {Promise<{ context: esbuild.BuildContext, outputMap: OutputMap, buildResults: esbuild.BuildResult, buildOpts: EsbuildBuildOptions }>}
 */
export async function buildEsbuildWatch (src, dest, siteData, opts, watchOpts = {}) {
  const extendedBuildOpts = await assembleBuildOpts(src, dest, siteData, opts, { watch: true })

  let startedWatching = false
  const plugins = extendedBuildOpts.plugins ?? []

  /** @type {esbuild.Plugin} */
  const onEndPlugin = {
    name: 'domstack-on-end',
    setup (build) {
      build.onEnd(async result => {
        if (result.errors.length > 0) {
          console.error('JS/CSS rebuild failed:')
          for (const err of result.errors) {
            console.error(' ', err.text)
          }
        } else {
          console.log('JS/CSS rebuild complete.')
        }
        if (result.metafile && opts?.metafile !== false) {
          await writeFile(join(dest, 'domstack-esbuild-meta.json'), JSON.stringify(result.metafile, null, ' '))
        }
        if (startedWatching && watchOpts.onEnd) watchOpts.onEnd(result)
      })
    }
  }

  const contextOpts = { ...extendedBuildOpts, plugins: [...plugins, onEndPlugin] }

  // @ts-ignore esbuild context() accepts same opts as build()
  const context = await esbuild.context(contextOpts)

  // Trigger initial build to get the metafile / outputMap
  const initialResult = await context.rebuild()

  if (initialResult.metafile && opts?.metafile !== false) {
    await writeFile(join(dest, 'domstack-esbuild-meta.json'), JSON.stringify(initialResult.metafile, null, ' '))
  }

  const outputMap = initialResult.metafile ? extractOutputMap(initialResult.metafile, src, dest) : {}
  updateSiteDataOutputPaths(outputMap, siteData)

  // Start watching — esbuild handles its own rebuild loop from here
  await context.watch()
  startedWatching = true

  return { context, outputMap, buildResults: initialResult, buildOpts: extendedBuildOpts }
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
