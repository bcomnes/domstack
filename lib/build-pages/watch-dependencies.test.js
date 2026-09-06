import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { WatchDependencyTracker } from './watch-dependencies.js'

const pageInfo = {
  pageFile: {
    filepath: '/site/page.md',
  },
}

describe('WatchDependencyTracker', () => {
  test('attributes concurrent reads to the correct async consumer', async () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    const alphaVars = tracker.trackPageVars(
      /** @type {any} */ (pageInfo),
      { title: 'Alpha' },
      {},
      null,
      null
    )
    const betaVars = tracker.trackPageVars(
      /** @type {any} */ ({ pageFile: { filepath: '/site/beta.md' } }),
      { title: 'Beta' },
      {},
      null,
      null
    )

    await Promise.all([
      tracker.runWithConsumer('template', 'alpha', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return alphaVars.title
      }),
      tracker.runWithConsumer('template', 'beta', async () => betaVars.title),
    ])

    const consumers = Object.fromEntries(
      Object.values(tracker.state.consumers).map(consumer => [consumer.key, consumer])
    )
    assert.deepEqual(consumers['alpha']?.pages, { '/site/page.md': ['vars.title'] })
    assert.deepEqual(consumers['beta']?.pages, { '/site/beta.md': ['vars.title'] })
  })

  test('invalidates only consumers of changed page properties', async () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    const vars = initial.trackPageVars(
      /** @type {any} */ (pageInfo),
      { title: 'Alpha', category: 'news' },
      {},
      null,
      null
    )
    await initial.runWithConsumer('template', 'title-index', async () => vars.title)
    await initial.runWithConsumer('template', 'category-index', async () => vars.category)

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedProperties = next.getChangedPageProperties(
      initial.state,
      new Map([
        ['/site/page.md', /** @type {any} */ ({ vars: { title: 'Beta', category: 'news' } })],
      ])
    )
    const invalidated = next.getInvalidatedConsumers(initial.state, changedProperties, new Set())

    assert.deepEqual(invalidated.map(consumer => consumer.key), ['title-index'])
  })

  test('invalidates only consumers of changed global-data keys', async () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    const vars = initial.trackGlobalDataVars({ archive: ['Alpha'], siteName: 'Example' })
    await initial.runWithConsumer('page', '/site/index.md', async () => vars.archive)
    initial.updateGlobalDataFingerprints(
      { archive: ['Alpha'], siteName: 'Example' },
      null
    )

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedKeys = next.updateGlobalDataFingerprints(
      { archive: ['Alpha', 'Beta'], siteName: 'Example' },
      initial.state.globalDataFingerprints
    )
    const invalidated = next.getInvalidatedConsumers(initial.state, new Map(), changedKeys)

    assert.deepEqual(Array.from(changedKeys), ['archive'])
    assert.deepEqual(invalidated.map(consumer => consumer.key), ['/site/index.md'])
  })

  test('invalidates consumers when page collection membership changes', async () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    const alpha = /** @type {any} */ ({
      pageInfo: {
        pageFile: { filepath: '/site/alpha.md' },
        outputRelname: 'alpha/index.html',
      },
    })
    const pages = initial.trackPageCollection([alpha], 'all-pages')
    initial.updatePageCollectionFingerprint('all-pages', [alpha], null)
    await initial.runWithConsumer('template', 'index', async () => pages.map(page => page.pageInfo.outputRelname))

    const beta = /** @type {any} */ ({
      pageInfo: {
        pageFile: { filepath: '/site/beta.md' },
        outputRelname: 'beta/index.html',
      },
    })
    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const collectionChanged = next.updatePageCollectionFingerprint(
      'all-pages',
      [alpha, beta],
      initial.state.pageCollectionFingerprints
    )
    const invalidated = next.getInvalidatedConsumers(
      initial.state,
      new Map(),
      new Set(),
      collectionChanged ? new Set(['all-pages']) : new Set()
    )

    assert.equal(collectionChanged, true)
    assert.deepEqual(invalidated.map(consumer => consumer.key), ['index'])
  })

  test('tracks page variable existence checks', async () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    const vars = initial.trackPageVars(
      /** @type {any} */ (pageInfo),
      {},
      {},
      null,
      null
    )
    await initial.runWithConsumer('template', 'conditional', async () => 'featured' in vars)

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedProperties = next.getChangedPageProperties(
      initial.state,
      new Map([
        ['/site/page.md', /** @type {any} */ ({ vars: { featured: true } })],
      ])
    )
    const invalidated = next.getInvalidatedConsumers(initial.state, changedProperties, new Set())

    assert.deepEqual(invalidated.map(consumer => consumer.key), ['conditional'])
  })

  test('tracks missing and enumerated global-data keys', async () => {
    const initial = new WatchDependencyTracker(null, { fullBuild: true })
    const vars = initial.trackGlobalDataVars(/** @type {Record<string, any>} */ ({}))
    await initial.runWithConsumer('template', 'archive', async () => {
      Object.keys(vars)
      return vars['archive']
    })
    initial.updateGlobalDataFingerprints({}, null)

    const next = new WatchDependencyTracker(initial.state, { fullBuild: false })
    const changedKeys = next.updateGlobalDataFingerprints(
      { archive: ['Alpha'] },
      initial.state.globalDataFingerprints
    )
    const invalidated = next.getInvalidatedConsumers(initial.state, new Map(), changedKeys)

    assert.deepEqual(Array.from(changedKeys), ['archive'])
    assert.deepEqual(invalidated.map(consumer => consumer.key), ['archive'])
  })
})
