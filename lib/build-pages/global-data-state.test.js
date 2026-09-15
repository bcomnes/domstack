/**
 * @import { TestContext } from 'node:test'
 * @import { BuildPagesFilterOptions } from './index.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGlobalDataState } from './global-data-state.js'
import { buildPages, buildPagesDirect } from './index.js'
import { PageData } from './page-data.js'
import { identifyPages } from '../identify-pages.js'
import { classifyWatchEvent } from '../watch-plan.js'
import { resolveGlobalData } from './resolve-vars.js'

/** @param {TestContext} t */
async function fixture (t) {
  const dir = await mkdtemp(join(tmpdir(), 'domstack-global-state-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const src = join(dir, 'src')
  const dest = join(dir, 'public')
  await mkdir(src)
  await writeFile(join(src, 'package.json'), '{"type":"module"}')
  await writeFile(join(src, 'root.layout.js'), 'export default ({ children }) => children')
  await writeFile(join(src, 'page.js'), `export const vars = { title: 'Home', dataDeps: ['summary'] }
    export default ({ data }) => JSON.stringify(data.summary)`)
  return { src, dest }
}

test('candidate and previousState are isolated, setState snapshots immediately and last call wins', () => {
  const state = { count: 1, map: new Map([['a', new Set([1])]]), date: new Date(0) }
  const previousGlobalDataBaseline = { state, sourceIds: [] }
  const transaction = createGlobalDataState({ pages: [], previousGlobalDataBaseline })
  const previous = /** @type {typeof state} */ (transaction.context.previousState)
  previous.count = 2
  previous.map.get('a')?.add(2)
  previous.date.setTime(100)
  assert.deepEqual(transaction.getBaseline().state, state)
  assert.notEqual(transaction.getBaseline().state, state)
  transaction.context.setState(previous)
  previous.count = 3
  assert.equal(Reflect.get(/** @type {object} */ (transaction.getBaseline().state), 'count'), 2)
  transaction.context.setState({ final: true })
  assert.deepEqual(transaction.getBaseline().state, { final: true })
  transaction.context.setState(undefined)
  assert.equal(transaction.getBaseline().state, undefined)
  assert.equal(state.count, 1)
  assert.deepEqual(state.map.get('a'), new Set([1]))
  assert.equal(state.date.getTime(), 0)
})

test('unchanged candidates retain the initial snapshot without rereading source getters', () => {
  let reads = 0
  const nested = { count: 1 }
  const state = { get nested () { reads++; return nested } }
  const previousGlobalDataBaseline = { state, sourceIds: [] }
  const transaction = createGlobalDataState({ pages: [], previousGlobalDataBaseline })
  nested.count = 99
  const previous = /** @type {{ nested: { count: number } }} */ (transaction.context.previousState)
  assert.equal(previous.nested.count, 1)
  previous.nested.count = 2
  const candidate = transaction.getBaseline().state
  assert.deepEqual(candidate, { nested: { count: 1 } })
  assert.equal(transaction.getBaseline().state, candidate)
  assert.equal(reads, 1)
})

test('membership reads each source ID once and skips paths without upsert candidates', async t => {
  const { src } = await fixture(t)
  await writeFile(join(src, 'other.md'), 'Other')
  const site = await identifyPages(src)
  let sourceIdReads = 0
  let filepathReads = 0
  const pages = site.pages.map(pageInfo => {
    const page = new PageData({
      pageInfo,
      globalVars: {},
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions: {},
    })
    const sourceId = page.sourceId
    const filepath = pageInfo.pageFile.filepath
    Object.defineProperty(page, 'sourceId', { get () { sourceIdReads++; return sourceId } })
    Object.defineProperty(pageInfo.pageFile, 'filepath', { get () { filepathReads++; return filepath } })
    return page
  })
  const previousGlobalDataBaseline = { state: undefined, sourceIds: ['page.js', 'removed.md', 'removed.md'] }
  const delta = createGlobalDataState({ pages, previousGlobalDataBaseline })
  assert.equal(sourceIdReads, pages.length)
  assert.equal(filepathReads, 0)
  assert.deepEqual(delta.context.changes, {
    kind: 'delta', upserted: [pages.find(page => page.pageInfo.pageFile.relname === 'other.md')], removed: ['removed.md'], events: [],
  })
  assert.deepEqual(delta.getBaseline().sourceIds, site.pages.map(page => page.pageFile.relname))

  sourceIdReads = 0
  const reset = createGlobalDataState({
    pages,
    previousGlobalDataBaseline,
    globalDataInputChanges: { resetReason: 'recovery', upsertedPaths: [], events: [] },
  })
  assert.equal(sourceIdReads, pages.length)
  assert.equal(filepathReads, 0)
  assert.deepEqual(reset.context.changes, { kind: 'reset', reason: 'recovery', events: [] })
})

test('state supports cycles and uncloneable updates fail actionably without replacing the candidate', () => {
  const transaction = createGlobalDataState({ pages: [] })
  const state = { self: /** @type {unknown} */ (null), value: 1n }
  state.self = state
  transaction.context.setState(state)
  const candidate = /** @type {typeof state} */ (transaction.getBaseline().state)
  assert.equal(candidate.self, candidate)
  assert.notEqual(candidate, state)
  for (const invalid of [() => {}, { renderer () {} }, new WeakMap(), Symbol('state')]) {
    assert.throws(() => transaction.context.setState(invalid), /global\.data setState\(next\).*structured-cloneable.*PageData/)
    assert.equal(transaction.getBaseline().state, candidate)
  }
})

/** @param {SharedArrayBuffer} buffer */
function sharedMemoryStates (buffer) {
  const cycle = { self: /** @type {unknown} */ (null), nested: new Set([new Map([['view', new DataView(buffer)]])]) }
  cycle.self = cycle
  return [
    buffer,
    { nested: [buffer] },
    new Uint8Array(buffer),
    { nested: new DataView(buffer) },
    new Map([[buffer, 'key']]),
    new Map([['value', buffer]]),
    new Set([buffer]),
    cycle,
    new Error('nested cause', { cause: { buffer } }),
  ]
}

test('setState rejects nested shared memory without replacing or sharing the retained candidate', () => {
  const buffer = new SharedArrayBuffer(8)
  const bytes = new Uint8Array(buffer)
  bytes[0] = 1
  const transaction = createGlobalDataState({ pages: [] })
  transaction.context.setState({ bytes: Uint8Array.from(bytes) })
  const candidate = /** @type {{ bytes: Uint8Array }} */ (transaction.getBaseline().state)
  for (const state of sharedMemoryStates(buffer)) {
    assert.throws(() => transaction.context.setState(state), /global\.data setState\(next\).*SharedArrayBuffer.*non-shared ArrayBuffer/)
    assert.equal(transaction.getBaseline().state, candidate)
  }
  bytes[0] = 99
  assert.equal(candidate.bytes[0], 1, 'mutating rejected shared memory cannot mutate retained state')
})

test('previous baselines containing shared memory are rejected instead of exposing aliased state', () => {
  const buffer = new SharedArrayBuffer(8)
  for (const state of sharedMemoryStates(buffer)) {
    const previousGlobalDataBaseline = { state, sourceIds: [] }
    assert.throws(() => createGlobalDataState({ pages: [], previousGlobalDataBaseline }), /global\.data previous state.*SharedArrayBuffer.*non-shared ArrayBuffer/)
    assert.equal(previousGlobalDataBaseline.state, state)
  }
  const reset = createGlobalDataState({
    pages: [],
    previousGlobalDataBaseline: { state: buffer, sourceIds: [] },
    globalDataInputChanges: { resetReason: 'recovery', upsertedPaths: [], events: [] },
  })
  assert.equal(reset.context.previousState, undefined)
  assert.equal(reset.getBaseline().state, undefined)
})

test('shared-memory validation inspects only cloned values and does not reread source getters', () => {
  const transaction = createGlobalDataState({ pages: [] })
  let reads = 0
  const safe = { get value () { reads++; return new Uint8Array([1]) } }
  transaction.context.setState({ first: safe, second: safe })
  assert.equal(reads, 1)
  const unsafe = { get value () { reads++; return new SharedArrayBuffer(8) } }
  assert.throws(() => transaction.context.setState(unsafe), /SharedArrayBuffer/)
  assert.equal(reads, 2)
  assert.throws(() => createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state: unsafe, sourceIds: [] } }), /SharedArrayBuffer/)
  assert.equal(reads, 3)
  createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state: safe, sourceIds: [] } })
  assert.equal(reads, 4, 'isolating both previousState and the candidate only reads the source getter once')

  class PrivateState {
    #buffer = new SharedArrayBuffer(8)
    value = 1
    read () { return this.#buffer }
  }
  transaction.context.setState(new PrivateState())
  assert.deepEqual(transaction.getBaseline().state, { value: 1 }, 'private fields discarded by structuredClone are not retained state')
})

test('non-shared buffers and views remain isolated across previousState and setState', () => {
  const bytes = new Uint8Array([1, 2])
  const state = { bytes, view: new DataView(bytes.buffer) }
  const transaction = createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state, sourceIds: [] } })
  const previous = /** @type {typeof state} */ (transaction.context.previousState)
  previous.view.setUint8(0, 3)
  assert.equal(previous.bytes[0], 3)
  assert.equal(bytes[0], 1)
  assert.equal(/** @type {typeof state} */ (transaction.getBaseline().state).bytes[0], 1)
  transaction.context.setState(previous)
  previous.bytes[0] = 4
  assert.equal(/** @type {typeof state} */ (transaction.getBaseline().state).view.getUint8(0), 3)
})

test('resets discard state even without setState and do not try to clone invalid old state', () => {
  for (const previousGlobalDataBaseline of [undefined, null, { state: () => {}, sourceIds: ['old.md'] }]) {
    const transaction = createGlobalDataState({
      pages: [],
      previousGlobalDataBaseline,
      globalDataInputChanges: { resetReason: 'global-data-changed', upsertedPaths: [], events: [] },
    })
    assert.equal(transaction.context.previousState, undefined)
    assert.deepEqual(transaction.context.changes, { kind: 'reset', reason: 'global-data-changed', events: [] })
    assert.deepEqual(transaction.getBaseline(), { state: undefined, sourceIds: [] })
  }
  const initial = createGlobalDataState({ pages: [] })
  assert.deepEqual(initial.context.changes, { kind: 'reset', reason: 'initial', events: [] })
  const delta = createGlobalDataState({ pages: [], previousGlobalDataBaseline: initial.getBaseline() })
  assert.deepEqual(delta.context.changes, { kind: 'delta', upserted: [], removed: [], events: [] })
})

test('direct builds reuse page metadata when its filepath is already normalized', async t => {
  const { src, dest } = await fixture(t)
  const globalDataPath = join(src, 'global.data.js')
  await writeFile(globalDataPath, `export let pageInfo
    export default ({ pages }) => { pageInfo = pages[0].pageInfo; return { summary: '' } }`)
  const site = await identifyPages(src)
  const result = await buildPagesDirect(src, dest, site)
  assert.deepEqual(result.errors, [])
  const globalDataModule = await import(globalDataPath)
  assert.equal(globalDataModule.pageInfo, site.pages[0])
})

for (const [mode, build] of /** @type {const} */ ([['direct', buildPagesDirect], ['worker', buildPages]])) {
  test(`${mode}: reset and delta use eligible source membership, not output filters or generated pages`, async t => {
    const { src, dest } = await fixture(t)
    await writeFile(join(src, 'other.md'), '---\ntitle: Other\n---\nOther')
    await writeFile(join(src, 'hidden.draft.md'), 'Draft')
    await writeFile(join(src, 'archive.pages.js'), 'export default () => ({ children: \'Generated\' })')
    await writeFile(join(src, 'global.data.js'), `export default ({ pages, previousState, changes, setState }) => {
      const summary = {
        pages: pages.map(page => ({ sourceId: page.sourceId, title: page.vars.title })),
        previousState,
        changes: changes.kind === 'reset' ? changes : {
          ...changes, upserted: changes.upserted.map(page => page.sourceId),
        },
      }
      const next = { count: (previousState?.count ?? 0) + 1 }
      setState(next)
      next.count = 999
      return { summary }
    }`)
    const site = await identifyPages(src)
    const home = site.pages.find(page => page.pageFile.basename === 'page.js')
    assert.ok(home)
    home.pageFile.filepath = src + '/./page.js'
    const initial = await build(src, dest, site, { trackWatchDependencies: true })
    assert.equal(home.pageFile.filepath, src + '/./page.js', 'normalizing public identities does not mutate discovery metadata')
    assert.deepEqual(initial.errors, [])
    const first = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
    assert.equal(first.changes.kind, 'reset')
    assert.equal(first.changes.reason, 'initial')
    assert.equal(first.previousState, undefined)
    assert.deepEqual(first.pages.map((/** @type {{sourceId: string}} */ p) => p.sourceId).sort(), ['other.md', 'page.js'])
    assert.equal(first.pages.find((/** @type {{title: string}} */ p) => p.title === 'Home').title, 'Home')
    assert.deepEqual(initial.report.globalDataBaseline, { state: { count: 1 }, sourceIds: site.pages.map(page => page.pageFile.relname) })
    assert.ok(initial.report.pages.some(page => page.pagesFilePath === join(src, 'archive.pages.js')))

    await rm(join(src, 'other.md'))
    await writeFile(join(src, 'new.md'), 'New')
    const current = await identifyPages(src, { buildDrafts: true })
    const event = classifyWatchEvent('change', join(src, 'page.js'))
    /** @type {BuildPagesFilterOptions} */
    const opts = {
      trackWatchDependencies: true,
      previousWatchDependencies: initial.report.watchDependencies,
      previousGlobalDataBaseline: initial.report.globalDataBaseline,
      pageFilterPaths: [],
      templateFilterPaths: [],
      pagesFileFilterPaths: [],
      globalDataInputChanges: {
        upsertedPaths: [src + '/./page.js', join(src, 'page.js'), join(src, 'other.md'), join(src, 'archive.pages.js')],
        events: [event],
      },
    }
    const before = structuredClone(opts)
    const next = await build(src, dest, current, opts)
    assert.deepEqual(next.errors, [])
    assert.deepEqual(structuredClone(opts), before, 'worker and direct builds leave caller baselines and input changes untouched')
    const second = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
    assert.deepEqual(second.previousState, { count: 1 })
    assert.equal(second.changes.kind, 'delta')
    assert.deepEqual(second.changes.upserted.sort(), ['hidden.draft.md', 'new.md', 'page.js'])
    assert.deepEqual(second.changes.removed, ['other.md'])
    assert.deepEqual(second.changes.events, [event])
    assert.deepEqual(next.report.globalDataBaseline?.state, { count: 2 })
    assert.deepEqual(next.report.pages.map(page => page.sourcePageFilePath), [join(src, 'page.js')], 'changed public data still invalidates its subscriber')

    const reset = await build(src, dest, current, {
      ...opts,
      previousGlobalDataBaseline: next.report.globalDataBaseline,
      globalDataInputChanges: { resetReason: 'global-data-changed', upsertedPaths: [], events: [event] },
    })
    assert.deepEqual(reset.errors, [])
    const third = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
    assert.equal(third.previousState, undefined)
    assert.deepEqual(third.changes, { kind: 'reset', reason: 'global-data-changed', events: [event] })
    assert.deepEqual(reset.report.globalDataBaseline?.state, { count: 1 })
  })

  test(`${mode}: relocating the source root preserves membership while candidates still match absolute paths`, async t => {
    const original = await fixture(t)
    const relocated = await fixture(t)
    for (const { src } of [original, relocated]) {
      await mkdir(join(src, 'posts'))
      await writeFile(join(src, 'posts', 'post.md'), 'Post')
      await writeFile(join(src, 'global.data.js'), `export default ({ previousState, changes, setState }) => {
        setState({ retained: true })
        return { summary: {
          previousState,
          changes: changes.kind === 'reset' ? changes : {
            ...changes, upserted: changes.upserted.map(page => page.sourceId),
          },
        } }
      }`)
    }
    const initial = await build(original.src, original.dest, await identifyPages(original.src), { trackWatchDependencies: true })
    assert.deepEqual(initial.errors, [])
    const previousGlobalDataBaseline = structuredClone(initial.report.globalDataBaseline)
    const site = await identifyPages(relocated.src)
    const oldPath = join(original.src, 'posts', 'post.md')
    const oldEvent = classifyWatchEvent('change', oldPath)
    const next = await build(relocated.src, relocated.dest, site, {
      trackWatchDependencies: true,
      previousGlobalDataBaseline,
      globalDataInputChanges: { upsertedPaths: [oldPath], events: [oldEvent] },
    })
    assert.deepEqual(next.errors, [])
    const summary = JSON.parse(await readFile(join(relocated.dest, 'index.html'), 'utf8'))
    assert.deepEqual(summary.previousState, { retained: true })
    assert.deepEqual(summary.changes, { kind: 'delta', upserted: [], removed: [], events: JSON.parse(JSON.stringify([oldEvent])) })
    assert.equal(summary.changes.events[0].filepath, oldPath)
    assert.deepEqual(next.report.globalDataBaseline, previousGlobalDataBaseline)

    const event = classifyWatchEvent('change', relocated.src + '/posts/./post.md')
    const updated = await build(relocated.src, relocated.dest, site, {
      trackWatchDependencies: true,
      previousGlobalDataBaseline: next.report.globalDataBaseline,
      globalDataInputChanges: { upsertedPaths: [relocated.src + '/posts/./post.md'], events: [event] },
    })
    assert.deepEqual(updated.errors, [])
    const updateSummary = JSON.parse(await readFile(join(relocated.dest, 'index.html'), 'utf8'))
    assert.deepEqual(updateSummary.changes, { kind: 'delta', upserted: ['posts/post.md'], removed: [], events: JSON.parse(JSON.stringify([event])) })
    assert.equal(updateSummary.changes.events[0].filepath, join(relocated.src, 'posts', 'post.md'))
  })

  test(`${mode}: relative source IDs distinguish duplicate basenames and removed IDs delete map entries`, async t => {
    const { src, dest } = await fixture(t)
    for (const directory of ['a', 'b', 'c']) await mkdir(join(src, directory))
    await writeFile(join(src, 'a', 'post.md'), '---\ntitle: Alpha\n---\nAlpha')
    await writeFile(join(src, 'b', 'post.md'), '---\ntitle: Beta\n---\nBeta')
    await writeFile(join(src, 'global.data.js'), `export default ({ pages, previousState, changes, setState }) => {
      const titles = changes.kind === 'reset' ? new Map() : previousState.titles
      const upserted = changes.kind === 'reset' ? pages : changes.upserted
      const removed = changes.kind === 'reset' ? [] : changes.removed
      for (const sourceId of removed) titles.delete(sourceId)
      for (const page of upserted) titles.set(page.sourceId, page.vars.title)
      setState({ titles })
      return { summary: {
        titles: [...titles].sort(),
        upserted: upserted.map(page => page.sourceId).sort(),
        removed,
        events: changes.events,
      } }
    }`)
    const initial = await build(src, dest, await identifyPages(src), { trackWatchDependencies: true })
    assert.deepEqual(initial.errors, [])
    const before = structuredClone(initial.report.globalDataBaseline)
    const first = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
    assert.deepEqual(first.titles, [['a/post.md', 'Alpha'], ['b/post.md', 'Beta'], ['page.js', 'Home']])
    assert.deepEqual(initial.report.globalDataBaseline?.sourceIds.slice().sort(), ['a/post.md', 'b/post.md', 'page.js'])

    await rm(join(src, 'a', 'post.md'))
    await writeFile(join(src, 'c', 'post.md'), '---\ntitle: Gamma\n---\nGamma')
    const events = [
      classifyWatchEvent('removed', src + '/a/./post.md'),
      classifyWatchEvent('added', src + '/c/./post.md'),
    ]
    const next = await build(src, dest, await identifyPages(src), {
      trackWatchDependencies: true,
      previousGlobalDataBaseline: initial.report.globalDataBaseline,
      globalDataInputChanges: { upsertedPaths: [], events },
    })
    assert.deepEqual(next.errors, [])
    const second = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
    assert.deepEqual(second.upserted, ['c/post.md'], 'new membership is upserted without an absolute candidate')
    assert.deepEqual(second.removed, ['a/post.md'])
    assert.deepEqual(second.titles, [['b/post.md', 'Beta'], ['c/post.md', 'Gamma'], ['page.js', 'Home']])
    assert.deepEqual(second.events, JSON.parse(JSON.stringify(events)))
    assert.deepEqual(second.events.map((/** @type {{filepath: string}} */ event) => event.filepath), [join(src, 'a', 'post.md'), join(src, 'c', 'post.md')])
    assert.deepEqual(next.report.globalDataBaseline?.state, { titles: new Map(second.titles) })
    assert.deepEqual(next.report.globalDataBaseline?.sourceIds.slice().sort(), ['b/post.md', 'c/post.md', 'page.js'])
    assert.deepEqual(initial.report.globalDataBaseline, before, 'deleting from previousState does not mutate the committed baseline')
  })

  test(`${mode}: state does not leak into public data fingerprints or commit previousState mutations`, async t => {
    const { src, dest } = await fixture(t)
    await writeFile(join(src, 'global.data.js'), `export default ({ previousState, setState, changes }) => {
      if (!previousState) setState({ count: 1 })
      else {
        previousState.count++
        if (changes.events.length) setState(previousState)
      }
      return { summary: 'stable' }
    }`)
    const site = await identifyPages(src)
    const initial = await build(src, dest, site, { trackWatchDependencies: true })
    assert.deepEqual(initial.errors, [])
    const next = await build(src, dest, site, {
      trackWatchDependencies: true,
      previousGlobalDataBaseline: initial.report.globalDataBaseline,
      previousWatchDependencies: initial.report.watchDependencies,
      pageFilterPaths: [],
      templateFilterPaths: [],
      pagesFileFilterPaths: [],
    })
    assert.deepEqual(next.errors, [])
    assert.deepEqual(next.report.globalDataBaseline?.state, { count: 1 })
    assert.deepEqual(initial.report.globalDataBaseline?.state, { count: 1 })
    assert.deepEqual(next.report.pages, [])
    assert.deepEqual(next.report.watchDependencies?.globalDataFingerprints, initial.report.watchDependencies?.globalDataFingerprints)
    assert.deepEqual(Object.keys(next.report.watchDependencies?.globalDataFingerprints ?? {}), ['summary'])
    const stateOnly = await build(src, dest, site, {
      trackWatchDependencies: true,
      previousGlobalDataBaseline: next.report.globalDataBaseline,
      previousWatchDependencies: next.report.watchDependencies,
      pageFilterPaths: [],
      templateFilterPaths: [],
      pagesFileFilterPaths: [],
      globalDataInputChanges: { upsertedPaths: [], events: [classifyWatchEvent('change', join(src, 'global.data.js'))] },
    })
    assert.deepEqual(stateOnly.errors, [])
    assert.deepEqual(stateOnly.report.globalDataBaseline?.state, { count: 2 })
    assert.deepEqual(stateOnly.report.pages, [])
    assert.deepEqual(stateOnly.report.watchDependencies?.globalDataFingerprints, next.report.watchDependencies?.globalDataFingerprints)
  })

  test(`${mode}: resets never read or transfer the discarded baseline`, async t => {
    const { src, dest } = await fixture(t)
    await writeFile(join(src, 'global.data.js'), `export default ({ previousState, changes }) => {
      if (previousState !== undefined) throw new Error('reset exposed old state')
      return { summary: changes }
    }`)
    const site = await identifyPages(src)
    const previousGlobalDataBaseline = {
      /** @returns {never} */
      get state () { throw new Error('discarded state must not be read or cloned') },
      /** @returns {never} */
      get sourceIds () { throw new Error('discarded membership must not be read or cloned') },
    }
    const result = await build(src, dest, site, {
      trackWatchDependencies: true,
      previousGlobalDataBaseline,
      globalDataInputChanges: { resetReason: 'recovery', upsertedPaths: [], events: [] },
    })
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.report.globalDataBaseline, { state: undefined, sourceIds: ['page.js'] })
    assert.deepEqual(JSON.parse(await readFile(join(dest, 'index.html'), 'utf8')), { kind: 'reset', reason: 'recovery', events: [] })
  })

  test(`${mode}: successful watch builds emit candidates while cold reports keep state private`, async t => {
    const { src, dest } = await fixture(t)
    await writeFile(join(src, 'global.data.js'), 'export default ({ setState }) => { setState({ candidate: true }); return { summary: \'\' } }')
    const site = await identifyPages(src)
    const cold = await build(src, dest, site, {})
    assert.deepEqual(cold.errors, [])
    assert.equal(Object.hasOwn(cold.report, 'globalDataBaseline'), false)
    const watch = await build(src, dest, site, { trackWatchDependencies: true })
    assert.deepEqual(watch.errors, [])
    assert.deepEqual(watch.report.globalDataBaseline, { state: { candidate: true }, sourceIds: ['page.js'] })
  })

  test(`${mode}: failed page, template, factory, and initialization phases never emit candidate baselines`, async t => {
    for (const [filename, content] of [
      ['page.js', 'export default () => { throw new Error(\'render failed\') }'],
      ['feed.template.js', 'export default () => { throw new Error(\'template failed\') }'],
      ['archive.pages.js', 'export default () => { throw new Error(\'factory failed\') }'],
      ['page.vars.js', 'export default () => { throw new Error(\'vars failed\') }'],
    ]) {
      const { src, dest } = await fixture(t)
      assert.ok(filename && content)
      await writeFile(join(src, filename), content)
      await writeFile(join(src, 'global.data.js'), 'export default ({ setState }) => { setState({ candidate: true }); return { summary: \'\' } }')
      const previousGlobalDataBaseline = { state: { previous: true }, sourceIds: [] }
      const result = await build(src, dest, await identifyPages(src), { previousGlobalDataBaseline, trackWatchDependencies: true })
      assert.ok(result.errors.length > 0, filename)
      assert.equal(Object.hasOwn(result.report, 'globalDataBaseline'), false, filename)
      assert.deepEqual(previousGlobalDataBaseline, { state: { previous: true }, sourceIds: [] })
    }
  })

  test(`${mode}: shared-memory updates and previous baselines fail without emitting candidates`, async t => {
    for (const previous of [false, true]) {
      const { src, dest } = await fixture(t)
      await writeFile(join(src, 'global.data.js'), previous
        ? 'export default () => { throw new Error(\'shared baseline must be rejected before callback\') }'
        : 'export default ({ setState }) => { setState({ nested: new Map([[\'bytes\', new DataView(new SharedArrayBuffer(8))]]) }); return { summary: \'\' } }')
      const site = await identifyPages(src)
      /** @type {BuildPagesFilterOptions} */
      const opts = {
        trackWatchDependencies: true,
        previousGlobalDataBaseline: previous ? { state: new Set([new Uint8Array(new SharedArrayBuffer(8))]), sourceIds: [] } : undefined,
      }
      const message = previous ? /global\.data previous state.*SharedArrayBuffer/ : /global\.data setState\(next\).*SharedArrayBuffer/
      if (mode === 'direct') {
        await assert.rejects(build(src, dest, site, opts), message)
      } else {
        const result = await build(src, dest, site, opts)
        assert.equal(result.errors.length, 1)
        const failure = result.errors[0]
        assert.ok(failure instanceof Error)
        assert.match(failure.message, message)
        assert.equal(Object.hasOwn(result.report, 'globalDataBaseline'), false)
      }
    }
  })

  test(`${mode}: uncloneable setState and global-data failures are actionable without candidates`, async t => {
    for (const body of [
      'setState({ renderer () {} })',
      'setState({ candidate: true }); throw new Error(\'global data failed\')',
    ]) {
      const { src, dest } = await fixture(t)
      await writeFile(join(src, 'global.data.js'), `export default ({ setState }) => { ${body}; return { summary: '' } }`)
      const site = await identifyPages(src)
      if (mode === 'direct') {
        await assert.rejects(build(src, dest, site, { trackWatchDependencies: true }), /global\.data setState\(next\).*structured-cloneable|global data failed/)
      } else {
        const result = await build(src, dest, site, { trackWatchDependencies: true })
        assert.equal(result.errors.length, 1)
        const failure = result.errors[0]
        assert.ok(failure instanceof Error)
        assert.match(failure.message, /global\.data setState\(next\).*structured-cloneable|global data failed/)
        assert.equal(Object.hasOwn(result.report, 'globalDataBaseline'), false)
      }
    }
  })
}

test('resolveGlobalData retains object and non-serializable public return values unchanged', async t => {
  const { src } = await fixture(t)
  const globalDataPath = join(src, 'global.data.js')
  await writeFile(globalDataPath, 'export default { render: () => \'public function\', value: 1 }')
  const imported = await import(globalDataPath)
  const { context } = createGlobalDataState({ pages: [] })
  const result = await resolveGlobalData({ globalDataPath, context })
  assert.equal(result, imported.default)
  assert.equal(Reflect.get(result, 'render')(), 'public function')
  assert.deepEqual(await resolveGlobalData({ context }), {})
})
