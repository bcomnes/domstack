/// <reference lib="webworker" />

import { serviceWorkerNotificationTag } from '#service-worker-settings'
import { postToWindowClients } from './clients.ts'

/**
 * Optional background-event extension hooks for the offline example.
 *
 * These handlers intentionally do not subscribe users, request permissions,
 * register sync jobs, or cache app data. They only surface events to open pages
 * and, for push, show a notification when permission has already been granted.
 *
 * Related functions:
 * - `handlePushEvent()` handles Push API events.
 * - `handleSyncEvent()` handles one-off Background Sync events.
 * - `handlePeriodicSyncEvent()` handles Periodic Background Sync events.
 *
 * MDN quick links:
 * - Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
 * - PushEvent: https://developer.mozilla.org/en-US/docs/Web/API/PushEvent
 * - Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
 * - Background Synchronization API: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
 * - Periodic Background Sync API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API
 */

declare const self: ServiceWorkerGlobalScope

type ExtendableEventLike = Event & {
  waitUntil (promise: Promise<unknown>): void
}

export type PushEventLike = ExtendableEventLike & {
  data?: {
    json (): unknown
    text (): string
  }
}

export type SyncEventLike = ExtendableEventLike & {
  tag?: string
}

/**
 * Handle a push payload by notifying open windows and optionally showing a notification.
 *
 * See MDN PushEvent: https://developer.mozilla.org/en-US/docs/Web/API/PushEvent
 */
export async function handlePushEvent (event: PushEventLike): Promise<void> {
  const payload = readPushPayload(event)

  await postToWindowClients({
    payload,
    type: 'DOMSTACK_PUSH_RECEIVED',
  })

  if (!('Notification' in self) || Notification.permission !== 'granted') return

  const notification = normalizeNotificationPayload(payload)
  await self.registration.showNotification(notification.title, {
    body: notification.body,
    data: notification.data,
    tag: serviceWorkerNotificationTag,
  })
}

/** Surface a one-off Background Sync event to open windows. */
export async function handleSyncEvent (event: SyncEventLike): Promise<void> {
  await postToWindowClients({
    tag: event.tag ?? null,
    type: 'DOMSTACK_SYNC_RECEIVED',
  })
}

/** Surface a Periodic Background Sync event to open windows. */
export async function handlePeriodicSyncEvent (event: SyncEventLike): Promise<void> {
  await postToWindowClients({
    tag: event.tag ?? null,
    type: 'DOMSTACK_PERIODIC_SYNC_RECEIVED',
  })
}

function readPushPayload (event: PushEventLike): unknown {
  if (!event.data) return null

  try {
    return event.data.json()
  } catch {
    return event.data.text()
  }
}

function normalizeNotificationPayload (payload: unknown): {
  title: string
  body?: string
  data?: unknown
} {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return {
      title: typeof record.title === 'string' ? record.title : 'Static MPA offline example',
      body: typeof record.body === 'string' ? record.body : undefined,
      data: payload,
    }
  }

  return {
    title: 'Static MPA offline example',
    body: typeof payload === 'string' ? payload : undefined,
    data: payload,
  }
}
