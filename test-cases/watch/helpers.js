/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @import { DomStack } from '../../index.js'
 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'

/**
 * Start real native watching and drain fixture-creation notifications before
 * edits or baseline measurements. This does not suppress events or build errors.
 * @param {TestContext} t
 * @param {DomStack} site
 * @param {string} src
 * @param {Parameters<DomStack['watch']>[0]} [options]
 */
export async function startWatch (t, site, src, options = { serve: false }) {
  let eventCount = 0
  /** @type {FSWatcher | undefined} */
  let sourceWatcher
  const recordEvent = () => { eventCount++ }
  const watch = chokidar.watch
  /** @param {Parameters<typeof watch>} args */
  const trackSourceEvents = (...args) => {
    const watcher = watch(...args)
    if (args[0] === src) {
      sourceWatcher = watcher
      watcher.on('all', recordEvent)
    }
    return watcher
  }
  const trackedWatch = t.mock.method(chokidar, 'watch', trackSourceEvents)
  try {
    const report = await site.watch(options)
    assert.ok(sourceWatcher, 'native source events are observed from watcher creation')
    // The source watcher now observes initial build work. Delayed native
    // fixture-creation changes can be buffered even with ignoreInitial.
    const deadline = performance.now() + 10_000
    while (true) {
      await site.settled()
      const before = eventCount
      // Include Chokidar's 300ms atomic window, not just the current build lock.
      await delay(500)
      await site.settled()
      if (eventCount === before) break
      assert.ok(performance.now() < deadline, 'native startup events did not become quiescent')
    }
    return report
  } finally {
    sourceWatcher?.off('all', recordEvent)
    trackedWatch.mock.restore()
  }
}
