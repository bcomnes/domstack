/**
 * @import { TestContext } from 'node:test'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGlobalDataState } from './global-data-state.js'
import { buildPages, buildPagesDirect } from './index.js'
import { identifyPages } from '../identify-pages.js'
import { classifyWatchEvent } from '../watch-plan.js'
import { resolveGlobalData } from './resolve-vars.js'

/** @param {TestContext} t @param {string} producer */
async function fixture (t, producer) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-global-state-'))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(src)
  await writeFile(join(src, 'package.json'), '{"type":"module"}')
  await writeFile(join(src, 'root.layout.js'), 'export default ({ children }) => children')
  await writeFile(join(src, 'page.js'), `export const vars = { title: 'Home', dataDeps: ['summary'] }
    export default ({ data }) => JSON.stringify(data.summary)`)
  await writeFile(join(src, 'global.data.js'), producer)
  return { src, dest }
}

test('previousState mutations require setState, which snapshots immediately and uses the last update', () => {
  const state = { titles: new Map([['page.md', 'Original']]) }
  const transaction = createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state, sourceIds: [] } })
  const previous = /** @type {typeof state} */ (transaction.context.previousState)
  previous.titles.set('page.md', 'Changed')
  assert.deepEqual(transaction.getBaseline().state, state)
  transaction.context.setState(previous)
  previous.titles.clear()
  assert.deepEqual(transaction.getBaseline().state, { titles: new Map([['page.md', 'Changed']]) })
  assert.deepEqual(state, { titles: new Map([['page.md', 'Original']]) })
  transaction.context.setState({ final: true })
  assert.deepEqual(transaction.getBaseline().state, { final: true })
  transaction.context.setState(undefined)
  assert.equal(transaction.getBaseline().state, undefined)
})

test('both retained and callback state are isolated from the caller, and source getters run once', () => {
  let reads = 0
  const nested = { count: 1 }
  const state = { get nested () { reads++; return nested } }
  const transaction = createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state, sourceIds: [] } })
  nested.count = 99
  const previous = /** @type {{ nested: { count: number } }} */ (transaction.context.previousState)
  assert.deepEqual(previous, { nested: { count: 1 } })
  previous.nested.count = 2
  assert.deepEqual(transaction.getBaseline().state, { nested: { count: 1 } })
  assert.equal(reads, 1)
})

test('cyclic state is supported and an uncloneable update leaves the last candidate intact', () => {
  const transaction = createGlobalDataState({ pages: [] })
  const state = { self: /** @type {unknown} */ (null) }
  state.self = state
  transaction.context.setState(state)
  const candidate = /** @type {typeof state} */ (transaction.getBaseline().state)
  assert.equal(candidate.self, candidate)
  assert.notEqual(candidate, state)
  assert.throws(() => transaction.context.setState({ render () {} }), /global\.data setState\(next\).*structured-cloneable/)
  assert.equal(transaction.getBaseline().state, candidate)
})

test('shared memory is rejected throughout nested state without replacing a valid candidate', () => {
  const buffer = new SharedArrayBuffer(8)
  const cycle = { self: /** @type {unknown} */ (null), buffer }
  cycle.self = cycle
  const states = [
    buffer,
    { nested: [buffer] },
    new Uint8Array(buffer),
    new DataView(buffer),
    new Map([[buffer, 'key']]),
    new Map([['value', buffer]]),
    new Set([buffer]),
    cycle,
    new Error('nested cause', { cause: buffer }),
  ]
  const transaction = createGlobalDataState({ pages: [] })
  transaction.context.setState({ bytes: new Uint8Array([1]) })
  const candidate = transaction.getBaseline().state
  for (const state of states) {
    assert.throws(() => transaction.context.setState(state), /SharedArrayBuffer/)
    assert.equal(transaction.getBaseline().state, candidate)
    assert.throws(() => createGlobalDataState({
      pages: [], previousGlobalDataBaseline: { state, sourceIds: [] },
    }), /global\.data previous state.*SharedArrayBuffer/)
  }
})

test('resets discard previous state and the first successful baseline permits a delta', () => {
  const initial = createGlobalDataState({ pages: [] })
  assert.deepEqual(initial.context.changes, { kind: 'reset', reason: 'initial', events: [] })
  const delta = createGlobalDataState({ pages: [], previousGlobalDataBaseline: initial.getBaseline() })
  assert.deepEqual(delta.context.changes, { kind: 'delta', upserted: [], removed: [], events: [] })
  const reset = createGlobalDataState({
    pages: [],
    previousGlobalDataBaseline: { state: () => {}, sourceIds: ['old.md'] },
    globalDataInputChanges: { resetReason: 'recovery', upsertedPaths: [], events: [] },
  })
  assert.equal(reset.context.previousState, undefined)
  assert.deepEqual(reset.context.changes, { kind: 'reset', reason: 'recovery', events: [] })
  assert.deepEqual(reset.getBaseline(), { state: undefined, sourceIds: [] })
})

test('global data receives initialized source pages and membership changes independently of output filters', async t => {
  const { src, dest } = await fixture(t, `export default ({ pages, previousState, changes, setState }) => {
    setState({ count: (previousState?.count ?? 0) + 1 })
    return { summary: {
      pages: pages.map(page => ({ sourceId: page.sourceId, title: page.vars.title })),
      previousState,
      changes: changes.kind === 'reset' ? changes : {
        ...changes, upserted: changes.upserted.map(page => page.sourceId),
      },
    } }
  }`)
  await writeFile(join(src, 'other.md'), '---\ntitle: Other\n---\nOther')
  await writeFile(join(src, 'hidden.draft.md'), 'Draft')
  await writeFile(join(src, 'archive.pages.js'), 'export default () => ({ children: "Generated" })')
  const site = await identifyPages(src)
  const home = site.pages.find(page => page.pageFile.basename === 'page.js')
  assert.ok(home)
  home.pageFile.filepath = src + '/./page.js'
  const initial = await buildPagesDirect(src, dest, site, { trackWatchDependencies: true })
  assert.deepEqual(initial.errors, [])
  assert.equal(home.pageFile.filepath, src + '/./page.js', 'path normalization must not mutate discovery metadata')
  /** @type {{ pages: { sourceId: string, title: string }[] }} */
  const first = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
  assert.deepEqual(first.pages.sort((a, b) => a.sourceId.localeCompare(b.sourceId)), [
    { sourceId: 'other.md', title: 'Other' }, { sourceId: 'page.js', title: 'Home' },
  ])

  await rm(join(src, 'other.md'))
  await writeFile(join(src, 'new.md'), 'New')
  const event = classifyWatchEvent('change', join(src, 'page.js'))
  const next = await buildPagesDirect(src, dest, await identifyPages(src, { buildDrafts: true }), {
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
  })
  assert.deepEqual(next.errors, [])
  const second = JSON.parse(await readFile(join(dest, 'index.html'), 'utf8'))
  assert.deepEqual(second.previousState, { count: 1 })
  second.changes.upserted.sort()
  assert.deepEqual(second.changes, {
    kind: 'delta', upserted: ['hidden.draft.md', 'new.md', 'page.js'], removed: ['other.md'], events: [event],
  })
  assert.deepEqual(initial.report.globalDataBaseline?.state, { count: 1 })
  assert.deepEqual(next.report.globalDataBaseline?.state, { count: 2 })
})

test('worker state updates do not enter public fingerprints or rebuild unchanged subscribers', async t => {
  const { src, dest } = await fixture(t, `export default ({ previousState, setState }) => {
    const next = { count: (previousState?.count ?? 0) + 1 }
    setState(next)
    next.count = 999
    return { summary: 'stable' }
  }`)
  const site = await identifyPages(src)
  const cold = await buildPages(src, dest, site, {})
  assert.deepEqual(cold.errors, [])
  assert.equal(Object.hasOwn(cold.report, 'globalDataBaseline'), false)
  const initial = await buildPages(src, dest, site, { trackWatchDependencies: true })
  assert.deepEqual(initial.errors, [])
  const next = await buildPages(src, dest, site, {
    trackWatchDependencies: true,
    previousGlobalDataBaseline: initial.report.globalDataBaseline,
    previousWatchDependencies: initial.report.watchDependencies,
    pageFilterPaths: [],
    templateFilterPaths: [],
    pagesFileFilterPaths: [],
  })
  assert.deepEqual(next.errors, [])
  assert.deepEqual(initial.report.globalDataBaseline?.state, { count: 1 })
  assert.deepEqual(next.report.globalDataBaseline?.state, { count: 2 })
  assert.deepEqual(next.report.pages, [])
  assert.deepEqual(next.report.watchDependencies?.globalDataFingerprints, initial.report.watchDependencies?.globalDataFingerprints)
  assert.deepEqual(Object.keys(next.report.watchDependencies?.globalDataFingerprints ?? {}), ['summary'])
})

test('worker resets discard even uncloneable previous state before transfer', async t => {
  const { src, dest } = await fixture(t, 'export default ({ previousState, changes }) => ({ summary: { previousState, changes } })')
  const result = await buildPages(src, dest, await identifyPages(src), {
    trackWatchDependencies: true,
    previousGlobalDataBaseline: { state: () => {}, sourceIds: ['old.md'] },
    globalDataInputChanges: { resetReason: 'recovery', upsertedPaths: [], events: [] },
  })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.report.globalDataBaseline, { state: undefined, sourceIds: ['page.js'] })
  assert.deepEqual(JSON.parse(await readFile(join(dest, 'index.html'), 'utf8')), {
    changes: { kind: 'reset', reason: 'recovery', events: [] },
  })
})

test('failed page, template, factory, and initialization phases do not emit a candidate', async t => {
  for (const [filename, content] of [
    ['page.js', 'export default () => { throw new Error("render failed") }'],
    ['feed.template.js', 'export default () => { throw new Error("template failed") }'],
    ['archive.pages.js', 'export default () => { throw new Error("factory failed") }'],
    ['page.vars.js', 'export default () => { throw new Error("vars failed") }'],
  ]) {
    assert.ok(filename && content)
    const { src, dest } = await fixture(t, 'export default ({ setState }) => { setState({ candidate: true }); return { summary: "" } }')
    await writeFile(join(src, filename), content)
    const result = await buildPagesDirect(src, dest, await identifyPages(src), { trackWatchDependencies: true })
    assert.ok(result.errors.length > 0, filename)
    assert.equal(Object.hasOwn(result.report, 'globalDataBaseline'), false, filename)
  }
})

test('worker validation errors remain actionable and never emit a candidate', async t => {
  for (const [expression, expected] of /** @type {const} */ ([
    ['{ render () {} }', /structured-cloneable/],
    ['new SharedArrayBuffer(8)', /SharedArrayBuffer/],
  ])) {
    const { src, dest } = await fixture(t, `export default ({ setState }) => { setState(${expression}); return {} }`)
    const result = await buildPages(src, dest, await identifyPages(src), { trackWatchDependencies: true })
    assert.equal(result.errors.length, 1)
    const error = result.errors[0]
    assert.ok(error instanceof Error)
    assert.match(error.message, expected)
    assert.equal(Object.hasOwn(result.report, 'globalDataBaseline'), false)
  }
})

test('resolveGlobalData preserves static exports and accepts a missing global-data file', async t => {
  const { src } = await fixture(t, 'export default { render: () => "public function", value: 1 }')
  const globalDataPath = join(src, 'global.data.js')
  const imported = await import(globalDataPath)
  const { context } = createGlobalDataState({ pages: [] })
  const result = await resolveGlobalData({ globalDataPath, context })
  assert.equal(result, imported.default)
  assert.equal(Reflect.get(result, 'render')(), 'public function')
  assert.deepEqual(await resolveGlobalData({ context }), {})
})
