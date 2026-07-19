/// <reference lib="webworker" />

import {
  getRuntimeStrategy,
  getServiceWorkerPolicyEntry,
  matchInPrecache,
} from './precache.ts'
import {
  cacheFirstRuntimeCache,
  networkFirstRuntimeCache,
} from './runtime-cache.ts'
import type {
  ActiveServiceWorkerConfig,
  StaticMpaOfflineServiceWorkerPolicyEntry,
} from '#service-worker-settings'

/**
 * Fetch-event routing for navigations and static subresources.
 *
 * Related functions:
 * - `handleFetchEvent()` is the event-level router.
 * - `handleNavigation()` handles MPA navigations and offline fallback policy.
 * - `cacheFirst()` serves static subresources from precache when available.
 * - `navigationCandidates()` mirrors Workbox-like URL variations for static MPAs.
 *
 * MDN quick links:
 * - FetchEvent: https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent
 * - respondWith(): https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
 * - preloadResponse: https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/preloadResponse
 * - Request.destination: https://developer.mozilla.org/en-US/docs/Web/API/Request/destination
 */

declare const self: ServiceWorkerGlobalScope

/**
 * Route only same-origin GET requests that this service worker owns.
 *
 * See MDN `FetchEvent.respondWith()` constraints:
 * https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
 */
export function handleFetchEvent (config: ActiveServiceWorkerConfig, event: FetchEvent): void {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isDevelopmentRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(config, request, event.preloadResponse, event))
    return
  }

  event.respondWith(handleSubresource(config, request))
}

/** Serve cached navigations first, then network/preload, then configured offline fallback. */
async function handleNavigation (
  config: ActiveServiceWorkerConfig,
  request: Request,
  preloadResponsePromise: Promise<Response | undefined>,
  event: FetchEvent
): Promise<Response> {
  event.waitUntil(preloadResponsePromise.catch(() => undefined))

  const cached = await matchNavigation(config, request)
  if (cached) return cached

  try {
    if (shouldRuntimeCacheRequest(config, request)) {
      return await networkFirstRuntimeCache(config, request, preloadResponsePromise)
    }

    const preloadResponse = await preloadResponsePromise
    if (preloadResponse) return preloadResponse

    return await fetch(request)
  } catch (error) {
    const fallback = await matchInPrecache(config, config.policy.offlineFallbackUrl)
    if (fallback) return fallback

    throw error
  }
}

async function handleSubresource (config: ActiveServiceWorkerConfig, request: Request): Promise<Response> {
  if (shouldRuntimeCacheRequest(config, request)) {
    return await cacheFirstRuntimeCache(config, request)
  }

  return await cacheFirstStaticSubresource(config, request)
}

/** Serve manifest-known static subresources from precache, otherwise fall through to network. */
async function cacheFirstStaticSubresource (config: ActiveServiceWorkerConfig, request: Request): Promise<Response> {
  const cached = await matchInPrecache(config, request.url)
  if (cached) return cached

  try {
    return await fetch(request)
  } catch {
    return Response.error()
  }
}

async function matchNavigation (config: ActiveServiceWorkerConfig, request: Request): Promise<Response | undefined> {
  for (const url of navigationCandidates(new URL(request.url))) {
    const cached = await matchInPrecache(config, url)
    if (cached) return cached
  }

  return undefined
}

/** Generate static MPA URL candidates, similar to Workbox's precache URL variations. */
function navigationCandidates (url: URL): string[] {
  const withoutIgnoredParams = new URL(url.href)
  withoutIgnoredParams.hash = ''
  for (const param of Array.from(withoutIgnoredParams.searchParams.keys())) {
    if (/^utm_/.test(param) || param === 'fbclid') {
      withoutIgnoredParams.searchParams.delete(param)
    }
  }

  const pathname = withoutIgnoredParams.pathname
  const candidates = new Set<string>()

  candidates.add(withoutIgnoredParams.pathname + withoutIgnoredParams.search)

  if (pathname.endsWith('/')) {
    candidates.add(pathname + 'index.html')
  } else {
    candidates.add(pathname + '/')
    candidates.add(pathname + '.html')
    candidates.add(pathname + '/index.html')
  }

  if (pathname === '/') candidates.add('/index.html')

  return Array.from(candidates)
}

function isDevelopmentRequest (url: URL): boolean {
  return url.pathname.startsWith('/__bs/') ||
    url.pathname.startsWith('/browser-sync/') ||
    url.pathname === '/browser-sync-client.js'
}

function shouldRuntimeCacheRequest (config: ActiveServiceWorkerConfig, request: Request): boolean {
  const policyEntry = getRequestPolicyEntry(config, request)
  return policyEntry ? getRuntimeStrategy(config, policyEntry) === 'runtime' : false
}

function getRequestPolicyEntry (config: ActiveServiceWorkerConfig, request: Request): StaticMpaOfflineServiceWorkerPolicyEntry | undefined {
  const directEntry = getServiceWorkerPolicyEntry(config, request.url)
  if (directEntry) return directEntry

  if (!request.referrer) return undefined

  const referrer = new URL(request.referrer)
  if (referrer.origin !== self.location.origin) return undefined

  return getServiceWorkerPolicyEntry(config, referrer.href)
}
