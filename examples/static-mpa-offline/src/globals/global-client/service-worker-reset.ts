import type { StatusBanner } from './status-banner.ts'

/**
 * Recovery and watch-mode cleanup helpers for sticky service-worker state.
 *
 * These paths intentionally live outside registration logic because they are
 * destructive: they unregister workers, delete owned caches, and reload/navigate
 * pages to escape stale or broken service-worker control.
 */

export type ServiceWorkerResetOptions = {
  cachePrefixes: string[]
}

/** Return true when the current URL requests a client-side service-worker reset. */
export function shouldResetServiceWorker (): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('reset-sw') || params.has('reset-service-worker')
}

/** Reset service workers/caches from a page that still loads enough JS to recover. */
export async function resetServiceWorkerFromWindow (
  status: Pick<StatusBanner, 'showStatus'>,
  options: ServiceWorkerResetOptions
): Promise<void> {
  status.showStatus('Resetting service worker and offline caches…', 'update')

  await unregisterServiceWorkersAndDeleteCaches(options)

  const url = new URL(window.location.href)
  url.searchParams.delete('reset-sw')
  url.searchParams.delete('reset-service-worker')
  window.location.replace(url.href)
}

/** Clear production SW state during watch mode, where no domstack manifest is emitted. */
export async function disableServiceWorkerForWatchMode (
  status: Pick<StatusBanner, 'showStatus'>,
  options: ServiceWorkerResetOptions
): Promise<void> {
  const hadController = Boolean(navigator.serviceWorker.controller)
  await unregisterServiceWorkersAndDeleteCaches(options)

  if (hadController) {
    status.showStatus('Service worker disabled in watch mode. Reloading without offline cache…', 'update')
    window.location.reload()
    return
  }

  status.showStatus('Service worker disabled in watch mode. Use `npm run serve` to test offline caching.', 'info')
}

/** Unregister all same-origin service workers and delete caches matching owned prefixes. */
async function unregisterServiceWorkersAndDeleteCaches (options: ServiceWorkerResetOptions): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations()
  for (const registration of registrations) {
    registration.active?.postMessage({ type: 'RESET_SERVICE_WORKER' })
    registration.waiting?.postMessage({ type: 'RESET_SERVICE_WORKER' })
    registration.installing?.postMessage({ type: 'RESET_SERVICE_WORKER' })
    await registration.unregister()
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter(name => options.cachePrefixes.some(prefix => name.startsWith(prefix)))
        .map(name => caches.delete(name))
    )
  }
}
