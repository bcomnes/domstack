import { initializeConnectionStatus } from './connection-status.ts'
import { initializeServiceWorkerEventMessages } from './service-worker-events.ts'
import { registerServiceWorker } from './service-worker-registration.ts'
import {
  disableServiceWorkerForWatchMode,
  resetServiceWorkerFromWindow,
  shouldResetServiceWorker,
} from './service-worker-reset.ts'
import { createStatusBanner } from './status-banner.ts'
import {
  cachePrefixes,
  offlineRecheckIntervalMs,
  offlineStorageKey,
  onlineCheckTimeoutMs,
} from '#service-worker-settings'

/**
 * Browser entrypoint for the offline static MPA example.
 *
 * This file owns example-specific config and wires independent modules together:
 * connection status, service-worker registration, reset/watch cleanup, and the
 * in-page status UI. The modules receive only the config/UI capabilities they need.
 */

const connectionStatusOptions = {
  offlineRecheckIntervalMs,
  offlineStorageKey,
  onlineCheckTimeoutMs,
}

const serviceWorkerResetOptions = {
  cachePrefixes: [...cachePrefixes],
}

const manifestEnabled = process.env.DOMSTACK_MANIFEST_ENABLED === 'true'
const serviceWorkerScope = process.env.DOMSTACK_SERVICE_WORKER_SCOPE
const serviceWorkerUrl = process.env.DOMSTACK_SERVICE_WORKER_URL

const status = createStatusBanner()

initializeConnectionStatus(status, connectionStatusOptions)
initializeServiceWorkerEventMessages(status)

if (serviceWorkerUrl && serviceWorkerScope && 'serviceWorker' in navigator) {
  if (shouldResetServiceWorker()) {
    try {
      await resetServiceWorkerFromWindow(status, serviceWorkerResetOptions)
    } catch (error) {
      console.error('Service worker reset failed', error)
    }
  } else if (!manifestEnabled) {
    try {
      await disableServiceWorkerForWatchMode(status, serviceWorkerResetOptions)
    } catch (error) {
      console.error('Service worker watch-mode cleanup failed', error)
    }
  } else {
    try {
      await windowLoaded()
      await registerServiceWorker(status, serviceWorkerUrl, serviceWorkerScope)
    } catch (error) {
      console.error('Service worker registration failed', error)
    }
  }
}

/** Resolve after the load event so service-worker registration avoids competing with first paint. */
async function windowLoaded (): Promise<void> {
  if (document.readyState === 'complete') return

  await new Promise<void>(resolve => {
    window.addEventListener('load', () => resolve(), { once: true })
  })
}
