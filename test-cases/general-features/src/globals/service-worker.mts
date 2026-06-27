import { CACHE_PREFIX, DOMSTACK_MANIFEST_URL, loadManifest } from '../libs/service-worker-helper.js'

type DomstackManifestEntry = {
  revision?: unknown,
  kind: string,
  url: string
}

type DomstackManifest = {
  version: string,
  entries: DomstackManifestEntry[]
}

type ServiceWorkerExtendableEvent = Event & {
  waitUntil (promise: Promise<unknown>): void
}

type ServiceWorkerFetchEvent = Event & {
  request: Request,
  respondWith (response: Promise<Response>): void
}

self.addEventListener('install', event => {
  const installEvent = event as ServiceWorkerExtendableEvent
  installEvent.waitUntil(precache())
})

self.addEventListener('activate', event => {
  const activateEvent = event as ServiceWorkerExtendableEvent
  activateEvent.waitUntil(cleanup())
})

self.addEventListener('fetch', event => {
  const fetchEvent = event as ServiceWorkerFetchEvent
  if (fetchEvent.request.method !== 'GET') return
  fetchEvent.respondWith(cacheFirst(fetchEvent.request))
})

async function precache () {
  const manifest = await loadDomstackManifest()
  const cache = await caches.open(CACHE_PREFIX + manifest.version)
  const urls = manifest.entries
    .filter(entry => entry.revision)
    .filter(entry => entry.kind !== 'sourcemap')
    .filter(entry => entry.kind !== 'metadata')
    .filter(entry => entry.url !== DOMSTACK_MANIFEST_URL)
    .map(entry => entry.url)

  await cache.addAll(urls)
}

async function cleanup () {
  const manifest = await loadDomstackManifest()
  const current = CACHE_PREFIX + manifest.version
  const names = await caches.keys()
  await Promise.all(names
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== current)
    .map(name => caches.delete(name)))
}

async function cacheFirst (request: Request) {
  const cached = await caches.match(request)
  return cached || fetch(request)
}

async function loadDomstackManifest (): Promise<DomstackManifest> {
  return await loadManifest() as DomstackManifest
}
