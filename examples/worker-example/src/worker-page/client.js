// Web worker client-side script

// Helper function to load workers using workers.json for path resolution
async function initializeWorkers () {
  try {
    // Fetch the workers.json file to get worker paths
    const response = await fetch('./workers.json')

    if (!response.ok) {
      console.error('Failed to load workers.json:', response.status)
      return { error: true }
    }

    const workersData = await response.json()

    if (!workersData.counter || !workersData.fibonacci || !workersData['shared-counter']) {
      console.error('Invalid workers.json format:', workersData)
      return { error: true }
    }

    // Initialize workers with the correct hashed filenames
    const counterWorker = new Worker(
      new URL(`./${workersData.counter}`, import.meta.url),
      { type: 'module' }
    )

    const fibWorker = new Worker(
      new URL(`./${workersData.fibonacci}`, import.meta.url),
      { type: 'module' }
    )

    const sharedCounterWorker = new SharedWorker(
      new URL(`./${workersData['shared-counter']}`, import.meta.url),
      { type: 'module' }
    )

    return { counterWorker, fibWorker, sharedCounterPort: sharedCounterWorker.port }
  } catch (err) {
    console.error('Error initializing workers:', err)
    return { error: true }
  }
}

// Initialize UI elements when the DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Counter example elements
  const counterElement = document.getElementById('counter')
  const lastOperationElement = document.getElementById('lastOperation')
  const incrementButton = document.getElementById('increment')
  const decrementButton = document.getElementById('decrement')
  const resetButton = document.getElementById('reset')
  const multiplyButton = document.getElementById('multiply')

  // Shared counter example elements
  const sharedCounterElement = document.getElementById('sharedCounter')
  const sharedIncrementButton = document.getElementById('sharedIncrement')
  const sharedDecrementButton = document.getElementById('sharedDecrement')
  const sharedResetButton = document.getElementById('sharedReset')

  // Fibonacci example elements
  const fibInput = document.getElementById('fibInput')
  const calculateButton = document.getElementById('calculate')
  const resultElement = document.getElementById('fibResult')
  const computationTimeElement = document.getElementById('computationTime')

  // Initialize workers
  const { counterWorker, fibWorker, sharedCounterPort, error } = await initializeWorkers()

  if (error) {
    // Show error message if workers couldn't be initialized
    document.querySelectorAll('.demo-container').forEach(container => {
      container.innerHTML = `
        <div class="error-message">
          <p>Failed to initialize workers. Please check the console for details.</p>
          <p>This can happen if the workers.json file is missing or malformed.</p>
        </div>
      `
    })
    return
  }

  // Set up counter worker
  counterWorker.onmessage = (e) => {
    counterElement.textContent = e.data.count

    // Display last operation if available
    if (e.data.lastOperation) {
      const op = e.data.lastOperation
      lastOperationElement.textContent = `Last action: ${op.type} (${op.oldValue} → ${op.newValue})`
    }
  }

  // Button event listeners for counter
  incrementButton.addEventListener('click', () => {
    counterWorker.postMessage({ action: 'increment' })
  })

  decrementButton.addEventListener('click', () => {
    counterWorker.postMessage({ action: 'decrement' })
  })

  resetButton.addEventListener('click', () => {
    counterWorker.postMessage({ action: 'reset' })
  })

  multiplyButton.addEventListener('click', () => {
    counterWorker.postMessage({ action: 'multiply', value: 2 })
  })

  // Set up shared counter worker
  sharedCounterPort.onmessage = (e) => {
    sharedCounterElement.textContent = e.data.count
  }
  sharedCounterPort.start()

  sharedIncrementButton.addEventListener('click', () => {
    sharedCounterPort.postMessage({ action: 'increment' })
  })

  sharedDecrementButton.addEventListener('click', () => {
    sharedCounterPort.postMessage({ action: 'decrement' })
  })

  sharedResetButton.addEventListener('click', () => {
    sharedCounterPort.postMessage({ action: 'reset' })
  })

  // Set up Fibonacci worker
  let startTime

  fibWorker.onmessage = (e) => {
    const endTime = performance.now()
    const computationTime = endTime - startTime

    if (e.data.error) {
      resultElement.textContent = `Error: ${e.data.error}`
    } else {
      resultElement.textContent = e.data.result
    }

    computationTimeElement.textContent =
      `Computation time: ${computationTime.toFixed(2)}ms`

    calculateButton.disabled = false
    fibInput.disabled = false
  }

  // Calculate button event listener
  calculateButton.addEventListener('click', () => {
    const n = parseInt(fibInput.value, 10)

    if (isNaN(n) || n < 0) {
      resultElement.textContent = 'Please enter a valid positive number'
      return
    }

    startTime = performance.now()
    resultElement.textContent = 'Calculating...'
    computationTimeElement.textContent = ''
    calculateButton.disabled = true
    fibInput.disabled = true

    // Show the UI is still responsive during calculation
    const dots = ['', '.', '..', '...']
    let dotIndex = 0

    const dotAnimation = setInterval(() => {
      resultElement.textContent = 'Calculating' + dots[dotIndex]
      dotIndex = (dotIndex + 1) % dots.length
    }, 300)

    // Send message to worker
    fibWorker.postMessage({ n })

    // Cleanup animation when worker responds
    fibWorker.addEventListener('message', function clearAnimation () {
      clearInterval(dotAnimation)
      fibWorker.removeEventListener('message', clearAnimation)
    }, { once: true })
  })
})
