/// <reference lib="webworker" />

import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim, setCacheNameDetails } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { handleCacheInspectionMessage } from './cache-inspection.ts'
import { initializeBackgroundEventDemos } from './background-events.ts'
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
} from 'workbox-precaching'
import { offlineFallback } from 'workbox-recipes'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'
import {
  cachePrefix,
  cachePrefixes,
  runtimeCacheMaxAgeSeconds,
  runtimeCacheMaxEntries,
  runtimeCacheName,
  runtimeCacheableStatuses,
  type StaticMpaWorkboxServiceWorkerPolicy,
} from '#service-worker-settings'

/**
 * Workbox service-worker entrypoint for the static MPA offline example.
 *
 * Domstack's `manifestBuilt` hook computes final policy data from the build
 * manifest and injects it into this final service-worker bundle. The
 * Workbox-native `precacheManifest` field is passed directly to Workbox.
 */

export {}

declare const self: ServiceWorkerGlobalScope
declare const __DOMSTACK_WORKBOX_POLICY__: StaticMpaWorkboxServiceWorkerPolicy

const manifestEnabled = process.env.DOMSTACK_MANIFEST_ENABLED === 'true'
const manifestVersion = process.env.DOMSTACK_MANIFEST_VERSION ?? ''

setCacheNameDetails({ prefix: cachePrefix })
initializeBackgroundEventDemos(self)

if (manifestEnabled) {
  const policy = __DOMSTACK_WORKBOX_POLICY__
  const runtimeStrategy = new NetworkFirst({
    cacheName: runtimeCacheName,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [...runtimeCacheableStatuses],
      }),
      new ExpirationPlugin({
        maxAgeSeconds: runtimeCacheMaxAgeSeconds,
        maxEntries: runtimeCacheMaxEntries,
        purgeOnQuotaError: true,
      }),
    ],
  })
  if (manifestVersion && policy.version !== manifestVersion) {
    throw new Error('Generated Workbox policy version does not match the bundled domstack manifest version.')
  }

  const runtimeUrls = new Set(policy.runtimeUrls.map(normalizePath))
  const networkOnlyUrls = new Set(policy.networkOnlyUrls.map(normalizePath))

  cleanupOutdatedCaches()
  precacheAndRoute(policy.precacheManifest, {
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
  })

  registerRoute(
    ({ request, url }) => request.mode === 'navigate' && runtimeUrls.has(normalizePath(url.pathname)),
    runtimeStrategy
  )

  registerRoute(
    ({ request, url }) => request.mode !== 'navigate' && runtimeUrls.has(normalizePath(url.pathname)),
    runtimeStrategy
  )

  registerRoute(
    ({ request, url }) => request.mode === 'navigate' && networkOnlyUrls.has(normalizePath(url.pathname)),
    new NetworkOnly()
  )

  offlineFallback({
    pageFallback: policy.offlineFallbackUrl,
  })

  clientsClaim()

  self.addEventListener('message', event => {
    if (handleCacheInspectionMessage({ cachePrefixes: [...cachePrefixes] }, event)) return

    if (event.data?.type === 'SKIP_WAITING') {
      event.waitUntil(self.skipWaiting())
      return
    }

    if (event.data?.type === 'RESET_SERVICE_WORKER') {
      event.waitUntil(resetServiceWorker())
    }
  })
} else {
  clientsClaim()

  self.addEventListener('install', () => {
    self.skipWaiting()
  })

  self.addEventListener('activate', event => {
    event.waitUntil(resetServiceWorker())
  })
}

async function resetServiceWorker (): Promise<void> {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(name => cachePrefixes.some(cachePrefix => name.startsWith(cachePrefix)))
      .map(name => caches.delete(name))
  )
}

function normalizePath (pathname: string): string {
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length)
  return pathname
}
