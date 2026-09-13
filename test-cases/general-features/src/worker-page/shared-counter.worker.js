/// <reference lib="webworker" />

const sharedWorker = /** @type {SharedWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis))
/** @type {Set<MessagePort>} */
const ports = new Set()
let count = 0

sharedWorker.onconnect = (/** @type {MessageEvent} */ event) => {
  const port = event.ports[0]
  if (!port) return

  ports.add(port)

  port.onmessage = (/** @type {MessageEvent} */ message) => {
    switch (message.data.action) {
      case 'increment':
        count++
        break
      case 'reset':
        count = 0
        break
      default:
        return
    }

    for (const connectedPort of ports) connectedPort.postMessage({ count })
  }

  port.start()
  port.postMessage({ count })
}
