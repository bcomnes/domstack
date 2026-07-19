import type {
  DomstackManifest,
  DomstackManifestBuiltHookContext,
  DomstackManifestEntry,
} from '@domstack/static/types.ts'
import type {
  StaticMpaWorkboxManifestVars,
  StaticMpaWorkboxPolicy,
  StaticMpaWorkboxServiceWorkerPolicy,
  WorkboxPrecacheEntry,
} from '#service-worker-settings'
import {
  maxPrecacheBytes,
  offlineFallbackUrl,
  workboxPolicyDefineName,
} from '#service-worker-settings'

/**
 * Build-time Workbox manifest generation.
 *
 * The hook computes policy data consumed by the authored service worker.
 * The `precacheManifest` field uses Workbox's native precache entry shape;
 * runtime route lists and fallback URLs remain app/Domstack policy.
 */

/** Inject Workbox precache and route-policy data into `/service-worker.js`. */
export async function emitWorkboxManifest (
  context: DomstackManifestBuiltHookContext<StaticMpaWorkboxPolicy, StaticMpaWorkboxManifestVars>
): Promise<void> {
  const policy = buildWorkboxPolicy(context.manifest)
  context.defineServiceWorkerConstant(workboxPolicyDefineName, policy)
}

function buildWorkboxPolicy (
  manifest: DomstackManifest<StaticMpaWorkboxPolicy, StaticMpaWorkboxManifestVars>
): StaticMpaWorkboxServiceWorkerPolicy {
  const routes = navigationRoutes(manifest.entries)
  return {
    version: manifest.version,
    precacheManifest: manifest.entries
      .filter(entry => shouldPrecache(entry, runtimeStrategyFor(entry, routes)))
      .map(toWorkboxPrecacheEntry),
    runtimeUrls: manifest.entries
      .filter(entry => runtimeStrategyFor(entry, routes) === 'runtime')
      .map(entry => entry.url),
    networkOnlyUrls: manifest.entries
      .filter(entry => runtimeStrategyFor(entry, routes) === 'network-only')
      .map(entry => entry.url),
    offlineFallbackUrl: manifest.policy?.offlineFallbackUrl ?? offlineFallbackUrl,
  }
}

function toWorkboxPrecacheEntry (entry: DomstackManifestEntry<StaticMpaWorkboxManifestVars>): WorkboxPrecacheEntry {
  return {
    url: entry.url,
    revision: entry.urlRevisioned ? null : entry.revision,
    ...(entry.integrity ? { integrity: entry.integrity } : {}),
  }
}

type NavigationRoutePolicy = {
  offline: boolean
  pathname: string
  precache: boolean
}

function navigationRoutes (entries: DomstackManifestEntry<StaticMpaWorkboxManifestVars>[]): NavigationRoutePolicy[] {
  return entries
    .filter(entry => entry.role === 'navigation' && entry.manifestVars)
    .map(entry => ({
      offline: entry.manifestVars?.offline === true,
      pathname: pathname(entry.url),
      precache: entry.manifestVars?.precache === true,
    }))
    .sort((a, b) => b.pathname.length - a.pathname.length)
}

function runtimeStrategyFor (
  entry: DomstackManifestEntry<StaticMpaWorkboxManifestVars>,
  routes: NavigationRoutePolicy[]
): 'network-only' | 'runtime' | undefined {
  const policy = entry.role === 'navigation'
    ? navigationPolicy(entry)
    : routes.find(route => routeContains(route.pathname, pathname(entry.url)))

  if (!policy) return undefined
  if (!policy.offline) return 'network-only'
  if (!policy.precache) return 'runtime'
  return undefined
}

function navigationPolicy (entry: DomstackManifestEntry<StaticMpaWorkboxManifestVars>): NavigationRoutePolicy | undefined {
  if (!entry.manifestVars) return undefined
  return {
    offline: entry.manifestVars.offline === true,
    pathname: pathname(entry.url),
    precache: entry.manifestVars.precache === true,
  }
}

function shouldPrecache (
  entry: DomstackManifestEntry<StaticMpaWorkboxManifestVars>,
  runtimeStrategy: 'network-only' | 'runtime' | undefined
): boolean {
  if (!entry.revision) return false
  if (entry.bytes && entry.bytes > maxPrecacheBytes) return false
  if (entry.static !== true) return false
  if (entry.kind === 'chunk') return true
  if (runtimeStrategy) return false
  if (entry.role === 'subresource') return true
  return entry.manifestVars?.precache === true
}

function routeContains (routePathname: string, requestPathname: string): boolean {
  if (routePathname === '/') return requestPathname === '/'
  return requestPathname === routePathname || requestPathname.startsWith(routePathname)
}

function pathname (url: string): string {
  return new URL(url, 'https://example.invalid').pathname
}
