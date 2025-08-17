/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { PageData } from '../page-data.js'
 */

import { join } from 'path'
import { writeFile, mkdir } from 'fs/promises'

/**
 * @typedef {Object} BuilderOptions
 * @property {string | null | undefined} [markdownItSettingsPath] - Path to the markdown-it settings file
 */

/**
 * @template {Record<string, any>} T
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @template [V=string] V - The return type of the layout function (defaults to string)
 * @typedef {PageData<T, U, V>} PageData
 */

/**
 * Common parameters for page functions.
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @typedef {object} PageFunctionParams
 * @property {T} vars - All default, global, layout, page, and builder vars shallow merged.
 * @property {string[]} [scripts] - Array of script URLs to include.
 * @property {string[]} [styles] - Array of stylesheet URLs to include.
 * @property {PageInfo} page - Info about the current page
 * @property {PageData<T, U, string>[]} pages - An array of info about every page
 * @property {Object<string, string>} [workers] - Map of worker names to their output paths
 */

/**
 * Synchronous page function for rendering a page layout.
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @callback PageFunction
 * @param {PageFunctionParams<T, U>} params - The parameters for the pageLayout.
 * @returns {U | Promise<U>} The rendered inner page thats compatible with its matched layout
 */

/**
 * Asynchronous page function for rendering a page layout.
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @callback AsyncPageFunction
 * @param {PageFunctionParams<T, U>} params - The parameters for the pageLayout.
 * @returns {Promise<U>} The rendered inner page thats compatible with its matched layout
 */

/**
 * pageLayout functions can be used to type a name.layout.js file (can be sync or async).
 *
 * @template {Record<string, any>} T - The type of variables passed to the page function
 * @template [U=any] U - The return type of the page function (defaults to any)
 * @typedef {PageFunction<T, U> | AsyncPageFunction<T, U>} InternalPageFunction
 */

/**
 * @template {Record<string, any>} T - The type of variables for the page
 * @template [U=any] U - The return type of the pageLayout function
 * @typedef PageBuilderResult
 * @property {object} vars - Any variables resolved by the builder
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
 * @param {object} params
 * @param {string} params.src   - The src folder.
 * @param {string} params.dest  - The dest folder.
 * @param {PageData<T, U, V>} params.page  - The PageInfo object of the current page
 * @param {PageData<T, U, V>[]} params.pages - The PageInfo[] array of all pages
 */
export async function pageWriter ({
  dest,
  page,
  pages,
}) {
  if (!page.pageInfo) throw new Error('Uninitialzied page detected')
  const pageDir = join(dest, page.pageInfo.path)
  const pageFilePath = join(pageDir, page.pageInfo.outputName)

  const formattedPageOutput = await page.renderFullPage({ pages })
  await mkdir(pageDir, { recursive: true })
  await writeFile(pageFilePath, formattedPageOutput)

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
    }
  }

  return { pageFilePath }
}
