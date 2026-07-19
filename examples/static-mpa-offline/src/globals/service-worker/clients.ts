/// <reference lib="webworker" />

/**
 * Window-client helpers for service-worker-to-page communication.
 *
 * Related functions:
 * - `postToWindowClients()` broadcasts background event messages to open pages.
 *
 * MDN quick links:
 * - Clients: https://developer.mozilla.org/en-US/docs/Web/API/Clients
 * - Client: https://developer.mozilla.org/en-US/docs/Web/API/Client
 * - WindowClient: https://developer.mozilla.org/en-US/docs/Web/API/WindowClient
 */

declare const self: ServiceWorkerGlobalScope

/**
 * Broadcast a structured-cloneable message to every same-origin window client.
 *
 * See MDN Client.postMessage(): https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage
 */
export async function postToWindowClients (message: Record<string, unknown>): Promise<void> {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  })

  for (const client of clients) {
    client.postMessage(message)
  }
}
