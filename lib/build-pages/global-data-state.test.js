/**
 * @import { TestContext } from 'node:test'
 * @import { BuildPagesFilterOptions } from './index.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createGlobalDataState } from './global-data-state.js'
import { buildPages, buildPagesDirect } from './index.js'
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
  const previousGlobalDataBaseline = { state, sourcePaths: [] }
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
    const previousGlobalDataBaseline = { state, sourcePaths: [] }
    assert.throws(() => createGlobalDataState({ pages: [], previousGlobalDataBaseline }), /global\.data previous state.*SharedArrayBuffer.*non-shared ArrayBuffer/)
    assert.equal(previousGlobalDataBaseline.state, state)
  }
  const reset = createGlobalDataState({
    pages: [],
    previousGlobalDataBaseline: { state: buffer, sourcePaths: [] },
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
  assert.throws(() => createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state: unsafe, sourcePaths: [] } }), /SharedArrayBuffer/)
  assert.equal(reads, 3)
  createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state: safe, sourcePaths: [] } })
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
  const transaction = createGlobalDataState({ pages: [], previousGlobalDataBaseline: { state, sourcePaths: [] } })
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
  for (const previousGlobalDataBaseline of [undefined, null, { state: () => {}, sourcePaths: ['/old.md'] }]) {
    const transaction = createGlobalDataState({
      pages: [],
      previousGlobalDataBaseline,
      globalDataInputChanges: { resetReason: 'global-data-changed', upsertedPaths: [], events: [] },
    })
    assert.equal(transaction.context.previousState, undefined)
    assert.deepEqual(transaction.context.changes, { kind: 'reset', reason: 'global-data-changed', events: [] })
    assert.deepEqual(transaction.getBaseline(), { state: undefined, sourcePaths: [] })
  }
  const initial = createGlobalDataState({ pages: [] })
  assert.deepEqual(initial.context.changes, { kind: 'reset', reason: 'initial', events: [] })
  const delta = createGlobalDataState({ pages: [], previousGlobalDataBaseline: initial.getBaseline() })
  assert.deepEqual(delta.context.changes, { kind: 'delta', upserted: [], removed: [], events: [] })
})

for (const [mode, build] of /** @type {const} */ ([['direct', buildPagesDirect], ['worker', buildPages]])) {
  test(`${mode}: reset and delta use eligible source membership, not output filters or generated pages`, async t => {
    const { src, dest } = await fixture(t)
    await writeFile(join(src, 'other.md'), '---\ntitle: Other\n---\nOther')
    await writeFile(join(src, 'hidden.draft.md'), 'Draft')
    await writeFile(join(src, 'archive.pages.js'), 'export default () => ({ children: \'Generated\' })')
    await writeFile(join(src, 'global.data.js'), `export default ({ pages, previousState, changes, setState }) => {
      const summary = {
        pages: pages.map(page => ({ path: page.pageInfo.pageFile.filepath, title: page.vars.title })),
        previousState,
        changes: changes.kind === 'reset' ? changes : {
          ...changes, upserted: changes.upserted.map(page => page.pageInfo.pageFile.filepath),
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
    assert.deepEqual(first.pages.map((/** @type {{path: string}} */ p) => p.path).sort(), [join(src, 'other.md'), join(src, 'page.js')])
    assert.equal(first.pages.find((/** @type {{title: string}} */ p) => p.title === 'Home').title, 'Home')
    assert.deepEqual(initial.report.globalDataBaseline, { state: { count: 1 }, sourcePaths: site.pages.map(p => resolve(p.pageFile.filepath)) })
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
    assert.deepEqual(second.changes.upserted.sort(), [join(src, 'hidden.draft.md'), join(src, 'new.md'), join(src, 'page.js')])
    assert.deepEqual(second.changes.removed, [join(src, 'other.md')])
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

  test(`${mode}: successful watch builds emit candidates while cold reports keep state private`, async t => {
    const { src, dest } = await fixture(t)
    await writeFile(join(src, 'global.data.js'), 'export default ({ setState }) => { setState({ candidate: true }); return { summary: \'\' } }')
    const site = await identifyPages(src)
    const cold = await build(src, dest, site, {})
    assert.deepEqual(cold.errors, [])
    assert.equal(Object.hasOwn(cold.report, 'globalDataBaseline'), false)
    const watch = await build(src, dest, site, { trackWatchDependencies: true })
    assert.deepEqual(watch.errors, [])
    assert.deepEqual(watch.report.globalDataBaseline, { state: { candidate: true }, sourcePaths: [join(src, 'page.js')] })
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
      const previousGlobalDataBaseline = { state: { previous: true }, sourcePaths: [] }
      const result = await build(src, dest, await identifyPages(src), { previousGlobalDataBaseline, trackWatchDependencies: true })
      assert.ok(result.errors.length > 0, filename)
      assert.equal(Object.hasOwn(result.report, 'globalDataBaseline'), false, filename)
      assert.deepEqual(previousGlobalDataBaseline, { state: { previous: true }, sourcePaths: [] })
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
        previousGlobalDataBaseline: previous ? { state: new Set([new Uint8Array(new SharedArrayBuffer(8))]), sourcePaths: [] } : undefined,
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
  const result = await resolveGlobalData({ globalDataPath, pages: [] })
  assert.equal(result, imported.default)
  assert.equal(Reflect.get(result, 'render')(), 'public function')
  assert.deepEqual(await resolveGlobalData({ pages: [] }), {})
})
