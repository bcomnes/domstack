/**
 * @import { TemplateFunction } from '../../../index.js'
 */

/**
 * @type {TemplateFunction<Record<string, any>>}
 */
export default async function pwaTemplate () {
  return {
    outputName: 'service-worker.js',
    content: `const DOMSTACK_MANIFEST_URL = '/domstack-output-manifest.json'
const CACHE_PREFIX = 'domstack-precache-'

self.addEventListener('install', event => {
  event.waitUntil(precache())
})

self.addEventListener('activate', event => {
  event.waitUntil(cleanup())
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  event.respondWith(cacheFirst(event.request))
})

async function loadManifest () {
  const response = await fetch(DOMSTACK_MANIFEST_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to load domstack output manifest')
  return response.json()
}

async function precache () {
  const manifest = await loadManifest()
  const cache = await caches.open(CACHE_PREFIX + manifest.version)
  const urls = manifest.entries
    .filter(entry => entry.revision)
    .filter(entry => entry.kind !== 'sourcemap')
    .filter(entry => entry.kind !== 'metadata')
    .map(entry => entry.url)
  await cache.addAll(urls)
}

async function cleanup () {
  const manifest = await loadManifest()
  const current = CACHE_PREFIX + manifest.version
  const names = await caches.keys()
  await Promise.all(names
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== current)
    .map(name => caches.delete(name)))
}

async function cacheFirst (request) {
  const cached = await caches.match(request)
  return cached || fetch(request)
}
`,
  }
}
