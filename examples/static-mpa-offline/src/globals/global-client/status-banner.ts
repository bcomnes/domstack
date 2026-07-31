/**
 * Minimal status UI adapter used by the example client modules.
 *
 * Keeping this as a small interface lets lifecycle/connectivity modules receive
 * UI capabilities as arguments instead of importing DOM rendering directly.
 */

export type StatusBanner = {
  showConnectionStatus (online: boolean): void
  showStatus (message: string, state?: string, actions?: HTMLElement[]): void
}

/** Create the default in-page banner implementation for this example. */
export function createStatusBanner (): StatusBanner {
  getStatusBanner()

  return {
    showConnectionStatus,
    showStatus,
  }
}

/** Render a status message and optional action buttons in the shared banner. */
function showStatus (message: string, state = 'info', actions: HTMLElement[] = []): void {
  const status = getStatusBanner()

  status.dataset.state = state
  status.replaceChildren(getConnectionIndicator())

  const text = document.createElement('span')
  text.textContent = message
  status.append(text)

  if (actions.length > 0) {
    const actionList = document.createElement('span')
    actionList.className = 'offline-status__actions'
    actionList.append(...actions)
    status.append(actionList)
  }
}

/** Render the online/offline badge without changing the current status message. */
function showConnectionStatus (online: boolean): void {
  const indicator = getConnectionIndicator()
  indicator.dataset.state = online ? 'online' : 'offline'
  indicator.textContent = online ? 'Online' : 'Offline'
}

/** Return the shared status banner, creating it at the top of the body if needed. */
function getStatusBanner (): HTMLElement {
  let status = document.querySelector<HTMLElement>('.offline-status')
  if (!status) {
    status = document.createElement('div')
    status.className = 'offline-status'
    document.body.prepend(status)
  }

  return status
}

/** Return the connection badge, preserving it across banner re-renders. */
function getConnectionIndicator (): HTMLElement {
  let indicator = document.querySelector<HTMLElement>('.connection-status')
  if (!indicator) {
    indicator = document.createElement('span')
    indicator.className = 'connection-status'
  }

  const status = getStatusBanner()
  if (!status.contains(indicator)) status.prepend(indicator)

  return indicator
}
