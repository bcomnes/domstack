import type { StatusBanner } from './status-banner.ts'

/**
 * Online/offline indicator state for cached navigations.
 *
 * This module mostly trusts `navigator.onLine`, but remembers when the current
 * tab observed offline so cached page-to-page navigations do not incorrectly
 * reset the indicator to online. While offline, it periodically probes the
 * origin to detect recovery when browser `online` events are unreliable.
 */

export type ConnectionStatusOptions = {
  offlineRecheckIntervalMs: number
  offlineStorageKey: string
  onlineCheckTimeoutMs: number
}

let connectionStatusCheck = 0
let connectionStatusOnline = navigator.onLine
let offlineRecheckTimer: number | undefined
let onlineCheckPromise: Promise<boolean> | undefined

/** Register browser lifecycle listeners and render the initial connection state. */
export function initializeConnectionStatus (
  status: Pick<StatusBanner, 'showConnectionStatus'>,
  options: ConnectionStatusOptions
): void {
  window.addEventListener('online', () => updateConnectionStatus(status, options))
  window.addEventListener('offline', () => updateConnectionStatus(status, options))
  window.addEventListener('focus', () => updateConnectionStatus(status, options))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      updateConnectionStatus(status, options)
    } else {
      stopOfflineRecheck()
    }
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateConnectionStatus(status, options), { once: true })
  } else {
    updateConnectionStatus(status, options)
  }
}

/** Update the indicator from browser state, probing only after this tab observed offline. */
function updateConnectionStatus (
  status: Pick<StatusBanner, 'showConnectionStatus'>,
  options: ConnectionStatusOptions
): void {
  if (!navigator.onLine) {
    setConnectionStatus(status, options, false)
    return
  }

  if (wasOfflineInThisTab(options)) {
    setConnectionStatus(status, options, false)
    verifyOfflineRecovery(status, options)
    return
  }

  setConnectionStatus(status, options, true)
}

/** Persist and render the current connection state, starting/stopping recovery checks. */
function setConnectionStatus (
  status: Pick<StatusBanner, 'showConnectionStatus'>,
  options: ConnectionStatusOptions,
  online: boolean
): void {
  connectionStatusOnline = online
  rememberConnectionStatus(options, online)
  status.showConnectionStatus(online)

  if (online) {
    stopOfflineRecheck()
  } else {
    startOfflineRecheck(status, options)
  }
}

/** Start a low-frequency recovery probe while the tab is visible and marked offline. */
function startOfflineRecheck (
  status: Pick<StatusBanner, 'showConnectionStatus'>,
  options: ConnectionStatusOptions
): void {
  if (offlineRecheckTimer !== undefined) return
  if (document.visibilityState === 'hidden') return

  offlineRecheckTimer = window.setInterval(() => {
    if (!connectionStatusOnline) verifyOfflineRecovery(status, options)
  }, options.offlineRecheckIntervalMs)
}

/** Stop the offline recovery probe. */
function stopOfflineRecheck (): void {
  if (offlineRecheckTimer === undefined) return

  window.clearInterval(offlineRecheckTimer)
  offlineRecheckTimer = undefined
}

/** Probe the origin once and flip online only if the network check succeeds. */
function verifyOfflineRecovery (
  status: Pick<StatusBanner, 'showConnectionStatus'>,
  options: ConnectionStatusOptions
): void {
  const check = ++connectionStatusCheck

  verifyOnlineStatus(options).then(online => {
    if (check !== connectionStatusCheck) return
    if (online) setConnectionStatus(status, options, true)
  }).catch(() => {
    if (check !== connectionStatusCheck) return
    setConnectionStatus(status, options, false)
  })
}

/** Coalesce concurrent origin reachability checks into one in-flight request. */
async function verifyOnlineStatus (options: ConnectionStatusOptions): Promise<boolean> {
  if (onlineCheckPromise) return onlineCheckPromise

  onlineCheckPromise = fetchOnlineStatus(options)
  try {
    return await onlineCheckPromise
  } finally {
    onlineCheckPromise = undefined
  }
}

/** Return whether this tab previously observed offline state across cached navigations. */
function wasOfflineInThisTab (options: ConnectionStatusOptions): boolean {
  try {
    return window.sessionStorage.getItem(options.offlineStorageKey) === 'true'
  } catch {
    return !connectionStatusOnline
  }
}

/** Store offline state in sessionStorage so cached navigations preserve the indicator. */
function rememberConnectionStatus (options: ConnectionStatusOptions, online: boolean): void {
  try {
    if (online) {
      window.sessionStorage.removeItem(options.offlineStorageKey)
    } else {
      window.sessionStorage.setItem(options.offlineStorageKey, 'true')
    }
  } catch {
    // Storage can be unavailable in private browsing or restrictive contexts.
  }
}

/** Fetch the origin with cache bypass to confirm network reachability after offline state. */
async function fetchOnlineStatus (options: ConnectionStatusOptions): Promise<boolean> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.onlineCheckTimeoutMs)

  try {
    const url = new URL(window.location.origin)
    url.searchParams.set('__domstack_online_check', String(Date.now()))

    const response = await fetch(url.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })

    return response.ok
  } finally {
    window.clearTimeout(timeout)
  }
}
