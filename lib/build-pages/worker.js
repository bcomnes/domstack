import { parentPort, workerData } from 'worker_threads'
import { buildPagesDirect } from './index.js'

async function run () {
  if (!parentPort) throw new Error('parentPort returned null')
  const { src, dest, siteData, opts } = workerData
  try {
    const results = await buildPagesDirect(src, dest, siteData, opts ?? {})
    parentPort.postMessage(results)
  } catch (err) {
    // Layout loading and vars resolution can fail before any page is rendered.
    // Report those failures through the normal build channel so watch can retry.
    parentPort.postMessage({
      type: 'page',
      report: { pages: [], templates: [] },
      outputs: [],
      warnings: [],
      errors: [{
        error: err instanceof Error ? err : new Error('Non-error thrown during page build', { cause: err }),
        errorData: {},
      }],
    })
  }
}

run()
