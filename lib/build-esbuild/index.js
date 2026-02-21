/**
 * @import { BuildStep, DomStackOpts } from '../builder.js'
 * @import { PluginBuild, BuildResult } from 'esbuild'
 * @import { identifyPages } from '../identify-pages.js'
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
 * @typedef {object} BuildEsbuildWatchOpts
 * @property {boolean} [watch] - Enable watch mode using esbuild.context()
 * @property {(result: esbuild.BuildResult) => void} [onEnd] - Called after each esbuild rebuild in watch mode
 */

/**
 * Build all of the bundles using esbuild.
 *
 * @param {string} src
 * @param {string} dest
 * @param {Awaited<ReturnType<identifyPages>>} siteData
 * @param {DomStackOpts} [opts]
 * @param {BuildEsbuildWatchOpts} [watchOpts]
 * @returns {Promise<EsBuildStepResults & { context?: esbuild.BuildContext }>}
 */
export async function buildEsbuild (src, dest, siteData, opts, watchOpts = {}) {
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

    // Add web worker entry points
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

  /** @type {{
   *  [varName: string]: any
   * }} [description] */
  const define = {}

  if (browserVars) {
    for (const [k, v] of Object.entries(browserVars)) {
      define[k] = JSON.stringify(v)
    }
  }

  /**
   * Represents a mapping from relpaths to strings.
   * @typedef {{[relpath: string]: string}} OutputMap
   */

  const target = Array.isArray(opts?.target) ? opts.target : []

  // In watch mode, disable hashed filenames so output paths are stable across rebuilds.
  // Cache-busting is not needed in dev — browser-sync does a full reload anyway.
  const useHashes = !watchOpts.watch

  /** @type {EsbuildBuildOptions} */
  const buildOpts = {
    entryPoints,
    logLevel: 'silent',
    bundle: true,
    write: true,
    format: 'esm',
    splitting: true,
    sourcemap: true,
    outdir: dest,
    outbase: src,
    target,
    define,
    metafile: true,
    entryNames: useHashes ? '[dir]/[name]-[hash]' : '[dir]/[name]',
    chunkNames: useHashes ? 'chunks/[ext]/[name]-[hash]' : 'chunks/[ext]/[name]',
    jsx: 'automatic',
    jsxImportSource: 'preact'
  }

  const esbuildSettingsExtends = siteData.esbuildSettings
    ? (await import(siteData.esbuildSettings.filepath)).default
    : (/** @type {typeof buildOpts} */ esbuildOpts) => esbuildOpts

  const extendedBuildOpts = /** @type {EsbuildBuildOptions} */ (await esbuildSettingsExtends(buildOpts))

  if (browserVars && Object.keys(browserVars).length > 0 && extendedBuildOpts.define !== buildOpts.define) {
    throw new Error(
      'Conflict: both the "browser" export in global.vars and "define" in esbuild.settings are set. ' +
      'Use one or the other to define browser constants.'
    )
  }

  /**
   * Extract outputMap and update siteData output paths from a build result.
   * @param {esbuild.BuildResult} buildResults
   * @returns {OutputMap}
   */
  function extractOutputMap (buildResults) {
    /** @type {OutputMap} */
    const outputMap = {}
    Object.keys(buildResults?.metafile?.outputs || {}).forEach(file => {
      const entryPoint = buildResults?.metafile?.outputs[file]?.entryPoint
      if (entryPoint) {
        outputMap[relative(src, entryPoint)] = relative(dest, file)
      }
    })
    return outputMap
  }

  /**
   * Update siteData with output paths from the outputMap.
   * @param {OutputMap} outputMap
   */
  function updateSiteDataOutputPaths (outputMap) {
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

      // Add output paths for web workers
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

  if (watchOpts.watch) {
    // Watch mode: use esbuild.context() with onEnd plugin
    try {
      const watchBuildOpts = {
        ...extendedBuildOpts,
        plugins: [
          ...(extendedBuildOpts.plugins ?? []),
          {
            name: 'domstack-on-end',
            setup (/** @type {PluginBuild} */ build) {
              build.onEnd((/** @type {BuildResult} */ result) => {
                if (watchOpts.onEnd) watchOpts.onEnd(result)
              })
            }
          }
        ]
      }

      const context = await esbuild.context(watchBuildOpts)

      // Run initial build to get the outputMap and populate siteData paths
      const initialResult = await context.rebuild()

      if (initialResult.metafile) {
        await writeFile(join(dest, 'dom-stack-esbuild-meta.json'), JSON.stringify(initialResult.metafile, null, ' '))
      }

      const outputMap = extractOutputMap(initialResult)
      updateSiteDataOutputPaths(outputMap)

      // Start watching — subsequent rebuilds fire onEnd
      await context.watch()

      return {
        type: 'esbuild',
        errors: initialResult.errors,
        warnings: initialResult.warnings,
        report: {
          buildResults: initialResult,
          outputMap,
          buildOpts: extendedBuildOpts,
        },
        context,
      }
    } catch (err) {
      return {
        type: 'esbuild',
        errors: [
          new Error('Error building JS+CSS with esbuild (watch mode)', { cause: err }),
        ],
        warnings: [],
        report: {},
      }
    }
  }

  // Non-watch mode: single build
  try {
    // @ts-ignore This actually works fine
    const buildResults = await esbuild.build(extendedBuildOpts)
    if (buildResults.metafile) {
      await writeFile(join(dest, 'dom-stack-esbuild-meta.json'), JSON.stringify(buildResults.metafile, null, ' '))
    }

    const outputMap = extractOutputMap(buildResults)
    updateSiteDataOutputPaths(outputMap)

    return {
      type: 'esbuild',
      errors: buildResults.errors,
      warnings: buildResults.warnings,
      report: {
        buildResults,
        outputMap,
        buildOpts,
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
