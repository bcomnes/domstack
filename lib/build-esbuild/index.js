/**
 * @import { BuildStep, SiteData, DomStackOpts } from '../builder.js'
 */

import { writeFile } from 'fs/promises'
import { join, relative, basename } from 'path'
import esbuild from 'esbuild'
import { resolveVars } from '../build-pages/resolve-vars.js'

const __dirname = import.meta.dirname
const DOM_STACK_DEFAULTS_PREFIX = 'dom-stack-defaults'

/**
 * @typedef {esbuild.Format} EsbuildFormat
 * @typedef {esbuild.LogLevel} EsbuildLogLevel
 * @typedef {{[relpath: string]: string}} OutputMap
 * @typedef {esbuild.BuildOptions} EsbuildBuildOptions
 * @typedef {Awaited<ReturnType<esbuild.build>>} EsbuildBuildResults

 * @typedef {BuildStep<
 *          'esbuild',
 *         {
 *           buildResults?: EsbuildBuildResults
 *           buildOpts?: EsbuildBuildOptions,
 *           outputMap?: OutputMap
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
function extractOutputMap (metafile, src, dest) {
  /** @type {OutputMap} */
  const outputMap = {}
  Object.keys(metafile.outputs).forEach(file => {
    const entryPoint = metafile.outputs[file]?.entryPoint
    if (entryPoint) {
      outputMap[relative(src, entryPoint)] = relative(dest, file)
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
    const defaultClient = Object.values(outputMap).find(p => /^dom-stack-defaults.*\.js$/.test(p))
    const defaultStyle = Object.values(outputMap).find(p => /^dom-stack-defaults.*\.css$/.test(p))
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

  /** @type {{ [varName: string]: any }} */
  const define = {}
  if (browserVars) {
    for (const [k, v] of Object.entries(browserVars)) {
      define[k] = JSON.stringify(v)
    }
  }

  const target = Array.isArray(opts?.target) ? opts.target : []

  const watch = modeOpts.watch ?? false

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
    // In watch mode use stable (unhashed) filenames so the output map never changes.
    entryNames: watch ? '[dir]/[name]' : '[dir]/[name]-[hash]',
    chunkNames: watch ? 'chunks/[ext]/[name]' : 'chunks/[ext]/[name]-[hash]',
    jsx: 'automatic',
    jsxImportSource: 'preact'
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

  return extendedBuildOpts
}

/**
 * Build all of the bundles using esbuild.
 *
 * @type {EsBuildStep}
 */
export async function buildEsbuild (src, dest, siteData, opts) {
  try {
    const extendedBuildOpts = await assembleBuildOpts(src, dest, siteData, opts, { watch: false })

    // @ts-ignore This actually works fine
    const buildResults = await esbuild.build(extendedBuildOpts)

    if (buildResults.metafile) {
      await writeFile(join(dest, 'dom-stack-esbuild-meta.json'), JSON.stringify(buildResults.metafile, null, ' '))
    }

    const outputMap = buildResults.metafile ? extractOutputMap(buildResults.metafile, src, dest) : {}
    updateSiteDataOutputPaths(outputMap, siteData)

    return {
      type: 'esbuild',
      errors: buildResults.errors,
      warnings: buildResults.warnings,
      report: {
        buildResults,
        outputMap,
        // @ts-ignore This is fine
        buildOpts: extendedBuildOpts,
      },
    }
  } catch (err) {
    return {
      type: 'esbuild',
      errors: [
        new Error('Error building JS+CSS with esbuild', { cause: err }),
      ],
      warnings: [],
      report: {},
    }
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
 * @returns {Promise<{ context: esbuild.BuildContext, outputMap: OutputMap }>}
 */
export async function buildEsbuildWatch (src, dest, siteData, opts, watchOpts = {}) {
  const extendedBuildOpts = await assembleBuildOpts(src, dest, siteData, opts, { watch: true })

  const plugins = extendedBuildOpts.plugins ?? []

  /** @type {esbuild.Plugin} */
  const onEndPlugin = {
    name: 'domstack-on-end',
    setup (build) {
      build.onEnd(result => {
        if (result.errors.length > 0) {
          console.error('JS/CSS rebuild failed:')
          for (const err of result.errors) {
            console.error(' ', err.text)
          }
        } else {
          console.log('JS/CSS rebuild complete.')
        }
        if (watchOpts.onEnd) watchOpts.onEnd(result)
      })
    }
  }

  const contextOpts = { ...extendedBuildOpts, plugins: [...plugins, onEndPlugin] }

  // @ts-ignore esbuild context() accepts same opts as build()
  const context = await esbuild.context(contextOpts)

  // Trigger initial build to get the metafile / outputMap
  const initialResult = await context.rebuild()

  if (initialResult.metafile) {
    await writeFile(join(dest, 'dom-stack-esbuild-meta.json'), JSON.stringify(initialResult.metafile, null, ' '))
  }

  const outputMap = initialResult.metafile ? extractOutputMap(initialResult.metafile, src, dest) : {}
  updateSiteDataOutputPaths(outputMap, siteData)

  // Start watching — esbuild handles its own rebuild loop from here
  await context.watch()

  return { context, outputMap }
}
