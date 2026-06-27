export const CACHE_PREFIX = 'domstack-pwa-example'
export const STATIC_CACHE_PREFIX = `${CACHE_PREFIX}-static-`
export const INSTALL_CACHE_PREFIX = `${CACHE_PREFIX}-install-`
export const META_CACHE = `${CACHE_PREFIX}-meta`
export const ACTIVE_VERSION_URL = '/__domstack-pwa-example/active-version'
export const PENDING_VERSION_URL = '/__domstack-pwa-example/pending-version'
export const OFFLINE_FALLBACK_URL = '/offline/'
export const DOMSTACK_MANIFEST_URL = process.env.DOMSTACK_MANIFEST_URL ?? '/domstack-manifest.json'
export const DOMSTACK_MANIFEST_ENABLED = process.env.DOMSTACK_MANIFEST_ENABLED === 'true'
export const DOMSTACK_SERVICE_WORKER_URL = process.env.DOMSTACK_SERVICE_WORKER_URL ?? '/service-worker.js'
export const DOMSTACK_SERVICE_WORKER_SCOPE = process.env.DOMSTACK_SERVICE_WORKER_SCOPE ?? '/'

export const pwaManifestExclude = [
  'admin/**',
  'blog/**',
  '**/*.map',
  'domstack-esbuild-meta.json',
  'domstack-manifest.json',
  'service-worker.js',
]

const excludedPrefixes = [
  '/admin/',
  '/api/',
  '/blog/',
]

const excludedKinds = new Set([
  'metadata',
  'sourcemap',
  'service-worker',
])

/**
 * Shared application policy for deciding which Domstack output entries may be
 * precached. Node runs this through domstack-manifest.settings.js; the service worker
 * also runs it defensively when reading the emitted manifest.
 *
 * @param {{ url: string, revision?: string | null, kind?: string, page?: { vars?: { precache?: unknown, offline?: unknown } } }} entry
 * @param {string | URL} origin
 */
export function shouldIncludePwaOutput (entry, origin) {
  if (!entry.revision) return false
  if (entry.kind && excludedKinds.has(entry.kind)) return false
  if (entry.page?.vars?.precache === false || entry.page?.vars?.offline === false) return false

  const url = new URL(entry.url, origin)
  if (url.origin !== new URL(origin).origin) return false

  return !excludedPrefixes.some(prefix => url.pathname.startsWith(prefix))
}

/**
 * @param {Request} request
 */
export function shouldHandleRequest (request) {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  if (url.origin !== location.origin) return false

  return !excludedPrefixes.some(prefix => url.pathname.startsWith(prefix))
}
