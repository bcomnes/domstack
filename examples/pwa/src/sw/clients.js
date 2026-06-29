import { logWorker, serviceWorker } from './context.js'

/**
 * Broadcast a structured message to every window client, including clients not
 * yet controlled by the current worker.
 *
 * @param {Record<string, unknown>} message
 */
export async function postToClients (message) {
  const clients = await serviceWorker.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  })
  logWorker('posting message to window clients', {
    clients: clients.length,
    message,
  })

  for (const client of clients) {
    client.postMessage(message)
  }
}
