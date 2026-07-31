/// <reference lib="dom" />

const offlineCacheInspectorButton = document.querySelector<HTMLButtonElement>('#inspect-caches')
const offlineCacheInspectorOutput = document.querySelector<HTMLPreElement>('#cache-inspection-output')

offlineCacheInspectorButton?.addEventListener('click', async () => {
  writeOutput('Requesting cache details from the service worker…')

  try {
    writeOutput(JSON.stringify(await inspectOfflineExampleCaches(), null, 2))
  } catch (error) {
    writeOutput(error instanceof Error ? error.message : String(error))
  }
})

function writeOutput (message: string): void {
  if (!offlineCacheInspectorOutput) return
  offlineCacheInspectorOutput.textContent = message
}

async function inspectOfflineExampleCaches (): Promise<unknown> {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported in this browser.')
  if (!navigator.serviceWorker.controller) throw new Error('This page is not controlled by a service worker yet. Reload after the worker is ready.')

  const id = crypto.randomUUID()

  return await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      reject(new Error('Timed out waiting for service-worker cache details.'))
    }, 5000)

    function onMessage (event: MessageEvent): void {
      const message = event.data
      if (!isOfflineCacheInspectionResult(message, id)) return

      window.clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(message.payload)
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    navigator.serviceWorker.controller?.postMessage({
      id,
      type: 'DOMSTACK_INSPECT_CACHES',
    })
  })
}

function isOfflineCacheInspectionResult (
  message: unknown,
  id: string
): message is { payload: unknown } {
  if (!message || typeof message !== 'object') return false
  return 'type' in message && message.type === 'DOMSTACK_CACHE_INSPECTION_RESULT' &&
    'id' in message && message.id === id &&
    'payload' in message
}
