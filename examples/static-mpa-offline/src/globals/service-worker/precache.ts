/// <reference lib="webworker" />

import {
  maxPrecacheBytes,
  revisionParam,
} from '#service-worker-settings'
import type {
  ActiveServiceWorkerConfig,
  ServiceWorkerConfig,
  StaticMpaOfflinePrecacheEntry,
  StaticMpaOfflineRuntimeStrategy,
  StaticMpaOfflineServiceWorkerPolicy,
  StaticMpaOfflineServiceWorkerPolicyEntry,
} from '#service-worker-settings'

/**
 * Injected-manifest-driven precache implementation for the static MPA example.
 *
 * The service worker consumes Domstack manifest entries directly and derives the
 * small amount of cache behavior it needs from their resolved manifest vars.
 */

declare const self: ServiceWorkerGlobalScope

type NavigationRoutePolicy = {
  offline: boolean
  pathname: string
  precache: boolean
}

let currentPolicyVersion: string | undefined
let currentUrlToEntry: Map<string, StaticMpaOfflineServiceWorkerPolicyEntry> | undefined
let currentNavigationRoutes: NavigationRoutePolicy[] | undefined

/** Install-time precache step. Rejecting here keeps the old worker active. */
export async function installPrecache (config: ActiveServiceWorkerConfig): Promise<void> {
  const cache = await caches.open(config.precacheName)

  for (const entry of precacheEntries(config)) {
    const cacheKey = precacheKey(entry)
    const cached = await cache.match(cacheKey)
    if (cached) continue

    const request = new Request(entry.url, {
      cache: 'reload',
      credentials: 'same-origin',
    })
    const assetResponse = await fetch(request)

    if (!assetResponse.ok) {
      throw new Error(`Refusing to precache ${entry.url}: ${assetResponse.status}`)
    }

    await cache.put(cacheKey, assetResponse)
  }

  await caches.delete(config.runtimeCacheName)
  await deleteOutdatedPrecacheEntries(config)
  setCurrentPolicy(config.policy)
}

/** Activation-time cleanup for legacy caches and outdated revisioned entries. */
export async function activatePrecache (config: ActiveServiceWorkerConfig): Promise<void> {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(name => name.startsWith(config.precacheName))
      .filter(name => name !== config.precacheName)
      .map(name => caches.delete(name))
  )

  await deleteOutdatedPrecacheEntries(config)
}

/** Match a public URL against the current precache policy and cache storage. */
export async function matchInPrecache (config: ActiveServiceWorkerConfig, url: string): Promise<Response | undefined> {
  const entry = getServiceWorkerPolicyEntry(config, url)
  if (!entry || !shouldPrecache(config, entry)) return undefined

  const cache = await caches.open(config.precacheName)
  return cache.match(precacheKey(entry))
}

/** Return a manifest entry for a public URL. */
export function getServiceWorkerPolicyEntry (
  config: ActiveServiceWorkerConfig,
  url: string
): StaticMpaOfflineServiceWorkerPolicyEntry | undefined {
  ensurePolicyMaps(config.policy)
  return currentUrlToEntry?.get(normalizeCacheUrl(url))
}

/** Return the runtime strategy derived from a manifest entry and its route policy. */
export function getRuntimeStrategy (
  config: ActiveServiceWorkerConfig,
  entry: StaticMpaOfflineServiceWorkerPolicyEntry
): StaticMpaOfflineRuntimeStrategy | undefined {
  const policy = entry.role === 'navigation'
    ? navigationPolicy(entry)
    : routePolicyForUrl(config.policy, entry.url)

  if (!policy) return undefined
  if (!policy.offline) return 'network-only'
  if (!policy.precache) return 'runtime'
  return undefined
}

/** Delete all cache names owned by this example's service worker. */
export async function deleteOwnedCaches (config: ServiceWorkerConfig): Promise<void> {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(name => config.cachePrefixes.some(prefix => name.startsWith(prefix)))
      .map(name => caches.delete(name))
  )
}

async function deleteOutdatedPrecacheEntries (config: ActiveServiceWorkerConfig): Promise<void> {
  const expectedCacheKeys = new Set(precacheEntries(config).map(entry => normalizeCacheUrl(precacheKey(entry))))
  const cache = await caches.open(config.precacheName)
  const requests = await cache.keys()

  await Promise.all(
    requests
      .filter(request => !expectedCacheKeys.has(request.url))
      .map(request => cache.delete(request))
  )
}

function setCurrentPolicy (policy: StaticMpaOfflineServiceWorkerPolicy): void {
  currentPolicyVersion = policy.version
  currentUrlToEntry = new Map(
    policy.entries.map(entry => [normalizeCacheUrl(entry.url), entry])
  )
  currentNavigationRoutes = navigationRoutes(policy)
}

function ensurePolicyMaps (policy: StaticMpaOfflineServiceWorkerPolicy): void {
  if (currentPolicyVersion === policy.version) return
  setCurrentPolicy(policy)
}

function precacheEntries (config: ActiveServiceWorkerConfig): StaticMpaOfflinePrecacheEntry[] {
  return config.policy.entries.filter(entry => shouldPrecache(config, entry))
}

function shouldPrecache (
  config: ActiveServiceWorkerConfig,
  entry: StaticMpaOfflineServiceWorkerPolicyEntry
): entry is StaticMpaOfflinePrecacheEntry {
  if (!entry.revision) return false
  if (entry.bytes && entry.bytes > maxPrecacheBytes) return false
  if (entry.static !== true) return false
  if (entry.kind === 'chunk') return true
  if (getRuntimeStrategy(config, entry)) return false
  if (entry.role === 'subresource') return true
  return entry.manifestVars?.precache === true
}

function navigationRoutes (policy: StaticMpaOfflineServiceWorkerPolicy): NavigationRoutePolicy[] {
  return policy.entries
    .filter(entry => entry.role === 'navigation' && entry.manifestVars)
    .map(entry => navigationPolicy(entry))
    .filter(route => route !== undefined)
    .sort((a, b) => b.pathname.length - a.pathname.length)
}

function navigationPolicy (entry: StaticMpaOfflineServiceWorkerPolicyEntry): NavigationRoutePolicy | undefined {
  if (!entry.manifestVars) return undefined
  return {
    offline: entry.manifestVars.offline === true,
    pathname: pathname(entry.url),
    precache: entry.manifestVars.precache === true,
  }
}

function routePolicyForUrl (
  policy: StaticMpaOfflineServiceWorkerPolicy,
  url: string
): NavigationRoutePolicy | undefined {
  ensurePolicyMaps(policy)
  const requestPathname = pathname(url)
  return currentNavigationRoutes?.find(route => routeContains(route.pathname, requestPathname))
}

function routeContains (routePathname: string, requestPathname: string): boolean {
  if (routePathname === '/') return requestPathname === '/'
  return requestPathname === routePathname || requestPathname.startsWith(routePathname)
}

function pathname (url: string): string {
  return new URL(url, self.location.origin).pathname
}

function precacheKey (entry: StaticMpaOfflinePrecacheEntry): string {
  const url = new URL(entry.url, self.location.origin)
  url.hash = ''
  if (!entry.urlRevisioned) url.searchParams.set(revisionParam, entry.revision)
  return url.pathname + url.search
}

function normalizeCacheUrl (url: string): string {
  const normalized = new URL(url, self.location.origin)
  normalized.hash = ''
  return normalized.href
}
