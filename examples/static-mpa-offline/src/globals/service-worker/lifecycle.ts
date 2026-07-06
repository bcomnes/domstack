/// <reference lib="webworker" />

import {
  activatePrecache,
  deleteOwnedCaches,
} from './precache.ts'
import type {
  ActiveServiceWorkerConfig,
  ServiceWorkerConfig,
} from '#service-worker-settings'

/**
 * Service-worker lifecycle helpers that are independent of fetch routing.
 *
 * Related functions:
 * - `activateWorker()` enables navigation preload, cleans precache state, and claims clients.
 * - `resetServiceWorker()` clears owned caches and unregisters this worker.
 *
 * MDN quick links:
 * - install event: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/install_event
 * - activate event: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/activate_event
 * - Clients.claim(): https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
 * - NavigationPreloadManager: https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager
 */

declare const self: ServiceWorkerGlobalScope

/**
 * Complete activation work after install succeeds.
 *
 * `clients.claim()` lets this active worker control existing clients:
 * https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
 */
export async function activateWorker (config: ActiveServiceWorkerConfig): Promise<void> {
  if (self.registration.navigationPreload) {
    await self.registration.navigationPreload.enable()
  }

  await activatePrecache(config)
  await self.clients.claim()
}

/** Remove this worker and its owned caches. */
export async function resetServiceWorker (config: ServiceWorkerConfig): Promise<void> {
  await deleteOwnedCaches(config)
  await self.registration.unregister()
}
