import { initializePwa } from './pwa/runtime.js'

initializePwa().catch(err => {
  console.warn('Unable to initialize the Domstack PWA example runtime', err)
})
