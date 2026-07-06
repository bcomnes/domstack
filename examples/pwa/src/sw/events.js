import { getActiveVersion } from './cache.js'
import { postToClients } from './clients.js'
import { logWorker, serviceWorker } from './context.js'
import { handleFetch } from './fetch.js'
import { handleMessage } from './messages.js'
import {
  activatePendingCache,
  prepareStaticCache,
} from './precache.js'

/**
 * Install follows the Service Worker lifecycle:
 * https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/install_event
 */
serviceWorker.addEventListener('install', event => {
  logWorker('install event received')
  event.waitUntil(handleInstall())
})

/**
 * Activate commits a fully staged cache and removes old cache versions:
 * https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/activate_event
 */
serviceWorker.addEventListener('activate', event => {
  logWorker('activate event received')
  event.waitUntil(handleActivate())
})

/**
 * Fetch keeps static navigations/assets cache-first and leaves excluded traffic
 * on the network path:
 * https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event
 */
serviceWorker.addEventListener('fetch', event => {
  event.respondWith(handleFetch(event.request))
})

/**
 * Messages let the window runtime request update checks and user-approved
 * activation:
 * https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/message_event
 */
serviceWorker.addEventListener('message', event => {
  logWorker('message event received', event.data)
  event.waitUntil(handleMessage(event))
})

async function handleInstall () {
  const hadActiveCache = Boolean(await getActiveVersion())
  logWorker('install started', { hadActiveCache })
  const result = await prepareStaticCache({ force: true })
  logWorker('install cache preparation finished', result)

  if (!hadActiveCache && result.status === 'ready') {
    logWorker('first install has a complete cache, calling skipWaiting')
    await serviceWorker.skipWaiting()
  }
}

async function handleActivate () {
  const version = await activatePendingCache()
  logWorker('activate completed', { version })
  await serviceWorker.clients.claim()
  await postToClients({ type: 'CACHE_UPDATE_CURRENT', version })
}
