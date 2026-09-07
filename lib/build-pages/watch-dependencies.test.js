import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createSubscribedData,
  extractDataDeps,
  resolveDataDeps,
} from './data-deps.js'
import { WatchDependencyTracker } from './watch-dependencies.js'

describe('declarative watch dependencies', () => {
  test('extracts reserved dependency metadata without mutating content vars', () => {
    const source = {
      layout: 'root',
      title: 'Archive',
      dataDeps: ['recentPosts', 'navigation', 'recentPosts'],
    }
    const result = extractDataDeps(source, 'Page')

    assert.deepEqual(result.dataDeps, ['navigation', 'recentPosts'])
    assert.deepEqual(result.vars, { layout: 'root', title: 'Archive' })
    assert.deepEqual(source.dataDeps, ['recentPosts', 'navigation', 'recentPosts'])
  })

  test('rejects invalid dependency declarations', () => {
    assert.throws(
      () => resolveDataDeps('recentPosts', 'Page'),
      /Page dataDeps must be an array of strings/
    )
    assert.throws(
      () => resolveDataDeps(['recentPosts', ''], 'Layout'),
      /Layout dataDeps must contain non-empty strings/
    )
  })

  test('exposes only subscribed global-data keys', () => {
    const recentPosts = ['Alpha']
    const data = createSubscribedData(
      { recentPosts, navigation: ['Home'] },
      ['recentPosts'],
      'Page "archive/page.md"'
    )

    assert.equal(data['recentPosts'], recentPosts, 'projection retains the subscribed value rather than cloning it')
    assert.ok(Object.isFrozen(data))
    assert.throws(() => { data['recentPosts'] = [] }, TypeError)
    assert.equal('recentPosts' in data, true)
    assert.throws(() => 'navigation' in data, /checked undeclared global data key "navigation"/)
    assert.equal(data['unrelatedMissingKey'], undefined)
    assert.equal('unrelatedMissingKey' in data, false)
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

  test('prunes only rebuilt owners while preserving unrelated consumers', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.registerConsumer('page', 'removed.html', ['posts'], { ownerPath: '/site/a.pages.js' })
    tracker.registerConsumer('page', 'retained.html', ['posts'], { ownerPath: '/site/a.pages.js' })
    tracker.registerConsumer('page', 'other.html', ['posts'], { ownerPath: '/site/b.pages.js' })
    tracker.registerConsumer('page', '/site/page.md', ['posts'])
    tracker.registerConsumer('pages-file', '/site/a.pages.js', ['posts'])
    tracker.registerConsumer('template', '/site/feed.template.js', ['posts'])
    const before = structuredClone(tracker.state.consumers)

    tracker.pruneGeneratedPages(new Set(['retained.html']), new Set(['/site/a.pages.js']))

    delete before['page\0removed.html']
    assert.deepEqual(tracker.state.consumers, before)
  })

  test('incremental registration does not mutate or replace the previous invalidation snapshot', () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    initial.registerConsumer('page', '/site/page.md', ['oldKey'])
    initial.updateGlobalDataFingerprints({ oldKey: 1 }, null)
    const before = structuredClone(initial.state)
    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    next.registerConsumer('page', '/site/page.md', ['newKey'])
    next.updateGlobalDataFingerprints({ newKey: 2 }, initial.state.globalDataFingerprints)

    assert.deepEqual(structuredClone(initial.state), before)
    assert.deepEqual(next.getInvalidatedConsumers(initial.state, new Set(['oldKey'])), Object.values(before.consumers))
    assert.deepEqual(next.getInvalidatedConsumers(initial.state, new Set(['newKey'])), [])
  })

  test('fingerprints special property names without mutating the snapshot prototype', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints({ ['__proto__']: 'first', constructor: 'stable' }, null)
    const previous = structuredClone(tracker.state.globalDataFingerprints)
    assert.equal(typeof Reflect.get(previous, '__proto__'), 'string')
    const changed = tracker.updateGlobalDataFingerprints({ ['__proto__']: 'second', constructor: 'stable' }, previous)
    assert.deepEqual([...changed], ['__proto__'])
  })

  test('treats lossy shapes as opaque without evaluating accessors', () => {
    let reads = 0
    const getter = { get value () { reads++; return 'unstable' } }
    const sparse = Object.assign(new Array(1), { extra: 'hidden from JSON' })
    const cycle = {}; Object.assign(cycle, { cycle })
    const values = [sparse, getter, -0, NaN, Infinity, undefined, new Date(), new Map(), new Set(), 1n, cycle]
    for (const value of values) {
      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      tracker.updateGlobalDataFingerprints({ value }, null)
      assert.equal(tracker.state.globalDataFingerprints['value'], null)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value }, tracker.state.globalDataFingerprints)], ['value'])
    }
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints(getter, null)
    assert.equal(tracker.state.globalDataFingerprints['value'], null)
    assert.equal(reads, 0)
  })

  test('compares ordinary JSON data by value, including nested arrays and reordered keys', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints({ value: [{ a: 1, b: [null, true, 'text'] }] }, null)
    const changed = tracker.updateGlobalDataFingerprints({ value: [{ b: [null, true, 'text'], a: 1 }] }, tracker.state.globalDataFingerprints)
    assert.equal(changed.size, 0)
  })
})
