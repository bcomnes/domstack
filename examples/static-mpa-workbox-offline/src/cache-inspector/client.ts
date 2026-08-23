/// <reference lib="dom" />

import { markPageClientLoaded } from '../mark-page-client-loaded.ts'

markPageClientLoaded('cache inspector')

const workboxCacheInspectorButton = document.querySelector<HTMLButtonElement>('#inspect-caches')
const workboxCacheInspectorOutput = document.querySelector<HTMLPreElement>('#cache-inspection-output')

workboxCacheInspectorButton?.addEventListener('click', async () => {
  writeOutput('Requesting cache details from the service worker…')

  try {
    writeOutput(JSON.stringify(await inspectWorkboxExampleCaches(), null, 2))
  } catch (error) {
    writeOutput(error instanceof Error ? error.message : String(error))
  }
})

function writeOutput (message: string): void {
  if (!workboxCacheInspectorOutput) return
  workboxCacheInspectorOutput.textContent = message
}

async function inspectWorkboxExampleCaches (): Promise<unknown> {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported in this browser.')
  if (!navigator.serviceWorker.controller) throw new Error('This page is not controlled by a service worker yet. Reload after the worker is ready.')

  const channel = new MessageChannel()
  navigator.serviceWorker.controller.postMessage(
    { type: 'DOMSTACK_INSPECT_CACHES' },
    [channel.port2]
  )

  return await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      channel.port1.close()
      reject(new Error('Timed out waiting for service-worker cache details.'))
    }, 5000)

    channel.port1.addEventListener('message', event => {
      window.clearTimeout(timeout)
      channel.port1.close()
      resolve(event.data)
    }, { once: true })
    channel.port1.start()
  })
}
