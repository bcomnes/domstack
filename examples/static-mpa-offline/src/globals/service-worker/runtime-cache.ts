/// <reference lib="webworker" />

import type { ServiceWorkerConfig } from '#service-worker-settings'

/**
 * Runtime cache for demo routes that intentionally are not precached.
 *
 * The static MPA example uses this to show a second offline pattern: a page and
 * its same-route subresources can be omitted from install-time precache, then
 * learned after the user visits them online.
 */

/** Serve from network first and store successful responses for later offline visits. */
export async function networkFirstRuntimeCache (
  config: ServiceWorkerConfig,
  request: Request,
  preloadResponsePromise?: Promise<Response | undefined>
): Promise<Response> {
  const cached = await matchInRuntimeCache(config, request)

  try {
    const preloadResponse = preloadResponsePromise ? await preloadResponsePromise : undefined
    if (preloadResponse) {
      await cacheRuntimeResponse(config, request, preloadResponse.clone())
      return preloadResponse
    }

    const response = await fetchRuntimeRequest(request)
    await cacheRuntimeResponse(config, request, response.clone())
    return response
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

/** Serve from runtime cache first, fetching and storing the response on misses. */
export async function cacheFirstRuntimeCache (
  config: ServiceWorkerConfig,
  request: Request
): Promise<Response> {
  const cached = await matchInRuntimeCache(config, request)
  if (cached) return cached

  try {
    const response = await fetchRuntimeRequest(request)
    await cacheRuntimeResponse(config, request, response.clone())
    return response
  } catch {
    return Response.error()
  }
}

async function matchInRuntimeCache (config: ServiceWorkerConfig, request: Request): Promise<Response | undefined> {
  const cache = await caches.open(config.runtimeCacheName)
  return cache.match(normalizeRuntimeRequest(request))
}

async function cacheRuntimeResponse (
  config: ServiceWorkerConfig,
  request: Request,
  response: Response
): Promise<void> {
  if (!response.ok) return
  if (response.type !== 'basic') return

  const cache = await caches.open(config.runtimeCacheName)
  await cache.put(normalizeRuntimeRequest(request), response)
}

function fetchRuntimeRequest (request: Request): Promise<Response> {
  return fetch(new Request(request.url, {
    cache: 'reload',
    credentials: 'same-origin',
    method: 'GET',
  }))
}

function normalizeRuntimeRequest (request: Request): Request {
  const url = new URL(request.url)
  url.hash = ''
  return new Request(url.href, {
    credentials: 'same-origin',
    method: 'GET',
  })
}
