/// <reference lib="webworker" />

/**
 * Respond to demo cache-inspection requests from controlled pages.
 *
 * This is intentionally diagnostic-only: it exposes cache names, request URLs,
 * response status/type, selected headers, and approximate body size for caches
 * owned by this example service worker.
 */

export type CacheInspectionConfig = {
  cachePrefixes: string[]
}

export function handleCacheInspectionMessage (
  config: CacheInspectionConfig,
  event: ExtendableMessageEvent
): boolean {
  if (event.data?.type !== 'DOMSTACK_INSPECT_CACHES') return false

  event.waitUntil((async () => {
    const inspection = await inspectOwnedCaches(config)
    event.source?.postMessage({
      id: event.data.id,
      payload: inspection,
      type: 'DOMSTACK_CACHE_INSPECTION_RESULT',
    })
  })())

  return true
}

async function inspectOwnedCaches (config: CacheInspectionConfig): Promise<unknown> {
  const cacheNames = (await caches.keys())
    .filter(name => config.cachePrefixes.some(prefix => name.startsWith(prefix)))
    .sort()

  return {
    generatedAt: new Date().toISOString(),
    caches: await Promise.all(cacheNames.map(inspectCache)),
  }
}

async function inspectCache (name: string): Promise<unknown> {
  const cache = await caches.open(name)
  const requests = await cache.keys()
  const entries = await Promise.all(requests.map(request => inspectCacheEntry(cache, request)))

  return {
    name,
    entries: entries.sort((a, b) => a.url.localeCompare(b.url)),
  }
}

async function inspectCacheEntry (cache: Cache, request: Request): Promise<{
  bodyBytes: number | null
  contentLength: string | null
  contentType: string | null
  status: number
  type: ResponseType
  url: string
}> {
  const response = await cache.match(request)
  if (!response) {
    return {
      bodyBytes: null,
      contentLength: null,
      contentType: null,
      status: 0,
      type: 'error',
      url: request.url,
    }
  }

  const bodyBytes = await estimateBodyBytes(response)

  return {
    bodyBytes,
    contentLength: response.headers.get('content-length'),
    contentType: response.headers.get('content-type'),
    status: response.status,
    type: response.type,
    url: request.url,
  }
}

async function estimateBodyBytes (response: Response): Promise<number | null> {
  try {
    return (await response.clone().arrayBuffer()).byteLength
  } catch {
    return null
  }
}
