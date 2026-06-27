export const serviceWorker = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (
  /** @type {unknown} */ (globalThis)
)

const LOG_PREFIX = '[domstack-pwa:sw]'

/**
 * This example logs service-worker internals so the install/update/cache flow is
 * easy to follow in DevTools.
 *
 * @param {string} message
 * @param {unknown} [details]
 */
export function logWorker (message, details) {
  if (details === undefined) {
    console.info(LOG_PREFIX, message)
  } else {
    console.info(LOG_PREFIX, message, details)
  }
}

/**
 * @param {string} message
 * @param {unknown} [details]
 */
export function warnWorker (message, details) {
  if (details === undefined) {
    console.warn(LOG_PREFIX, message)
  } else {
    console.warn(LOG_PREFIX, message, details)
  }
}
