import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createSubscribedData,
  extractDataDependencies,
  resolveDataDependencies,
  WatchDependencyTracker,
} from './watch-dependencies.js'

describe('declarative watch dependencies', () => {
  test('extracts reserved dependency metadata without mutating content vars', () => {
    const source = {
      layout: 'root',
      title: 'Archive',
      dataDependencies: ['recentPosts', 'navigation', 'recentPosts'],
    }
    const result = extractDataDependencies(source, 'Page')

    assert.deepEqual(result.dataDependencies, ['navigation', 'recentPosts'])
    assert.deepEqual(result.vars, { layout: 'root', title: 'Archive' })
    assert.deepEqual(source.dataDependencies, ['recentPosts', 'navigation', 'recentPosts'])
  })

  test('rejects invalid dependency declarations', () => {
    assert.throws(
      () => resolveDataDependencies('recentPosts', 'Page'),
      /Page dataDependencies must be an array of strings/
    )
    assert.throws(
      () => resolveDataDependencies(['recentPosts', ''], 'Layout'),
      /Layout dataDependencies must contain non-empty strings/
    )
  })

  test('exposes only subscribed global-data keys', () => {
    const data = createSubscribedData(
      { recentPosts: ['Alpha'], navigation: ['Home'] },
      ['recentPosts'],
      'Page "archive/page.md"'
    )

    assert.deepEqual(data['recentPosts'], ['Alpha'])
    assert.deepEqual(Object.keys(data), ['recentPosts'])
    assert.throws(
      () => data['navigation'],
      /accessed undeclared global data key "navigation"/
    )
  })

  test('rejects subscriptions to missing global-data keys', () => {
    assert.throws(
      () => createSubscribedData({}, ['recentPosts'], 'Page'),
      /subscribes to missing global data key "recentPosts"/
    )
  })

  test('invalidates only consumers subscribed to changed keys', () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    initial.registerConsumer('page', '/site/index.md', ['recentPosts'])
    initial.registerConsumer('template', '/site/feed.template.js', ['feedItems'])
    initial.updateGlobalDataFingerprints(
      { recentPosts: ['Alpha'], feedItems: ['Alpha'], siteName: 'Example' },
      null
    )

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedKeys = next.updateGlobalDataFingerprints(
      { recentPosts: ['Alpha', 'Beta'], feedItems: ['Alpha'], siteName: 'Example' },
      initial.state.globalDataFingerprints
    )
    const invalidated = next.getInvalidatedConsumers(initial.state, changedKeys)

    assert.deepEqual(Array.from(changedKeys), ['recentPosts'])
    assert.deepEqual(invalidated.map(consumer => consumer.key), ['/site/index.md'])
  })

  test('detects added and removed top-level global-data keys', () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    initial.updateGlobalDataFingerprints({ oldKey: 1 }, null)

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedKeys = next.updateGlobalDataFingerprints(
      { newKey: 1 },
      initial.state.globalDataFingerprints
    )

    assert.deepEqual(Array.from(changedKeys).sort(), ['newKey', 'oldKey'])
  })

  test('conservatively invalidates values JSON serialization would lose', () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    initial.updateGlobalDataFingerprints({ opaque: { format: () => 'first' } }, null)

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedKeys = next.updateGlobalDataFingerprints(
      { opaque: { format: () => 'first' } },
      initial.state.globalDataFingerprints
    )

    assert.deepEqual(Array.from(changedKeys), ['opaque'])
  })

  test('prunes subscriptions for removed generated pages', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.registerConsumer(
      'page',
      'archive/removed/index.html',
      ['recentPosts'],
      { ownerPath: '/site/archive.pages.js' }
    )

    tracker.pruneGeneratedPages(new Set())

    assert.equal(tracker.state.consumers['page\0archive/removed/index.html'], undefined)
  })
})
