import type { StatusBanner } from './status-banner.ts'

/**
 * Display optional service-worker background events in the example UI.
 *
 * The service worker can receive push, one-off sync, and periodic sync events.
 * This module keeps those example-only messages separate from registration and
 * update lifecycle code.
 */

/** Listen for background-event messages from the service worker and render/log them. */
export function initializeServiceWorkerEventMessages (status: Pick<StatusBanner, 'showStatus'>): void {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('message', event => {
    const message = event.data
    if (!isServiceWorkerEventMessage(message)) return

    if (message.type === 'DOMSTACK_PUSH_RECEIVED') {
      console.info('Service worker push event received', message.payload)
      status.showStatus('Push event received by the service worker.', 'info')
    }

    if (message.type === 'DOMSTACK_SYNC_RECEIVED') {
      console.info('Service worker sync event received', message.tag)
      status.showStatus(`Sync event received: ${String(message.tag ?? 'untagged')}`, 'info')
    }

    if (message.type === 'DOMSTACK_PERIODIC_SYNC_RECEIVED') {
      console.info('Service worker periodic sync event received', message.tag)
      status.showStatus(`Periodic sync event received: ${String(message.tag ?? 'untagged')}`, 'info')
    }
  })
}

/** Narrow structured-clone messages to the simple event shape this example understands. */
function isServiceWorkerEventMessage (value: unknown): value is {
  payload?: unknown
  tag?: unknown
  type: string
} {
  return Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
}
