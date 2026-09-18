/**
 * @import { WorkerBuildMessage, WorkerBuildStepResult } from './protocol.js'
 */

import { parentPort } from 'node:worker_threads'
import { buildPagesDirect } from '../build.js'
import { serializeBuildError, workerResultTransportFailure } from './protocol.js'

if (!parentPort) throw new Error('parentPort returned null')
const port = parentPort
let used = false

/** @param {WorkerBuildStepResult} result */
function sendResult (result) {
  port.postMessage({ type: 'result', result })
}

/** @param {unknown} error */
function sendFailure (error) {
  /** @type {WorkerBuildStepResult} */
  const result = {
    type: 'page',
    report: { pages: [], templates: [] },
    outputs: [],
    warnings: [],
    errors: [serializeBuildError(error)],
  }
  try {
    sendResult(result)
  } catch {
    // A thrown value/cause/domain context can itself contain functions. Fall
    // back to a plain error with no cause or application-owned properties.
    result.errors = [{ error: new Error('Page build failure could not be serialized') }]
    sendResult(result)
  }
}

/** @param {WorkerBuildMessage} job */
async function run (job) {
  let result
  try {
    // DOMStack-controlled application imports start here. Inherited preloads or
    // loaders can import earlier, so the pool skips speculation with those flags.
    result = await buildPagesDirect(job.src, job.dest, job.siteData, job.opts)
  } catch (error) {
    sendFailure(error)
    return
  }
  try {
    sendResult(result)
  } catch (error) {
    // A build may already have written outputs. Preserve their ownership even
    // when application errors or private cache candidates cannot cross the wire.
    sendResult(workerResultTransportFailure(result, error))
  }
}

port.on('message', message => {
  const job = /** @type {WorkerBuildMessage | null} */ (message)
  if (used || job?.type !== 'build' || typeof job.src !== 'string' || typeof job.dest !== 'string' ||
      !job.siteData || typeof job.siteData !== 'object' || !job.opts || typeof job.opts !== 'object') {
    throw new Error('Invalid or repeated page worker build message')
  }
  used = true
  run(job).catch(error => {
    // If even the minimal failure cannot be posted, surface a worker error
    // regardless of inherited unhandled-rejection settings.
    setImmediate(() => { throw error })
  })
})
port.on('messageerror', () => { throw new Error('Page worker build message could not be deserialized') })

// Static imports have loaded DOMStack's build graph, but no job has run yet.
port.postMessage({ type: 'ready' })
