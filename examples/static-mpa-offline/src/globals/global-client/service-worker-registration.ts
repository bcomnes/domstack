import type { StatusBanner } from './status-banner.ts'

/**
 * Service-worker registration and update UX for the static MPA example.
 *
 * This module owns browser registration, waiting-worker prompts, and the
 * one-time reload after a user-approved update takes control. It receives a UI
 * interface from the entrypoint instead of importing a banner implementation.
 */

/** Register the service worker after page load and wire update lifecycle events. */
export async function registerServiceWorker (
  status: Pick<StatusBanner, 'showStatus'>,
  url: string,
  scope: string
): Promise<void> {
  const registration = await navigator.serviceWorker.register(url, {
    scope,
    type: 'module',
    updateViaCache: 'none',
  })

  status.showStatus('Installing offline cache…')

  if (registration.installing) {
    trackInstallingWorker(status, registration.installing, registration)
  } else if (registration.waiting && navigator.serviceWorker.controller) {
    applyWaitingUpdate(status, registration, 'Applying offline update from previous visit…')
  } else if (registration.active) {
    status.showStatus('Offline cache is ready.', 'ready')
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    if (worker) trackInstallingWorker(status, worker, registration)
  })

  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
}

/** Track an installing worker until it is ready, failed, or waiting for user action. */
function trackInstallingWorker (
  status: Pick<StatusBanner, 'showStatus'>,
  worker: ServiceWorker,
  registration: ServiceWorkerRegistration
): void {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') {
      if (navigator.serviceWorker.controller) {
        promptForUpdate(status, registration)
      } else {
        status.showStatus('Offline cache is ready.', 'ready')
      }
      return
    }

    if (worker.state === 'redundant') {
      console.info('Service worker became redundant during registration.', worker)
    }
  })
}

/** Show the in-page update prompt for a newly installed waiting worker. */
function promptForUpdate (
  status: Pick<StatusBanner, 'showStatus'>,
  registration: ServiceWorkerRegistration
): void {
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'Reload now'
  reload.addEventListener('click', () => {
    reload.disabled = true
    applyWaitingUpdate(status, registration, 'Updating offline cache…')
  })

  const later = document.createElement('button')
  later.type = 'button'
  later.textContent = 'Later'
  later.addEventListener('click', () => {
    status.showStatus('Update will be applied after all tabs are closed.', 'info')
  })

  status.showStatus('A new offline version is available.', 'update', [reload, later])
}

/** Ask the waiting worker to skip waiting; `controllerchange` will reload the page. */
function applyWaitingUpdate (
  status: Pick<StatusBanner, 'showStatus'>,
  registration: ServiceWorkerRegistration,
  message: string
): void {
  const worker = registration.waiting
  if (!worker) return

  worker.postMessage({ type: 'SKIP_WAITING' })
  status.showStatus(message, 'update')
}
