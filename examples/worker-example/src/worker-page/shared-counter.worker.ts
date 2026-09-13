/// <reference lib="webworker" />

export {}

const sharedWorker = globalThis as unknown as SharedWorkerGlobalScope
const ports = new Set<MessagePort>()
let count = 0

sharedWorker.onconnect = event => {
  const port = event.ports[0]
  if (!port) return

  ports.add(port)
  port.onmessage = message => {
    switch (message.data.action) {
      case 'increment':
        count++
        break
      case 'decrement':
        count--
        break
      case 'reset':
        count = 0
        break
      default:
        return
    }

    broadcastCount()
  }

  port.start()
  port.postMessage({ count })
}

function broadcastCount () {
  for (const port of ports) port.postMessage({ count })
}
