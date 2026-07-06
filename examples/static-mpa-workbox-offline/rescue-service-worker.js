// Emergency replacement for a bad production service worker.
//
// To use: deploy this file's contents at the SAME URL as the broken worker:
// /service-worker.js. Keeping the exact URL is critical; otherwise the broken
// registration will continue controlling its old scope.
//
// This follows Workbox's documented recovery approach: install and activate
// immediately, avoid a fetch handler entirely so requests pass through to the
// browser/network, and reload controlled windows once the no-op worker is active.

const CACHE_PREFIXES = ['domstack-workbox-static-mpa-precache', 'domstack-workbox-static-mpa-runtime']

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter(name => CACHE_PREFIXES.some(prefix => name.startsWith(prefix)))
        .map(name => caches.delete(name))
    )

    const windowClients = await self.clients.matchAll({ type: 'window' })
    await Promise.all(
      windowClients.map(windowClient => windowClient.navigate(windowClient.url))
    )
  })())
})
