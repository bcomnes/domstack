import { Workbox } from 'workbox-window'
import type { StatusBanner } from './status-banner.ts'

/**
 * Service-worker registration and update UX for the static MPA example.
 *
 * This module uses `workbox-window` to track browser registration, waiting
 * worker prompts, and the one-time reload after a user-approved update takes
 * control. It receives a UI interface from the entrypoint instead of importing
 * a banner implementation.
 */

/** Register the service worker after page load and wire update lifecycle events. */
export async function registerServiceWorker (
  status: Pick<StatusBanner, 'showStatus'>,
  url: string,
  scope: string
): Promise<void> {
  const workbox = new Workbox(url, {
    scope,
    type: 'module',
    updateViaCache: 'none',
  })
  const hadControllerAtRegistration = Boolean(navigator.serviceWorker.controller)
  let applyingUpdate = false
  let lifecycleStatusShown = false

  const showLifecycleStatus = (...args: Parameters<StatusBanner['showStatus']>): void => {
    lifecycleStatusShown = true
    status.showStatus(...args)
  }

  workbox.addEventListener('installing', () => {
    showLifecycleStatus('Installing offline cache…')
  })

  workbox.addEventListener('activated', event => {
    if (!event.isUpdate) showLifecycleStatus('Offline cache is ready.', 'ready')
  })

  workbox.addEventListener('waiting', event => {
    if (event.wasWaitingBeforeRegister) {
      applyingUpdate = true
      workbox.messageSkipWaiting()
      showLifecycleStatus('Applying offline update from previous visit…', 'update')
      return
    }

    lifecycleStatusShown = true
    promptForUpdate(status, workbox, () => {
      applyingUpdate = true
    })
  })

  workbox.addEventListener('controlling', () => {
    if (hadControllerAtRegistration || applyingUpdate) {
      window.location.reload()
      return
    }

    showLifecycleStatus('Offline cache is ready.', 'ready')
  })

  workbox.addEventListener('redundant', event => {
    console.info('Service worker became redundant during registration.', event)
  })

  const registration = await workbox.register({ immediate: true })
  await workbox.update()
  if (lifecycleStatusShown) return

  if (registration?.installing) {
    status.showStatus('Installing offline cache…')
    return
  }

  if (registration?.waiting) {
    promptForUpdate(status, workbox, () => {
      applyingUpdate = true
    })
    return
  }

  if (registration?.active) {
    status.showStatus('Offline cache is ready.', 'ready')
    return
  }

  status.showStatus('Service worker registered.', 'info')
}

/** Show the in-page update prompt for a newly installed waiting worker. */
function promptForUpdate (
  status: Pick<StatusBanner, 'showStatus'>,
  workbox: Workbox,
  onApplyUpdate: () => void
): void {
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'Reload now'
  reload.addEventListener('click', () => {
    reload.disabled = true
    onApplyUpdate()
    workbox.messageSkipWaiting()
    status.showStatus('Updating offline cache…', 'update')
  })

  const later = document.createElement('button')
  later.type = 'button'
  later.textContent = 'Later'
  later.addEventListener('click', () => {
    status.showStatus('Update will be applied after all tabs are closed.', 'info')
  })

  status.showStatus('A new offline version is available.', 'update', [reload, later])
}
