import { parentPort, workerData } from 'worker_threads'
import { buildPagesDirect } from './index.js'

async function run () {
  if (!parentPort) throw new Error('parentPort returned null')
  const { src, dest, siteData, opts } = workerData
  let results
  try {
    results = await buildPagesDirect(src, dest, siteData, opts ?? {})
    parentPort.postMessage(results)
  } catch (err) {
    console.dir(results, { colors: true, depth: 999 })
    console.error(err)
    throw err
  }
}

run()
