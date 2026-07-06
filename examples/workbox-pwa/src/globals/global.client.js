import {
  DOMSTACK_MANIFEST_ENABLED,
  DOMSTACK_MANIFEST_URL,
  DOMSTACK_SERVICE_WORKER_SCOPE,
  DOMSTACK_SERVICE_WORKER_URL,
} from './domstack.js'
import {
  CACHE_PREFIX,
  RESET_PARAM,
} from '../settings/cache-policy.js'

const LOG_PREFIX = '[domstack-workbox-pwa]'

initializeWorkboxPwa().catch(err => {
  console.warn('Unable to initialize the Domstack Workbox PWA example runtime', err)
})

async function initializeWorkboxPwa () {
  log('initializing runtime', {
    manifestEnabled: DOMSTACK_MANIFEST_ENABLED,
    manifestUrl: DOMSTACK_MANIFEST_URL,
    serviceWorkerScope: DOMSTACK_SERVICE_WORKER_SCOPE,
    serviceWorkerUrl: DOMSTACK_SERVICE_WORKER_URL,
  })

  trackOnlineState()

  if (!('serviceWorker' in navigator)) {
    setStatus('Service workers unavailable')
    return
  }

  if (new URLSearchParams(location.search).has(RESET_PARAM)) {
    await resetServiceWorkers()
    location.replace(location.pathname || '/')
    return
  }

  if (!DOMSTACK_MANIFEST_ENABLED || !DOMSTACK_SERVICE_WORKER_URL || !DOMSTACK_SERVICE_WORKER_SCOPE) {
    setStatus('PWA disabled for this build')
    return
  }

  if (isLocalOrigin()) {
    console.info(
      `${LOG_PREFIX} local manifest-enabled build detected; registering the Workbox service worker.\n` +
      'Use `npm run serve` for PWA testing and `npm run watch` for sticky-cache-free development.'
    )
    console.info(`${LOG_PREFIX} reset service workers and caches with:\n${location.origin}/?${RESET_PARAM}=1`)
  }

  navigator.serviceWorker.addEventListener('message', event => {
    handleWorkerMessage(event.data)
  })

  const registration = await navigator.serviceWorker.register(DOMSTACK_SERVICE_WORKER_URL, {
    scope: DOMSTACK_SERVICE_WORKER_SCOPE,
    updateViaCache: 'none',
  })

  setStatus(navigator.serviceWorker.controller ? 'Worker active, checking cache' : 'Installing')
  log('service worker registered', describeRegistration(registration))

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return
    setStatus('Installing update')
    installing.addEventListener('statechange', () => {
      log('installing worker state changed', { state: installing.state })
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        setStatus('Update installed, reloading')
        installing.postMessage({ type: 'SKIP_WAITING' })
      }
    })
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    log('service-worker controller changed, reloading')
    window.location.reload()
  }, { once: true })

  await registration.update()
  const ready = await navigator.serviceWorker.ready
  log('service worker ready', describeRegistration(ready))
  setStatus('Worker active, checking cache')
  requestCacheStatus()
}

function requestCacheStatus () {
  const controller = navigator.serviceWorker.controller
  if (!controller) return
  controller.postMessage({ type: 'GET_STATUS' })
  window.setTimeout(() => {
    if (getStatus() === 'Worker active, checking cache') {
      setStatus('Cache status pending')
    }
  }, 5000)
}

/**
 * @param {unknown} data
 */
function handleWorkerMessage (data) {
  if (!data || typeof data !== 'object') return
  const message = /** @type {{ type?: unknown, version?: unknown, error?: unknown }} */ (data)
  log('message from service worker', message)

  if (message.type === 'PRECACHE_CURRENT') {
    setStatus('Offline cache current')
    setVersion(message.version)
  }

  if (message.type === 'PRECACHE_FAILED') {
    setStatus('Offline cache failed')
    console.warn('Workbox precache failed', message.error)
  }
}

async function resetServiceWorkers () {
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map(registration => registration.unregister()))
  const names = await caches.keys()
  await Promise.all(
    names.filter(name => name.startsWith(CACHE_PREFIX)).map(name => caches.delete(name))
  )
  setStatus('PWA reset complete')
}

function trackOnlineState () {
  const render = () => {
    const node = document.querySelector('[data-online-state]')
    if (node) node.textContent = navigator.onLine ? 'Online' : 'Offline'
    log('network state changed', { online: navigator.onLine })
  }

  render()
  window.addEventListener('online', render)
  window.addEventListener('offline', render)
}

/**
 * @param {ServiceWorkerRegistration} registration
 */
function describeRegistration (registration) {
  return {
    active: Boolean(registration.active),
    controlled: Boolean(navigator.serviceWorker.controller),
    installing: Boolean(registration.installing),
    scope: registration.scope,
    waiting: Boolean(registration.waiting),
  }
}

/**
 * @param {string} value
 */
function setStatus (value) {
  const node = document.querySelector('[data-pwa-status]')
  if (node) node.textContent = value
}

function getStatus () {
  const node = document.querySelector('[data-pwa-status]')
  return node?.textContent ?? ''
}

/**
 * @param {unknown} value
 */
function setVersion (value) {
  const node = document.querySelector('[data-pwa-version]')
  if (node && typeof value === 'string') node.textContent = value.slice(0, 12)
}

function isLocalOrigin () {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
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
