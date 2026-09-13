import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
/** @type {Map<string, Map<string, string>>} */
const settingsContentUrls = new Map()
export const MAX_SETTINGS_MODULE_VERSIONS = 256
let settingsModuleVersions = 0

/** @param {string} filepath */
export async function importSettings (filepath) {
  const url = pathToFileURL(filepath)
  const hash = createHash('sha256').update(await readFile(filepath)).digest('hex')
  let contentUrls = settingsContentUrls.get(url.href)
  let contentUrl = contentUrls?.get(hash)
  if (!contentUrl) {
    // Node cannot evict ESM modules. Bound identities across all settings paths,
    // including failed imports, rather than pretending map eviction frees them.
    if (settingsModuleVersions >= MAX_SETTINGS_MODULE_VERSIONS) {
      throw new Error(`Cannot load a new version of esbuild settings "${filepath}": the process has reached the limit of ${MAX_SETTINGS_MODULE_VERSIONS} settings module versions. Restart the DOMStack process (not just its watch contexts) to load further settings changes.`)
    }
    if (!contentUrls) {
      contentUrls = new Map()
      settingsContentUrls.set(url.href, contentUrls)
    }
    // First load shares state with ordinary imports; reverted contents reuse it.
    if (contentUrls.size > 0) {
      url.searchParams.set('domstack', hash)
      // A new ESM URL alone does not invalidate Node's underlying CommonJS cache.
      delete require.cache[resolve(filepath)]
    }
    contentUrl = url.href
    contentUrls.set(hash, contentUrl)
    settingsModuleVersions++
  }
  return import(contentUrl)
}
