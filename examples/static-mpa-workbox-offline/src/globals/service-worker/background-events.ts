/// <reference lib="webworker" />

/**
 * Demo-only background event handlers for browser DevTools.
 *
 * Workbox does not provide generic push, one-off sync, or periodic sync
 * handlers. The Workbox background-sync package is for replaying failed
 * requests, so this example uses the platform events directly and forwards
 * visible messages to open pages.
 */

/** Register native background-event handlers used by browser DevTools demos. */
export function initializeBackgroundEventDemos (scope: ServiceWorkerGlobalScope): void {
  scope.addEventListener('push', event => {
    event.waitUntil(handlePush(scope, event as PushEventLike))
  })

  scope.addEventListener('sync', ((event: Event) => {
    const syncEvent = event as TaggedExtendableEvent
    syncEvent.waitUntil(handleSync(scope, syncEvent, 'DOMSTACK_SYNC_RECEIVED'))
  }) as EventListener)

  scope.addEventListener('periodicsync', ((event: Event) => {
    const periodicSyncEvent = event as TaggedExtendableEvent
    periodicSyncEvent.waitUntil(handleSync(scope, periodicSyncEvent, 'DOMSTACK_PERIODIC_SYNC_RECEIVED'))
  }) as EventListener)
}

type PushEventLike = ExtendableEvent & {
  data?: {
    json: () => unknown
    text: () => string
  }
}

type TaggedExtendableEvent = ExtendableEvent & {
  tag?: string
}

type ServiceWorkerEventMessage = {
  payload?: unknown
  tag?: string
  type: 'DOMSTACK_PERIODIC_SYNC_RECEIVED' | 'DOMSTACK_PUSH_RECEIVED' | 'DOMSTACK_SYNC_RECEIVED'
}

async function handlePush (scope: ServiceWorkerGlobalScope, event: PushEventLike): Promise<void> {
  const payload = readPushPayload(event)
  await Promise.all([
    postToWindowClients(scope, {
      payload,
      type: 'DOMSTACK_PUSH_RECEIVED',
    }),
    showPushNotification(scope, payload),
  ])
}

async function handleSync (
  scope: ServiceWorkerGlobalScope,
  event: TaggedExtendableEvent,
  type: ServiceWorkerEventMessage['type']
): Promise<void> {
  await postToWindowClients(scope, {
    tag: event.tag,
    type,
  })
}

function readPushPayload (event: PushEventLike): unknown {
  if (!event.data) return undefined

  try {
    return event.data.json()
  } catch {
    return event.data.text()
  }
}

async function postToWindowClients (
  scope: ServiceWorkerGlobalScope,
  message: ServiceWorkerEventMessage
): Promise<void> {
  const clients = await scope.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  })

  for (const client of clients) client.postMessage(message)
}

async function showPushNotification (scope: ServiceWorkerGlobalScope, payload: unknown): Promise<void> {
  if (Notification.permission !== 'granted') return

  await scope.registration.showNotification('Domstack push event', {
    body: stringifyPushPayload(payload),
    tag: 'domstack-push-demo',
  })
}

function stringifyPushPayload (payload: unknown): string {
  if (payload === undefined) return 'Push event received from DevTools.'
  if (typeof payload === 'string') return payload

  try {
    return JSON.stringify(payload)
  } catch {
    return 'Push event received from DevTools.'
  }
}
