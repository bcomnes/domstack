/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { PageData as PageDataClass } from '../page-data.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 */

import { join } from 'path'
import { writeFile, mkdir } from 'fs/promises'
import { createDomstackManifestRecord } from '../../domstack-manifest/index.js'

/**
 * @typedef {Object} BuilderOptions
 * @property {string | null | undefined} [markdownItSettingsPath] - Path to the markdown-it settings file
 */

/**
 * @template {Record<string, any>} T
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef {PageDataClass<T, U, V, D>} PageData
 */

/**
 * Common parameters for page functions.
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef {object} PageFunctionParams
 * @property {T} vars - All default, global, layout, page, and builder vars shallow merged.
 * @property {string[]} [scripts] - Array of script URLs to include.
 * @property {string[]} [styles] - Array of stylesheet URLs to include.
 * @property {D} data - Declared global data for this page and layout.
 * @property {PageInfo} page - Info about the current page
 * @property {Object<string, string>} [workers] - Map of worker names to their output paths
 */

/**
 * Synchronous page function for rendering a page layout.
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @callback PageFunction
 * @param {PageFunctionParams<T, U, D>} params - The parameters for the pageLayout.
 * @returns {U | Promise<U>} The rendered inner page thats compatible with its matched layout
 */

/**
 * Asynchronous page function for rendering a page layout.
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @callback AsyncPageFunction
 * @param {PageFunctionParams<T, U, D>} params - The parameters for the pageLayout.
 * @returns {Promise<U>} The rendered inner page thats compatible with its matched layout
 */

/**
 * pageLayout functions can be used to type a name.layout.js file (can be sync or async).
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @typedef {PageFunction<T, U, D> | AsyncPageFunction<T, U, D>} InternalPageFunction
 */

/**
 * @template {Record<string, any>} T - The type of variables for the page
 * @template [U=any] U - The return type of the pageLayout function
 * @typedef PageBuilderResult
 * @property {Partial<T>} vars - Any variables resolved by the builder
 * @property {InternalPageFunction<T, U>} pageLayout - The function that returns the rendered page
 */

/**
 * @template {Record<string, any>} T - The type of variables for the page
 * @template [U=any] U - The return type of the pageLayout function
 * @callback PageBuilderType
 *
 * @param {object} params
 * @param {PageInfo} params.pageInfo
 * @param {BuilderOptions} [params.options]
 * @returns {Promise<PageBuilderResult<T, U>>} - The results of the build step.
 */

/**
 * Handles rendering and writing a page to disk
 * @template {Record<string, any>} T
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @template {object} [D=Record<string, unknown>] - Declared global data.
 * @param {object} params
 * @param {string} params.dest  - The dest folder.
 * @param {PageData<T, U, V, D>} params.page  - The PageInfo object of the current page
 * @returns {Promise<{ pageFilePath: string, outputs: DomstackManifestRecord[] }>}
 */
export async function pageWriter ({
  dest,
  page,
}) {
  if (!page.pageInfo) throw new Error('Uninitialzied page detected')
  const pageDir = join(dest, page.pageInfo.path)
  const pageFilePath = join(pageDir, page.pageInfo.outputName)

  const formattedPageOutput = await page.renderFullPage()
  const vars = page.vars
  const manifestRole = extractManifestRole(vars)
  await mkdir(pageDir, { recursive: true })
  await writeFile(pageFilePath, formattedPageOutput)

  /** @type {DomstackManifestRecord[]} */
  const outputs = [
    createDomstackManifestRecord({
      dest,
      filepath: pageFilePath,
      outputRelname: page.pageInfo.outputRelname,
      kind: 'page',
      url: page.pageInfo.url,
      sourceRelname: page.pageInfo.pageFile.relname,
      pagePath: page.pageInfo.path,
      pageUrl: page.pageInfo.url,
      pageVars: copyPageVars(vars),
      manifestRole,
      page: {
        path: page.pageInfo.path,
        url: page.pageInfo.url,
      },
    }),
  ]

  // Generate meta.json with worker mappings if page has workers
  if (page.pageInfo?.workers) {
    /** @type { {[workerName: string]: string } } */
    const workerMappings = {}

    for (const [workerName, workerFile] of Object.entries(page.pageInfo.workers)) {
      if (workerFile.outputRelname) {
        // Get the basename without the path for client usage
        const outputBasename = workerFile.outputName
        if (outputBasename) {
          workerMappings[workerName] = outputBasename
        }
      }
    }

    if (Object.keys(workerMappings).length > 0) {
      const workersFilePath = join(pageDir, 'workers.json')
      const workersContent = JSON.stringify(workerMappings, null, 2)
      await writeFile(workersFilePath, workersContent)
      outputs.push(createDomstackManifestRecord({
        dest,
        filepath: workersFilePath,
        outputRelname: join(page.pageInfo.path, 'workers.json'),
        kind: 'worker-manifest',
        pagePath: page.pageInfo.path,
        pageUrl: page.pageInfo.url,
      }))
    }
  }

  return { pageFilePath, outputs }
}

/**
 * Copy top-level vars that can be sent from the page worker. Runtime-only values
 * such as PageData arrays stay available during rendering but are left out here.
 *
 * @param {Record<string, unknown>} vars
 * @returns {Record<string, unknown>}
 */
function copyPageVars (vars) {
  /** @type {Record<string, unknown>} */
  const copied = {}
  for (const [key, value] of Object.entries(vars)) {
    try {
      copied[key] = structuredClone(value)
    } catch {
      // This value is only available while rendering inside the page worker.
    }
  }
  return copied
}

/**
 * Reads the optional page-level role override copied to the public manifest.
 *
 * @param {unknown} vars
 * @returns {string | undefined}
 */
function extractManifestRole (vars) {
  if (!vars || typeof vars !== 'object') return undefined
  const source = /** @type {{ manifestRole?: unknown }} */ (vars)
  return typeof source.manifestRole === 'string' ? source.manifestRole : undefined
}
