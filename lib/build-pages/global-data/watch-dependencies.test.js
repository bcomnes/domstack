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

  test('reports changed keys in previous-key order followed by current-only key order', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints({ 10: 'old', removed: 1, stable: 1, changed: 1, opaque: undefined }, null)
    const changed = tracker.updateGlobalDataFingerprints(
      { 2: 'new', 10: 'new', added: 1, opaque: undefined, changed: 2, stable: 1 },
      tracker.state.globalDataFingerprints
    )

    assert.deepEqual([...changed], ['10', 'removed', 'changed', 'opaque', '2', 'added'])
  })

  test('enumerates only own enumerable fingerprint keys but still compares inherited and hidden values', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints({ value: 1 }, null)
    const hash = tracker.state.globalDataFingerprints['value']
    const previous = Object.assign(Object.create({ inheritedSame: hash, inheritedChanged: hash, inheritedOnly: hash }), {
      removed: hash,
    })
    Object.defineProperties(previous, {
      hiddenSame: { value: hash },
      hiddenChanged: { value: hash },
      hiddenOnly: { value: hash },
      propertyIsEnumerable: { value: null },
      [Symbol('previous')]: { value: hash, enumerable: true },
    })
    const data = Object.assign(Object.create({ inheritedOnly: 2 }), {
      inheritedSame: 1,
      inheritedChanged: 2,
      hiddenSame: 1,
      hiddenChanged: 2,
      added: 1,
    })
    Object.defineProperties(data, {
      hiddenOnly: { get () { assert.fail('must not read hidden global data') } },
      [Symbol('data')]: { get () { assert.fail('must not read symbol global data') }, enumerable: true },
    })

    assert.deepEqual([...tracker.updateGlobalDataFingerprints(data, previous)], ['removed', 'inheritedChanged', 'hiddenChanged', 'added'])
    assert.deepEqual(Object.keys(tracker.state.globalDataFingerprints), ['inheritedSame', 'inheritedChanged', 'hiddenSame', 'hiddenChanged', 'added'])
  })

  test('invalidates own enumerable consumers once each in enumeration order', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.registerConsumer('page', '/site/a.md', ['posts', 'navigation', 'posts'])
    tracker.registerConsumer('template', '/site/feed.template.js', ['navigation'])
    tracker.registerConsumer('pages-file', '/site/archive.pages.js', ['posts'])
    tracker.registerConsumer('page', '/site/unrelated.md', ['other'])
    const registered = Object.values(tracker.state.consumers)
    assert.ok(registered[0])
    assert.ok(registered[1])
    assert.ok(registered[2])
    assert.ok(registered[3])
    const consumers = { z: registered[0], 10: registered[1], 2: registered[2], unrelated: registered[3] }
    Object.setPrototypeOf(consumers, {
      get inherited () { return assert.fail('must not read inherited consumers') },
    })
    Object.defineProperties(consumers, {
      hidden: { get () { assert.fail('must not read hidden consumers') } },
      [Symbol('consumer')]: { get () { assert.fail('must not read symbol consumers') }, enumerable: true },
    })
    tracker.state.consumers = consumers

    const invalidated = tracker.getInvalidatedConsumers(tracker.state, new Set(['posts', 'navigation']))
    assert.deepEqual(invalidated, [registered[2], registered[1], registered[0]])
    assert.equal(invalidated[0], registered[2], 'invalidation returns the original snapshot consumers')
  })

  test('empty invalidation and targeted owner scopes do not traverse consumers', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.state.consumers = new Proxy({}, {
      ownKeys () { assert.fail('must not enumerate consumers') },
      get () { assert.fail('must not read consumers') },
    })
    const generatedKeys = new Set()
    generatedKeys.has = () => assert.fail('must not inspect generated keys')

    assert.deepEqual(tracker.getInvalidatedConsumers(tracker.state, new Set()), [])
    tracker.pruneGeneratedPages(generatedKeys, new Set())
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
    tracker.registerConsumer('page', 'also-removed.html', ['posts'], { ownerPath: '/site/a.pages.js' })
    tracker.registerConsumer('page', 'retained.html', ['posts'], { ownerPath: '/site/a.pages.js' })
    tracker.registerConsumer('page', 'other.html', ['posts'], { ownerPath: '/site/b.pages.js' })
    tracker.registerConsumer('page', '/site/page.md', ['posts'])
    tracker.registerConsumer('pages-file', '/site/a.pages.js', ['posts'], { ownerPath: '/site/a.pages.js' })
    tracker.registerConsumer('template', '/site/feed.template.js', ['posts'], { ownerPath: '/site/a.pages.js' })
    const before = structuredClone(tracker.state.consumers)

    tracker.pruneGeneratedPages(new Set(['retained.html']), new Set(['/site/a.pages.js']))

    delete before['page\0removed.html']
    delete before['page\0also-removed.html']
    assert.deepEqual(tracker.state.consumers, before)
    assert.deepEqual(Object.keys(tracker.state.consumers), Object.keys(before))
  })

  test('full pruning visits own enumerable consumers in order without skipping adjacent removals', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.registerConsumer('page', 'removed.html', ['posts'], { ownerPath: '/site/a.pages.js' })
    tracker.registerConsumer('page', 'also-removed.html', ['posts'], { ownerPath: '/site/b.pages.js' })
    tracker.registerConsumer('page', 'retained.html', ['posts'], { ownerPath: '/site/a.pages.js' })
    const consumers = tracker.state.consumers
    const ids = Object.keys(consumers)
    Object.setPrototypeOf(consumers, {
      get inherited () { return assert.fail('must not read inherited consumers') },
    })
    Object.defineProperties(consumers, {
      hidden: { get () { assert.fail('must not read hidden consumers') } },
      [Symbol('consumer')]: { get () { assert.fail('must not read symbol consumers') }, enumerable: true },
    })
    /** @type {PropertyKey[]} */
    const deleted = []
    tracker.state.consumers = new Proxy(consumers, {
      deleteProperty (target, key) {
        deleted.push(key)
        return Reflect.deleteProperty(target, key)
      },
    })

    tracker.pruneGeneratedPages(new Set(['retained.html']))

    assert.deepEqual(deleted, ids.slice(0, 2))
    assert.deepEqual(Object.keys(consumers), ids.slice(2))
  })

  test('incremental state remains isolated from external nested mutations', () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    initial.registerConsumer('page', '/site/page.md', ['posts'])
    initial.updateGlobalDataFingerprints({ posts: ['Alpha'] }, null)
    const before = structuredClone(initial.state)
    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })

    const nextConsumer = next.state.consumers['page\0/site/page.md']
    const initialConsumer = initial.state.consumers['page\0/site/page.md']
    assert.ok(nextConsumer)
    assert.ok(initialConsumer)
    nextConsumer.globalDataKeys.push('navigation')
    nextConsumer.ownerPath = '/site/archive.pages.js'
    next.state.globalDataFingerprints['posts'] = null

    assert.deepEqual(structuredClone(initial.state), before)
    initialConsumer.globalDataKeys.push('other')
    assert.deepEqual(nextConsumer.globalDataKeys, ['posts', 'navigation'])
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
