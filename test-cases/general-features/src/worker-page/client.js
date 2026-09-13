/**
 * Client code for worker test page
 */

async function initializeWorkers () {
  const response = await fetch(new URL('./workers.json', import.meta.url))
  if (!response.ok) throw new Error(`Failed to load workers.json: ${response.status}`)

  const workers = await response.json()
  if (!workers.counter || !workers['shared-counter']) throw new Error('workers.json is missing worker entries')

  const counterWorker = new Worker(
    new URL(`./${workers.counter}`, import.meta.url),
    { type: 'module' }
  )
  const sharedCounterWorker = new SharedWorker(
    new URL(`./${workers['shared-counter']}`, import.meta.url),
    { type: 'module' }
  )

  return { counterWorker, sharedCounterPort: sharedCounterWorker.port }
}

document.addEventListener('DOMContentLoaded', async () => {
  const counterElement = document.getElementById('counter')
  const sharedCounterElement = document.getElementById('shared-counter')
  const incrementButton = document.getElementById('increment')
  const resetButton = document.getElementById('reset')
  const sharedIncrementButton = document.getElementById('shared-increment')
  const sharedResetButton = document.getElementById('shared-reset')

  try {
    const { counterWorker, sharedCounterPort } = await initializeWorkers()

    counterWorker.onmessage = event => {
      if (counterElement) counterElement.textContent = event.data.count
    }
    sharedCounterPort.onmessage = event => {
      if (sharedCounterElement) sharedCounterElement.textContent = event.data.count
    }
    sharedCounterPort.start()

    incrementButton?.addEventListener('click', () => {
      counterWorker.postMessage({ action: 'increment' })
    })
    resetButton?.addEventListener('click', () => {
      counterWorker.postMessage({ action: 'reset' })
    })
    sharedIncrementButton?.addEventListener('click', () => {
      sharedCounterPort.postMessage({ action: 'increment' })
    })
    sharedResetButton?.addEventListener('click', () => {
      sharedCounterPort.postMessage({ action: 'reset' })
    })
  } catch (error) {
    document.body.dataset['workerError'] = error instanceof Error ? error.message : String(error)
  }
})
