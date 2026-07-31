/// <reference lib="webworker" />

import { handleCacheInspectionMessage } from './cache-inspection.ts'
import {
  handlePeriodicSyncEvent,
  handlePushEvent,
  handleSyncEvent,
  type PushEventLike,
  type SyncEventLike,
} from './background-events.ts'
import { handleFetchEvent } from './fetch-handlers.ts'
import {
  activateWorker,
  resetServiceWorker,
} from './lifecycle.ts'
import { installPrecache } from './precache.ts'
import {
  cachePrefixes,
  precacheName,
  runtimeCacheName,
} from '#service-worker-settings'
import type {
  ActiveServiceWorkerConfig,
  ServiceWorkerConfig,
  StaticMpaOfflineServiceWorkerPolicy,
} from '#service-worker-settings'

/**
 * Static MPA service-worker entrypoint.
 *
 * This file owns example-specific config and event wiring. Implementation
 * details live in focused modules so caching, fetch routing, lifecycle reset,
 * client messaging, and optional background events can evolve independently.
 *
 * MDN quick links:
 * - Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
 * - ServiceWorkerGlobalScope: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope
 * - ExtendableEvent.waitUntil(): https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil
 * - skipWaiting(): https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting
 */

declare const self: ServiceWorkerGlobalScope

declare const __DOMSTACK_SERVICE_WORKER_POLICY__: StaticMpaOfflineServiceWorkerPolicy

const config: ServiceWorkerConfig = {
  cachePrefixes: [...cachePrefixes],
  precacheName,
  runtimeCacheName,
}

const policy = typeof __DOMSTACK_SERVICE_WORKER_POLICY__ === 'undefined'
  ? undefined
  : __DOMSTACK_SERVICE_WORKER_POLICY__

if (policy) {
  const activeConfig: ActiveServiceWorkerConfig = { ...config, policy }

  self.addEventListener('install', event => {
    event.waitUntil(installPrecache(activeConfig))
  })

  self.addEventListener('activate', event => {
    event.waitUntil(activateWorker(activeConfig))
  })

  self.addEventListener('message', event => {
    if (handleCacheInspectionMessage(activeConfig, event)) return

    if (event.data?.type === 'SKIP_WAITING') {
      event.waitUntil(self.skipWaiting())
      return
    }

    if (event.data?.type === 'RESET_SERVICE_WORKER') {
      event.waitUntil(resetServiceWorker(activeConfig))
    }
  })

  self.addEventListener('fetch', event => {
    handleFetchEvent(activeConfig, event)
  })

  self.addEventListener('push', event => {
    event.waitUntil(handlePushEvent(event as PushEventLike))
  })

  self.addEventListener('sync', ((event: Event) => {
    const syncEvent = event as SyncEventLike
    syncEvent.waitUntil(handleSyncEvent(syncEvent))
  }) as EventListener)

  self.addEventListener('periodicsync', ((event: Event) => {
    const periodicSyncEvent = event as SyncEventLike
    periodicSyncEvent.waitUntil(handlePeriodicSyncEvent(periodicSyncEvent))
  }) as EventListener)
} else {
  self.addEventListener('install', () => {
    self.skipWaiting()
  })

  self.addEventListener('activate', event => {
    event.waitUntil(resetServiceWorker(config))
  })
}
