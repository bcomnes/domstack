import {
  OFFLINE_FALLBACK_URL,
  shouldHandleRequest,
} from '../pwa/cache-policy.js'
import {
  getActiveVersion,
  staticCacheName,
} from './cache.js'
import { logWorker, serviceWorker, warnWorker } from './context.js'

/**
 * Serve static manifest entries cache-first and keep excluded/data requests on
 * the network path.
 *
 * @param {Request} request
 */
export async function handleFetch (request) {
  if (!shouldHandleRequest(request)) {
    logWorker('network-only request', {
      method: request.method,
      mode: request.mode,
      url: request.url,
    })
    return serviceWorker.fetch(request)
  }

  const cached = await matchActiveCache(request)
  if (cached) {
    logWorker('cache hit', { mode: request.mode, url: request.url })
    return cached
  }

  try {
    logWorker('cache miss, using network', { mode: request.mode, url: request.url })
    return await serviceWorker.fetch(request)
  } catch (err) {
    warnWorker('network request failed', {
      error: err instanceof Error ? err.message : String(err),
      mode: request.mode,
      url: request.url,
    })
    if (request.mode === 'navigate') {
      const fallback = await matchActiveCache(new Request(OFFLINE_FALLBACK_URL))
      if (fallback) {
        logWorker('serving offline fallback', { url: request.url })
        return fallback
      }
    }

    throw err
  }
}

/**
 * @param {Request} request
 */
async function matchActiveCache (request) {
  const activeVersion = await getActiveVersion()
  if (!activeVersion) {
    logWorker('no active cache version for request', { url: request.url })
    return null
  }

  const cache = await serviceWorker.caches.open(staticCacheName(activeVersion))
  const directMatch = await cache.match(request, { ignoreSearch: true })
  if (directMatch) return directMatch

  if (request.mode !== 'navigate') return null

  const url = new URL(request.url)
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`
  }
  url.search = ''

  return cache.match(url.href)
}
