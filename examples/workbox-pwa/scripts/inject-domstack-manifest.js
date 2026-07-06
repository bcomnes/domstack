import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const manifestPath = join(publicDir, 'domstack-manifest.json')
const serviceWorkerPath = join(publicDir, 'service-worker.js')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!isDomstackManifest(manifest)) {
  throw new Error('Expected public/domstack-manifest.json to contain a Domstack manifest')
}

const precacheEntries = manifest.entries
  .filter(entry => entry.revision)
  .map(entry => ({
    revision: entry.revision,
    url: entry.url,
  }))

if (!precacheEntries.some(entry => entry.url === '/offline/' || entry.url === '/offline/index.html')) {
  throw new Error('Expected the Domstack manifest to include the offline fallback route')
}

let serviceWorker = await readFile(serviceWorkerPath, 'utf8')
if (!serviceWorker.includes('self.__WB_MANIFEST')) {
  throw new Error('Expected public/service-worker.js to include the Workbox self.__WB_MANIFEST placeholder')
}

serviceWorker = serviceWorker.replace(
  'self.__WB_MANIFEST',
  JSON.stringify(precacheEntries)
)
serviceWorker = serviceWorker.replace(
  /(["'])__DOMSTACK_PRECACHE_VERSION__\1/g,
  JSON.stringify(manifest.version)
)

await writeFile(serviceWorkerPath, serviceWorker)
console.info(
  `[domstack-workbox-pwa] injected ${precacheEntries.length} Domstack manifest entries into service-worker.js (${manifest.version.slice(0, 12)})`
)

/**
 * @param {unknown} value
 * @returns {value is { version: string, entries: Array<{ url: string, revision?: string | null }> }}
 */
function isDomstackManifest (value) {
  if (!value || typeof value !== 'object') return false
  const manifest = /** @type {{ version?: unknown, entries?: unknown }} */ (value)
  return typeof manifest.version === 'string' &&
    Array.isArray(manifest.entries) &&
    manifest.entries.every(isDomstackManifestEntry)
}

/**
 * @param {unknown} value
 * @returns {value is { url: string, revision?: string | null }}
 */
function isDomstackManifestEntry (value) {
  if (!value || typeof value !== 'object') return false
  const entry = /** @type {{ url?: unknown, revision?: unknown }} */ (value)
  return typeof entry.url === 'string' &&
    (entry.revision === undefined || entry.revision === null || typeof entry.revision === 'string')
}
