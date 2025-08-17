/**
 * @import { SiteData } from '../builder.js'
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus } from 'node:os'
import pMap from 'p-map'

const MAX_CONCURRENCY = Math.min(cpus().length, 24)

/**
 * Create folders for each page.
 *
 * @function
 * @param {string} dest - The destination directory where folders will be created.
 * @param {SiteData} siteData - An object containing an array of pages, each having a path where a folder should be created.
 * @returns {Promise<void>} - A promise that resolves when all directories have been created.
 */
export async function ensureDest (dest, siteData) {
  await mkdir(dest, { recursive: true })

  await pMap(siteData.pages, async (page) => {
    await mkdir(join(dest, page.path), { recursive: true })
  }, { concurrency: MAX_CONCURRENCY })

  await pMap(siteData.templates, async (template) => {
    await mkdir(join(dest, template.path), { recursive: true })
  }, { concurrency: MAX_CONCURRENCY })
}
