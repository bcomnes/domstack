/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @import { DomStack } from '../../index.js'
 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'

/** @type {WeakMap<DomStack, FSWatcher>} */
const sourceWatchers = new WeakMap()

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
    sourceWatchers.set(site, sourceWatcher)
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

/**
 * Observe the edit before awaiting its queued work: settled() alone can return
 * before Chokidar sees the write. This also handles failed builds and no-op routes.
 * Browser-only rebundles need their own esbuild completion signal as well.
 * @param {DomStack} site
 * @param {string} path Absolute source path changed by mutate.
 * @param {() => Promise<unknown>} mutate
 */
export async function editAndWait (site, path, mutate) {
  const watcher = sourceWatchers.get(site)
  assert.ok(watcher, 'startWatch must observe the source watcher before editing')
  const observed = Promise.withResolvers()
  /** @param {string} event @param {string} changedPath */
  const onEvent = (event, changedPath) => {
    if (changedPath === path && ['add', 'change', 'unlink'].includes(event)) observed.resolve(undefined)
  }
  const timeout = setTimeout(() => {
    observed.reject(new Error(`Timed out waiting for source change: ${path}`))
  }, 10_000)
  watcher.on('all', onEvent)
  watcher.once('error', observed.reject)
  try {
    await Promise.all([observed.promise, mutate()])
    // Chokidar's source handlers queue the build synchronously with the event.
    await site.settled()
  } finally {
    clearTimeout(timeout)
    watcher.off('all', onEvent)
    watcher.off('error', observed.reject)
  }
}

/**
 * Wait for esbuild's independent watcher, using a log cursor captured before editing.
 * @param {string[]} logs
 * @param {number} cursor
 * @param {string} completion
 */
export async function waitForRebuild (logs, cursor, completion) {
  const deadline = performance.now() + 10_000
  while (true) {
    const current = logs.slice(cursor)
    const failure = current.find(line => /Build Failed!|rebuild (?:processing )?failed/.test(line))
    assert.ok(!failure, `Unexpected build failure: ${failure}`)
    if (current.some(line => line.includes(completion))) return
    assert.ok(performance.now() < deadline, `Timed out waiting for ${completion}:\n${current.join('\n')}`)
    await delay(25)
  }
}
