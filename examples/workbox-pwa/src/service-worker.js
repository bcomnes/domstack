import { clientsClaim, setCacheNameDetails } from 'workbox-core'
import {
  PrecacheFallbackPlugin,
  cleanupOutdatedCaches,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'
import {
  CACHE_PREFIX,
  OFFLINE_FALLBACK_URL,
} from './settings/cache-policy.js'

const serviceWorker = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (globalThis)
const LOG_PREFIX = '[domstack-workbox-pwa:sw]'
const DOMSTACK_PRECACHE_VERSION = '__DOMSTACK_PRECACHE_VERSION__'

setCacheNameDetails({
  prefix: CACHE_PREFIX,
})

// Domstack writes `domstack-manifest.json`; scripts/inject-domstack-manifest.js
// converts that manifest into Workbox precache entries and replaces this
// placeholder after Domstack bundles the service worker.
precacheAndRoute(self.__WB_MANIFEST, {
  ignoreURLParametersMatching: [/.*/],
})
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(
    new NetworkOnly({
      plugins: [
        new PrecacheFallbackPlugin({
          fallbackURL: OFFLINE_FALLBACK_URL,
        }),
      ],
    })
  )
)

serviceWorker.skipWaiting()
clientsClaim()

serviceWorker.addEventListener('activate', event => {
  event.waitUntil(postPrecacheCurrent())
})

serviceWorker.addEventListener('message', event => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  const message = /** @type {{ type?: unknown }} */ (data)

  if (message.type === 'SKIP_WAITING') {
    event.waitUntil(serviceWorker.skipWaiting())
    return
  }

  if (message.type === 'GET_STATUS') {
    event.waitUntil(postPrecacheCurrent(event.source))
  }
})

/**
 * @param {Client | ServiceWorker | MessagePort | null | undefined} [source]
 */
async function postPrecacheCurrent (source) {
  const message = {
    type: 'PRECACHE_CURRENT',
    version: getPrecacheVersion(),
  }

  if (source && 'postMessage' in source && typeof source.postMessage === 'function') {
    source.postMessage(message)
  }

  await postToClients(message)
  log('reported precache status', { version: message.version })
}

function getPrecacheVersion () {
  return DOMSTACK_PRECACHE_VERSION.startsWith('__') ? undefined : DOMSTACK_PRECACHE_VERSION
}

/**
 * @param {Record<string, unknown>} message
 */
async function postToClients (message) {
  const clients = await serviceWorker.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  })
  for (const client of clients) client.postMessage(message)
}

/**
 * @param {string} message
 * @param {unknown} [details]
 */
function log (message, details) {
  if (details === undefined) {
    console.info(LOG_PREFIX, message)
  } else {
    console.info(LOG_PREFIX, message, details)
  }
}
