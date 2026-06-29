import {
  OFFLINE_FALLBACK_URL,
} from '../pwa/cache-policy.js'
import {
  clearPendingVersion,
  cleanupStaticCaches,
  copyCacheEntries,
  getActiveVersion,
  getPendingVersion,
  installCacheName,
  setActiveVersion,
  setPendingVersion,
  staticCacheName,
} from './cache.js'
import { logWorker, serviceWorker } from './context.js'
import { fetchDomstackManifest } from './domstack-manifest.js'

const MAX_PARALLEL_FETCHES = 8

/**
 * Fetch, validate, and stage a full static cache from the current domstack
 * manifest. The active cache is not changed until activation is accepted.
 *
 * @param {{ force?: boolean }} [opts]
 */
export async function prepareStaticCache (opts = {}) {
  const manifest = await fetchDomstackManifest()
  if (!manifest) return { status: 'disabled', version: null }

  const activeVersion = await getActiveVersion()
  const pendingVersion = await getPendingVersion()
  logWorker('preparing static cache', {
    activeVersion,
    entries: manifest.entries.length,
    force: Boolean(opts.force),
    pendingVersion,
    version: manifest.version,
  })
  if (!opts.force && (manifest.version === activeVersion || manifest.version === pendingVersion)) {
    logWorker('static cache already current or pending', {
      activeVersion,
      pendingVersion,
      version: manifest.version,
    })
    return { status: 'current', version: manifest.version }
  }

  const installName = installCacheName(manifest.version)
  const finalName = staticCacheName(manifest.version)

  await serviceWorker.caches.delete(installName)
  await serviceWorker.caches.delete(finalName)

  const cache = await serviceWorker.caches.open(installName)
  await cacheManifestEntries(cache, manifest.entries)
  await copyCacheEntries(installName, finalName)
  await serviceWorker.caches.delete(installName)
  await setPendingVersion(manifest.version)
  logWorker('static cache staged and ready', {
    cacheName: finalName,
    version: manifest.version,
  })

  return { status: 'ready', version: manifest.version }
}

/**
 * Promote a staged static cache to the active version.
 */
export async function activatePendingCache () {
  const pendingVersion = await getPendingVersion()
  if (!pendingVersion) {
    const activeVersion = await getActiveVersion()
    logWorker('no pending cache to activate', { activeVersion })
    await cleanupStaticCaches(activeVersion)
    return activeVersion
  }

  logWorker('activating pending cache', { pendingVersion })
  await setActiveVersion(pendingVersion)
  await clearPendingVersion()
  await cleanupStaticCaches(pendingVersion)

  return pendingVersion
}

/**
 * @param {Cache} cache
 * @param {{ url: string, revision: string }[]} entries
 */
async function cacheManifestEntries (cache, entries) {
  const queue = [...entries]
  logWorker('caching domstack manifest entries', {
    concurrency: Math.min(MAX_PARALLEL_FETCHES, queue.length),
    entries: queue.length,
  })
  const workers = Array.from(
    { length: Math.min(MAX_PARALLEL_FETCHES, queue.length) },
    () => cacheNextEntry(cache, queue)
  )

  await Promise.all(workers)
}

/**
 * @param {Cache} cache
 * @param {{ url: string, revision: string }[]} queue
 */
async function cacheNextEntry (cache, queue) {
  while (queue.length > 0) {
    const entry = queue.shift()
    if (!entry) return
    await cacheEntry(cache, entry)
  }
}

/**
 * @param {Cache} cache
 * @param {{ url: string, revision: string }} entry
 */
async function cacheEntry (cache, entry) {
  logWorker('fetching cache entry', { url: entry.url })
  const request = new Request(entry.url, {
    credentials: 'same-origin',
  })
  const response = await serviceWorker.fetch(request, {
    cache: 'reload',
    credentials: 'same-origin',
  })

  assertCacheableResponse(entry.url, response)

  const revisionMatches = await responseMatchesRevision(response, entry.revision)
  if (!revisionMatches) {
    throw new Error(`Cached response revision mismatch for ${entry.url}`)
  }

  await cache.put(request, response)
  logWorker('cached entry', { url: entry.url })
}

/**
 * @param {string} url
 * @param {Response} response
 */
function assertCacheableResponse (url, response) {
  if (!response.ok || response.redirected || response.type !== 'basic') {
    throw new Error(`Refusing to cache ${url}: ${response.status} ${response.type}`)
  }
}

/**
 * @param {Response} response
 * @param {string} revision
 */
async function responseMatchesRevision (response, revision) {
  const buffer = await response.clone().arrayBuffer()
  const digest = await serviceWorker.crypto.subtle.digest('SHA-256', buffer)
  return toHex(digest) === revision
}

/**
 * @param {ArrayBuffer} buffer
 */
function toHex (buffer) {
  return [...new Uint8Array(buffer)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function ensureOfflineFallbackIsPresent () {
  const activeVersion = await getActiveVersion()
  if (!activeVersion) return false

  const cache = await serviceWorker.caches.open(staticCacheName(activeVersion))
  const fallbackIsPresent = Boolean(await cache.match(OFFLINE_FALLBACK_URL))
  logWorker('checked offline fallback cache entry', {
    fallbackIsPresent,
    url: OFFLINE_FALLBACK_URL,
  })
  return fallbackIsPresent
}
