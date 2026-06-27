import {
  ACTIVE_VERSION_URL,
  INSTALL_CACHE_PREFIX,
  META_CACHE,
  PENDING_VERSION_URL,
  STATIC_CACHE_PREFIX,
} from '../pwa/cache-policy.js'
import { logWorker, serviceWorker } from './context.js'

/**
 * @param {string} version
 */
export function staticCacheName (version) {
  return `${STATIC_CACHE_PREFIX}${version}`
}

/**
 * @param {string} version
 */
export function installCacheName (version) {
  return `${INSTALL_CACHE_PREFIX}${version}`
}

export async function getActiveVersion () {
  return readMeta(ACTIVE_VERSION_URL)
}

export async function getPendingVersion () {
  return readMeta(PENDING_VERSION_URL)
}

/**
 * @param {string} version
 */
export async function setActiveVersion (version) {
  logWorker('setting active cache version', { version })
  await writeMeta(ACTIVE_VERSION_URL, version)
}

/**
 * @param {string} version
 */
export async function setPendingVersion (version) {
  logWorker('setting pending cache version', { version })
  await writeMeta(PENDING_VERSION_URL, version)
}

export async function clearPendingVersion () {
  logWorker('clearing pending cache version')
  await deleteMeta(PENDING_VERSION_URL)
}

/**
 * Copy every request/response pair from an install cache into the final static
 * cache. Cache Storage has no atomic rename operation, so this is the commit
 * step after all responses have already been fetched and validated.
 *
 * @param {string} fromName
 * @param {string} toName
 */
export async function copyCacheEntries (fromName, toName) {
  const from = await serviceWorker.caches.open(fromName)
  const to = await serviceWorker.caches.open(toName)
  const requests = await from.keys()
  logWorker('copying staged cache entries', {
    count: requests.length,
    from: fromName,
    to: toName,
  })

  for (const request of requests) {
    const response = await from.match(request)
    if (response) await to.put(request, response)
  }
}

/**
 * Remove old static and temporary install caches after a version is active.
 *
 * @param {string | null} keepVersion
 */
export async function cleanupStaticCaches (keepVersion) {
  const names = await serviceWorker.caches.keys()
  const deleting = names.filter(name => {
    if (name === META_CACHE) return false
    if (keepVersion && name === staticCacheName(keepVersion)) return false
    return name.startsWith(STATIC_CACHE_PREFIX) || name.startsWith(INSTALL_CACHE_PREFIX)
  })
  logWorker('cleaning old static caches', {
    deleting,
    keepVersion,
  })
  await Promise.all(
    deleting.map(name => serviceWorker.caches.delete(name))
  )
}

/**
 * @param {string} url
 */
async function readMeta (url) {
  const cache = await serviceWorker.caches.open(META_CACHE)
  const response = await cache.match(new Request(url))
  return response ? response.text() : null
}

/**
 * @param {string} url
 * @param {string} value
 */
async function writeMeta (url, value) {
  const cache = await serviceWorker.caches.open(META_CACHE)
  await cache.put(new Request(url), new Response(value))
}

/**
 * @param {string} url
 */
async function deleteMeta (url) {
  const cache = await serviceWorker.caches.open(META_CACHE)
  await cache.delete(new Request(url))
}
