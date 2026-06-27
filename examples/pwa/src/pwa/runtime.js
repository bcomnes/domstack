import {
  CACHE_PREFIX,
  DOMSTACK_MANIFEST_ENABLED,
  DOMSTACK_MANIFEST_URL,
  DOMSTACK_SERVICE_WORKER_SCOPE,
  DOMSTACK_SERVICE_WORKER_URL,
} from './cache-policy.js'

const RESET_PARAM = 'reset-sw'
const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000
const WORKER_MESSAGE_TIMEOUT = 15 * 1000
const LOG_PREFIX = '[domstack-pwa]'

let lastUpdateCheck = 0
let applyingUpdate = false
let formIsDirty = false

/**
 * Register the site service worker, wire update prompts, and keep local watch
 * builds from inheriting stale production caches unless a developer opts in.
 */
export async function initializePwa () {
  log('initializing runtime', {
    manifestEnabled: DOMSTACK_MANIFEST_ENABLED,
    serviceWorkerScope: DOMSTACK_SERVICE_WORKER_SCOPE,
    serviceWorkerUrl: DOMSTACK_SERVICE_WORKER_URL,
  })

  trackOnlineState()
  trackFormDirtyState()
  trackNetworkForms()

  if (!('serviceWorker' in navigator)) {
    log('service workers are unavailable in this browser')
    setStatus('Service workers are unavailable')
    return
  }

  if (new URLSearchParams(location.search).has(RESET_PARAM)) {
    log('reset parameter found, unregistering workers and clearing caches')
    await resetServiceWorkers()
    location.replace(location.pathname || '/')
    return
  }

  if (!DOMSTACK_SERVICE_WORKER_URL || !DOMSTACK_SERVICE_WORKER_SCOPE || !DOMSTACK_MANIFEST_ENABLED) {
    log('pwa disabled for this build, clearing local caches when applicable')
    setStatus('PWA disabled for this build')
    await resetLocalServiceWorkers()
    return
  }

  if (isLocalOrigin()) {
    logLocalServeInstructions()
  }

  log('registering service worker')
  const registration = await navigator.serviceWorker.register(DOMSTACK_SERVICE_WORKER_URL, {
    scope: DOMSTACK_SERVICE_WORKER_SCOPE,
    updateViaCache: 'none',
  })
  log('service worker registered', {
    active: Boolean(registration.active),
    controlled: Boolean(navigator.serviceWorker.controller),
    installing: Boolean(registration.installing),
    scope: registration.scope,
    waiting: Boolean(registration.waiting),
  })

  setStatus(navigator.serviceWorker.controller ? 'Active' : 'Installing')
  wireRegistration(registration)
  wireControllerReload()

  if (registration.waiting) {
    log('registration already has a waiting worker')
    showUpdatePrompt(registration.waiting, 'SKIP_WAITING')
  }

  await checkForUpdates(registration, { force: true })
  navigator.serviceWorker.ready.then(readyRegistration => {
    log('service worker ready, checking manifest-backed cache state', {
      active: Boolean(readyRegistration.active),
      scope: readyRegistration.scope,
    })
    setStatus('Active')
    return checkForUpdates(readyRegistration, { force: true })
  }).catch(reportUpdateFailure)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      log('document became visible, checking for updates')
      checkForUpdates(registration).catch(reportUpdateFailure)
    }
  })

  window.addEventListener('online', () => {
    log('browser came online, forcing update check')
    checkForUpdates(registration, { force: true }).catch(reportUpdateFailure)
  })

  window.addEventListener('pagehide', () => {
    if (!formIsDirty && registration.waiting) {
      log('clean pagehide with waiting worker, applying update')
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    } else if (formIsDirty && registration.waiting) {
      log('pagehide skipped update because a form is dirty')
    }
  })
}

/**
 * Connect registration events to the small update notice rendered by this
 * example's runtime.
 *
 * @param {ServiceWorkerRegistration} registration
 */
function wireRegistration (registration) {
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return

    log('browser found a service-worker update')
    setStatus('Installing update')
    installing.addEventListener('statechange', () => {
      log('installing worker state changed', { state: installing.state })
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdatePrompt(installing, 'SKIP_WAITING')
      } else if (installing.state === 'activated') {
        setStatus('Active')
      }
    })
  })

  navigator.serviceWorker.addEventListener('message', event => {
    handleServiceWorkerMessage(event.data, registration)
  })
}

/**
 * Reload once after an accepted service-worker update takes control.
 */
function wireControllerReload () {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applyingUpdate) return
    applyingUpdate = true
    log('service-worker controller changed, reloading')
    window.location.reload()
  })
}

/**
 * Ask the browser to check for a service-worker update, show the window's
 * current domstack manifest version immediately, and ask the active worker to
 * reconcile Cache Storage in the background.
 *
 * @param {ServiceWorkerRegistration} registration
 * @param {{ force?: boolean }} [opts]
 */
async function checkForUpdates (registration, opts = {}) {
  const now = Date.now()
  if (!opts.force && now - lastUpdateCheck < UPDATE_CHECK_INTERVAL) {
    log('skipping update check due to throttle')
    return
  }
  lastUpdateCheck = now

  log('checking for service-worker and manifest updates', { force: Boolean(opts.force) })
  await registration.update()
  log('registration state after update check', {
    active: Boolean(registration.active),
    controlled: Boolean(navigator.serviceWorker.controller),
    installing: Boolean(registration.installing),
    waiting: Boolean(registration.waiting),
  })

  if (registration.waiting) {
    log('update check found a waiting worker')
    showUpdatePrompt(registration.waiting, 'SKIP_WAITING')
  }

  await setVersionFromDomstackManifest()

  const worker = navigator.serviceWorker.controller
  if (worker) {
    log('asked controlling worker to check the domstack manifest')
    postWorkerMessage(worker, { type: 'CHECK_FOR_UPDATES' })
      .then(response => {
        if (response) {
          handleServiceWorkerMessage(response, registration)
        } else {
          log('controlling worker did not reply to manifest check')
        }
      })
      .catch(reportUpdateFailure)
  } else {
    log('page is not controlled by a service worker yet; cache reconciliation will start after reload')
  }
}

/**
 * @param {unknown} data
 * @param {ServiceWorkerRegistration} registration
 */
function handleServiceWorkerMessage (data, registration) {
  if (!data || typeof data !== 'object') return
  const message = /** @type {{ type?: unknown, version?: unknown, error?: unknown }} */ (data)
  log('message from service worker', message)

  if (message.type === 'CACHE_UPDATE_READY') {
    setVersion(message.version)
    if (registration.waiting) {
      showUpdatePrompt(registration.waiting, 'SKIP_WAITING')
    } else if (registration.active) {
      showUpdatePrompt(registration.active, 'APPLY_PENDING_CACHE')
    }
  }

  if (message.type === 'CACHE_UPDATE_CURRENT') {
    setVersion(message.version)
  }

  if (message.type === 'CACHE_UPDATE_APPLIED') {
    setVersion(message.version)
    log('manifest-only cache update applied, reloading')
    window.location.reload()
  }

  if (message.type === 'CACHE_UPDATE_FAILED') {
    setStatus('Update check failed')
    console.warn('PWA cache update failed', message.error)
  }
}

/**
 * Send a request directly to the worker and wait briefly for a MessageChannel
 * response. This makes the example easier to debug than relying only on
 * broadcast client messages.
 *
 * @param {ServiceWorker} worker
 * @param {Record<string, unknown>} message
 * @returns {Promise<unknown>}
 */
async function postWorkerMessage (worker, message) {
  return await new Promise(resolve => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => {
      channel.port1.close()
      resolve(null)
    }, WORKER_MESSAGE_TIMEOUT)

    channel.port1.onmessage = event => {
      clearTimeout(timeout)
      channel.port1.close()
      resolve(event.data)
    }

    worker.postMessage(message, [channel.port2])
  })
}

async function setVersionFromDomstackManifest () {
  try {
    const response = await fetch(DOMSTACK_MANIFEST_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(`Unable to fetch ${DOMSTACK_MANIFEST_URL}: ${response.status}`)

    const manifest = await response.json()
    const version = /** @type {{ version?: unknown }} */ (manifest).version
    if (typeof version === 'string') {
      log('loaded domstack manifest version from window', { version })
      setVersion(version)
    }
  } catch (err) {
    console.warn('Unable to load domstack manifest version from the window', err)
  }
}

/**
 * Render the update prompt and post the matching activation message when the
 * user accepts.
 *
 * @param {ServiceWorker} worker
 * @param {'SKIP_WAITING'|'APPLY_PENDING_CACHE'} messageType
 */
function showUpdatePrompt (worker, messageType) {
  const prompt = document.querySelector('[data-pwa-update]')
  if (!prompt) return

  log('showing update prompt', { messageType })
  prompt.replaceChildren()
  prompt.hidden = false

  const message = document.createElement('p')
  message.textContent = 'A fresh static build is ready.'

  const actions = document.createElement('div')
  actions.className = 'pwa-update__actions'

  const apply = document.createElement('button')
  apply.type = 'button'
  apply.textContent = 'Apply now'
  apply.addEventListener('click', () => {
    applyingUpdate = false
    log('applying prompted update', { messageType })
    worker.postMessage({ type: messageType })
  })

  const later = document.createElement('button')
  later.type = 'button'
  later.className = 'secondary'
  later.textContent = 'Later'
  later.addEventListener('click', () => {
    log('dismissed update prompt for this page session')
    prompt.hidden = true
  })

  actions.append(apply, later)
  prompt.append(message, actions)
}

/**
 * Track form edits so pagehide auto-activation does not interrupt a dirty form.
 */
function trackFormDirtyState () {
  document.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      if (!formIsDirty) log('form marked dirty')
      formIsDirty = true
    }
  })

  document.addEventListener('submit', () => {
    log('form submitted, clearing dirty flag')
    formIsDirty = false
  })
}

/**
 * Keep the visible online/offline status in sync with the browser state.
 */
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
 * Disable network-only form submission controls while offline.
 */
function trackNetworkForms () {
  const forms = Array.from(document.querySelectorAll('[data-network-form]'))
  if (forms.length === 0) return
  log('tracking network-only forms', { count: forms.length })

  const render = () => {
    for (const form of forms) {
      const status = form.querySelector('[data-network-state]')
      const submit = form.querySelector('[type="submit"]')
      if (status) {
        status.textContent = navigator.onLine
          ? 'Online. Submissions will use the network.'
          : 'Offline. Submission is paused until the network returns.'
      }
      if (submit instanceof HTMLButtonElement) {
        submit.disabled = !navigator.onLine
      }
    }
  }

  for (const form of forms) {
    form.addEventListener('submit', event => {
      if (!navigator.onLine) {
        log('blocked network-only form submit while offline')
        event.preventDefault()
      }
    })
  }

  render()
  window.addEventListener('online', render)
  window.addEventListener('offline', render)
}

/**
 * Remove service workers and Cache Storage entries owned by this example.
 */
async function resetServiceWorkers () {
  const registrations = await navigator.serviceWorker.getRegistrations()
  log('unregistering service workers', { count: registrations.length })
  await Promise.all(registrations.map(registration => registration.unregister()))
  await deleteExampleCaches()
  setStatus('PWA reset complete')
}

/**
 * Clear local caches only when the active worker belongs to this example scope.
 */
async function resetLocalServiceWorkers () {
  if (!isLocalOrigin()) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  const scopedRegistrations = registrations.filter(registration => {
    const scope = new URL(registration.scope)
    return scope.origin === location.origin && scope.pathname === DOMSTACK_SERVICE_WORKER_SCOPE
  })

  log('clearing local example pwa state', { registrations: scopedRegistrations.length })
  await Promise.all(scopedRegistrations.map(registration => registration.unregister()))
  await deleteExampleCaches()
}

/**
 * Delete Cache Storage entries created by this example.
 */
async function deleteExampleCaches () {
  const names = await caches.keys()
  const exampleCaches = names.filter(name => name.startsWith(CACHE_PREFIX))
  log('deleting example caches', { caches: exampleCaches })
  await Promise.all(
    exampleCaches.map(name => caches.delete(name))
  )
}

/**
 * @param {string} value
 */
function setStatus (value) {
  const node = document.querySelector('[data-pwa-status]')
  if (node) node.textContent = value
}

/**
 * @param {unknown} value
 */
function setVersion (value) {
  const node = document.querySelector('[data-pwa-version]')
  if (node && typeof value === 'string') node.textContent = value.slice(0, 12)
}

/**
 * @param {unknown} err
 */
function reportUpdateFailure (err) {
  console.warn('PWA update check failed', err)
}

function isLocalOrigin () {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
}

function logLocalServeInstructions () {
  console.info(
    `${LOG_PREFIX} local manifest-enabled build detected; registering the PWA service worker.\n` +
    'Use `npm run serve` for PWA testing and `npm run watch` for sticky-cache-free development.'
  )
  console.info(
    `${LOG_PREFIX} reset service workers and caches with:\n` +
    `${location.origin}/?reset-sw=1`
  )
}

/**
 * This example intentionally logs more than production code normally would so
 * the PWA lifecycle is easy to watch in DevTools.
 *
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
