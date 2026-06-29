import {
  DOMSTACK_MANIFEST_ENABLED,
  DOMSTACK_MANIFEST_URL,
  shouldIncludePwaOutput,
} from '../pwa/cache-policy.js'
import { logWorker, serviceWorker } from './context.js'

/**
 * @typedef {object} DomstackManifestEntry
 * @property {string} url
 * @property {string} revision
 * @property {string} [kind]
 */

/**
 * @typedef {object} DomstackManifest
 * @property {string} version
 * @property {DomstackManifestEntry[]} entries
 */

/**
 * Fetch and validate Domstack's domstack manifest. Watch builds set
 * DOMSTACK_MANIFEST_ENABLED=false, so the worker exits early there.
 *
 * @returns {Promise<DomstackManifest | null>}
 */
export async function fetchDomstackManifest () {
  if (!DOMSTACK_MANIFEST_ENABLED) {
    logWorker('domstack manifest disabled for this build')
    return null
  }

  logWorker('fetching domstack manifest', { url: DOMSTACK_MANIFEST_URL })
  const response = await serviceWorker.fetch(DOMSTACK_MANIFEST_URL, {
    cache: 'no-store',
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch domstack manifest: ${response.status}`)
  }

  const data = await response.json()
  if (!isDomstackManifest(data)) {
    throw new Error('Domstack manifest has an unexpected shape')
  }

  const entries = data.entries.filter(entry => shouldIncludePwaOutput(entry, serviceWorker.location.origin))
  logWorker('domstack manifest loaded', {
    includedEntries: entries.length,
    totalEntries: data.entries.length,
    version: data.version,
  })

  return {
    version: data.version,
    entries,
  }
}

/**
 * @param {unknown} value
 * @returns {value is DomstackManifest}
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
 * @returns {value is DomstackManifestEntry}
 */
function isDomstackManifestEntry (value) {
  if (!value || typeof value !== 'object') return false
  const entry = /** @type {{ url?: unknown, revision?: unknown }} */ (value)

  return typeof entry.url === 'string' && typeof entry.revision === 'string'
}
