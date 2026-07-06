export const CACHE_PREFIX = 'domstack-workbox-pwa-example'
export const OFFLINE_FALLBACK_URL = '/offline/'
export const RESET_PARAM = 'reset-sw'

export const manifestExclude = [
  'admin/**',
  'blog/**',
  '**/*.map',
  'domstack-esbuild-meta.json',
  'domstack-manifest.json',
  'service-worker.js',
]

export const excludedPathPrefixes = [
  '/admin/',
  '/api/',
  '/blog/',
]

export const excludedKinds = new Set([
  'metadata',
  'sourcemap',
  'service-worker',
])

/**
 * Shared application policy for deciding which Domstack output entries may be
 * precached. Node runs this through domstack-manifest.settings.js; the service
 * worker runs it again defensively when reading the emitted manifest.
 *
 * @param {{ url: string, revision?: string | null, kind?: string, page?: { vars?: { precache?: unknown, offline?: unknown } } }} entry
 * @param {string | URL} origin
 */
export function shouldIncludeManifestEntry (entry, origin) {
  if (!entry.revision) return false
  if (entry.kind && excludedKinds.has(entry.kind)) return false
  if (entry.page?.vars?.precache === false || entry.page?.vars?.offline === false) return false

  const url = new URL(entry.url, origin)
  if (url.origin !== new URL(origin).origin) return false

  return !excludedPathPrefixes.some(prefix => url.pathname.startsWith(prefix))
}

/**
 * @param {URL} url
 */
export function isNetworkOnlyPath (url) {
  return excludedPathPrefixes.some(prefix => url.pathname.startsWith(prefix))
}
