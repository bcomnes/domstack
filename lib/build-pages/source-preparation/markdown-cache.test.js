/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { PreparedMarkdown } from './markdown.js'
 * @import { MarkdownPreparationState } from './markdown-cache.js'
 * @import { GlobalDataInputChanges } from '../global-data/global-data-state.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import markdownIt from 'markdown-it'
import { classifyWatchEvent } from '../../watch/plan.js'
import { MarkdownPreparationCache, applyMarkdownPreparationUpdate } from './markdown-cache.js'

/** @param {string} [name] @param {Partial<PageInfo>} [overrides] @returns {PageInfo} */
function page (name = 'page.md', overrides = {}) {
  const root = resolve('source-preparation-test')
  return {
    pageFile: { root, filepath: resolve(root, name), relname: name, basename: basename(name), parentName: '' },
    type: 'md',
    path: '',
    url: '/',
    outputName: 'index.html',
    outputRelname: 'index.html',
    draft: false,
    ...overrides,
  }
}

/** @param {Record<string, any>} [vars] @returns {PreparedMarkdown} */
const prepared = (vars = { title: 'Original', nested: { list: ['original'] } }) => ({ markdownContent: '# Original', vars })

/** @param {PageInfo[]} pages @returns {MarkdownPreparationState} */
const baseline = pages => new Map(pages.map(p => [p.pageFile.filepath, { sourceId: p.pageFile.relname, prepared: prepared() }]))

/** @type {GlobalDataInputChanges} */
const delta = { upsertedPaths: [], events: [] }

test('hits clone vars without loads, parsing or upserts; misses snapshot before exposure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domstack-preparation-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = page(join(root, 'page.md'))
  p.pageFile.relname = 'page.md'
  await writeFile(p.pageFile.filepath, '# Original')
  const parse = t.mock.method(markdownIt.prototype, 'parse')
  const first = new MarkdownPreparationCache({ pages: [p] })
  const initial = await first.prepare(p)
  initial.vars['title'] = 'Application mutation'
  const previous = applyMarkdownPreparationUpdate(null, first.getUpdate())
  assert.equal(parse.mock.callCount(), 1)
  // A hit must not touch the now-missing source file.
  await rm(p.pageFile.filepath)
  const next = new MarkdownPreparationCache({ pages: [p], previous, changes: delta })
  const hit = await next.prepare(p)
  assert.equal(hit.vars['title'], 'Original')
  hit.vars['title'] = 'Another mutation'
  assert.equal((await next.prepare(p)).vars['title'], 'Original')
  assert.equal(parse.mock.callCount(), 1)
  assert.deepEqual(next.getUpdate(), { replace: false, upserts: new Map(), removed: [] })
})

test('no baseline, no changes metadata and reset reasons force replacement', async t => {
  const p = page()
  for (const params of [
    {}, { previous: baseline([p]) }, { previous: null, changes: delta },
    { previous: baseline([p]), changes: { ...delta, resetReason: 'recovery' } },
    { previous: baseline([p]), changes: { ...delta, resetReason: '' } },
  ]) {
    const result = prepared()
    const loader = t.mock.fn(async () => result)
    const cache = new MarkdownPreparationCache({ pages: [p], ...params }, loader)
    assert.equal(await cache.prepare(p), result, 'a miss exposes the original')
    assert.equal(loader.mock.callCount(), 1)
    assert.equal(cache.getUpdate().replace, true)
    assert.notEqual(cache.getUpdate().upserts.get(p.pageFile.filepath)?.prepared, result)
    assert.equal(applyMarkdownPreparationUpdate(baseline([page('old.md')]), cache.getUpdate()).size, 1)
  }
})

test('upserted source paths and direct event paths invalidate only affected sources', async t => {
  const pages = [page('one.md'), page('two.md'), page('three.md')]
  const [one, two, three] = /** @type {[PageInfo, PageInfo, PageInfo]} */ (pages)
  const loader = t.mock.fn(async () => prepared())
  const cache = new MarkdownPreparationCache({
    pages,
    previous: baseline(pages),
    changes: {
      upsertedPaths: [join(one.pageFile.root, 'nested', '..', 'one.md')],
      events: [classifyWatchEvent('change', two.pageFile.filepath), classifyWatchEvent('change', join(three.pageFile.root, 'page.vars.js'))],
    },
  }, loader)
  await Promise.all(pages.map(p => cache.prepare(p)))
  assert.equal(loader.mock.callCount(), 2)
  assert.deepEqual([...cache.getUpdate().upserts.keys()].sort(), [one.pageFile.filepath, two.pageFile.filepath].sort())
})

test('membership reconciles deletion, rename, type and generated changes, and source identity', async t => {
  const old = [page('deleted.md'), page('renamed.md'), page('html.md'), page('generated.md'), page('identity.md'), page('unchanged.md')]
  const identity = page('identity.md')
  identity.pageFile.relname = 'other-root/identity.md'
  const current = [
    page('new-name.md'), page('html.md', { type: 'html' }),
    page('generated.md', { generated: { pagesFile: { pagesFile: page('list.pages.js').pageFile, path: '', name: 'list' } } }),
    identity, page('unchanged.md'),
  ]
  const previous = baseline(old)
  const saved = structuredClone(previous)
  const loader = t.mock.fn(async () => prepared())
  const cache = new MarkdownPreparationCache({ pages: current, previous, changes: delta }, loader)
  await Promise.all(current.filter(p => p.type === 'md' && !p.generated).map(p => cache.prepare(p)))
  assert.equal(loader.mock.callCount(), 2)
  const update = cache.getUpdate()
  assert.equal(update.removed.length, 5)
  const next = applyMarkdownPreparationUpdate(previous, update)
  assert.equal(next.size, 3)
  assert.equal(next.get(identity.pageFile.filepath)?.sourceId, 'other-root/identity.md')
  assert.deepEqual(previous, saved)
  assert.notEqual(next, previous)
})

test('absolute path and source-relative normalization agree with page identity', async t => {
  const p = page()
  const previous = baseline([p])
  p.pageFile.filepath = join(p.pageFile.root, 'nested') + '/../page.md'
  p.pageFile.relname = './nested/../page.md'
  const loader = t.mock.fn(async () => prepared())
  const cache = new MarkdownPreparationCache({ pages: [p], previous, changes: delta }, loader)
  await cache.prepare(p)
  assert.equal(loader.mock.callCount(), 0)
  assert.equal(cache.getUpdate().upserts.size, 0)
})

test('nonmembers and non-source markdown never enter the candidate', async t => {
  const p = page()
  const loader = t.mock.fn(async () => prepared())
  const cache = new MarkdownPreparationCache({ pages: [] }, loader)
  await cache.prepare(p)
  await cache.prepare(page('html.md', { type: 'html' }))
  assert.equal(loader.mock.callCount(), 2)
  assert.equal(cache.getUpdate().upserts.size, 0)
})

test('nested graphs, primitive values, sparse arrays, dates and binary are isolated on misses and hits', async () => {
  const p = page()
  const date = new Date('2026-09-17')
  const binary = new Uint8Array([1, 2, 3])
  const nested = { list: [date, binary] }
  /** @type {Record<string, any>} */
  const vars = { nested, alias: nested, date, binary, view: binary.subarray(1), empty: undefined, nil: null, big: 1n, nan: NaN, infinity: Infinity, negativeZero: -0, sparse: new Array(3) }
  vars['self'] = vars
  const original = prepared(vars)
  const cache = new MarkdownPreparationCache({ pages: [p] }, async () => original)
  assert.equal(await cache.prepare(p), original)
  date.setUTCFullYear(2000)
  binary[0] = 99
  nested.list.length = 0
  const previous = applyMarkdownPreparationUpdate(null, cache.getUpdate())
  const hitCache = new MarkdownPreparationCache({ pages: [p], previous, changes: delta })
  const first = await hitCache.prepare(p)
  const second = await hitCache.prepare(p)
  assert.equal(first.vars['self'], first.vars)
  assert.equal(first.vars['nested'], first.vars['alias'])
  assert.equal(first.vars['nested'].list[0], first.vars['date'])
  assert.equal(first.vars['nested'].list[1], first.vars['binary'])
  assert.equal(first.vars['view'].buffer, first.vars['binary'].buffer)
  assert.deepEqual(first.vars['date'], new Date('2026-09-17'))
  assert.deepEqual(first.vars['binary'], new Uint8Array([1, 2, 3]))
  assert.equal(Object.hasOwn(first.vars, 'empty'), true)
  assert.equal(first.vars['big'], 1n)
  assert.equal(first.vars['nil'], null)
  assert.equal(first.vars['infinity'], Infinity)
  assert.ok(Number.isNaN(first.vars['nan']))
  assert.ok(Object.is(first.vars['negativeZero'], -0))
  assert.equal(0 in first.vars['sparse'], false)
  first.vars['date'].setUTCFullYear(1900)
  first.vars['binary'][0] = 88
  first.vars['nested'].list.push('changed')
  assert.deepEqual(second.vars['date'], new Date('2026-09-17'))
  assert.deepEqual(second.vars['binary'], new Uint8Array([1, 2, 3]))
  assert.equal(second.vars['nested'].list.length, 2)
  assert.deepEqual((await hitCache.prepare(p)), second)
})

test('unsafe metadata skips caching without invoking getters or proxy traps', async t => {
  const p = page()
  const getter = t.mock.fn(() => { throw new Error('getter must not run') })
  const trap = t.mock.fn(() => { throw new Error('proxy trap must not run') })
  const clone = t.mock.method(globalThis, 'structuredClone')
  const accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true })
  const proxy = new Proxy({}, { ownKeys: trap, getPrototypeOf: trap, get: trap })
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  class Custom { value = 1 }
  const values = [
    accessor, proxy, revoked.proxy, new Custom(), Object.create(null),
    () => {}, Symbol('value'), { [Symbol('key')]: 1 }, new SharedArrayBuffer(1),
    new Uint8Array(new SharedArrayBuffer(1)), new Map(), new Set(), /regexp/,
    new Uint16Array([1]), Buffer.from([1]), new ArrayBuffer(1),
    Object.assign([], { extra: true }), Object.assign(new Date(), { extra: true }),
    Object.assign(new Uint8Array([1]), { extra: true }),
    Object.defineProperty({}, 'hidden', { value: 1 }),
    Object.defineProperty(new Uint8Array([1]), 'buffer', { get: getter }),
    Object.setPrototypeOf(new Map(), Object.prototype),
    Object.setPrototypeOf(new Date(), Object.prototype),
    Object.setPrototypeOf(new Uint8Array([1]), Object.prototype),
  ]
  for (const value of values) {
    const original = prepared({ value })
    const previous = baseline([p])
    const cache = new MarkdownPreparationCache({ pages: [p], previous, changes: { ...delta, upsertedPaths: [p.pageFile.filepath] } }, async () => original)
    assert.equal(await cache.prepare(p), original)
    assert.equal(cache.getUpdate().upserts.size, 0)
    assert.deepEqual(cache.getUpdate().removed, [p.pageFile.filepath])
    assert.equal(applyMarkdownPreparationUpdate(previous, cache.getUpdate()).size, 0)
    assert.equal(previous.size, 1)
  }
  assert.equal(getter.mock.callCount(), 0)
  assert.equal(trap.mock.callCount(), 0)
  assert.equal(clone.mock.callCount(), 0, 'reject unsafe values before structuredClone')
})

test('uncacheable prior entries are reloaded rather than exposed or rejected', async t => {
  const p = page()
  const previous = baseline([p])
  const entry = previous.get(p.pageFile.filepath)
  assert.ok(entry)
  entry.prepared.vars['fn'] = () => {}
  const loader = t.mock.fn(async () => prepared())
  const cache = new MarkdownPreparationCache({ pages: [p], previous, changes: delta }, loader)
  const result = await cache.prepare(p)
  assert.equal(result.vars['fn'], undefined)
  assert.equal(loader.mock.callCount(), 1)
  assert.equal(cache.getUpdate().upserts.size, 1)
  assert.equal(typeof entry.prepared.vars['fn'], 'function')
})

test('candidate creation and application stay separate, including failed loads', async t => {
  const p = page()
  const previous = baseline([p])
  const saved = structuredClone(previous)
  const changed = { ...delta, upsertedPaths: [p.pageFile.filepath] }
  const loader = t.mock.fn(async () => prepared({ title: 'New' }))
  const abandoned = new MarkdownPreparationCache({ pages: [p], previous, changes: changed }, loader)
  await abandoned.prepare(p)
  assert.deepEqual(previous, saved)
  const nextBuild = new MarkdownPreparationCache({ pages: [p], previous, changes: delta }, loader)
  assert.equal((await nextBuild.prepare(p)).vars['title'], 'Original')
  const accepted = applyMarkdownPreparationUpdate(previous, abandoned.getUpdate())
  assert.equal(accepted.get(p.pageFile.filepath)?.prepared.vars['title'], 'New')
  assert.deepEqual(previous, saved)
  const failure = new Error('source read failed')
  const failed = new MarkdownPreparationCache({ pages: [p], previous, changes: changed }, async () => { throw failure })
  await assert.rejects(failed.prepare(p), error => error === failure)
  assert.equal(failed.getUpdate().upserts.size, 0)
  assert.deepEqual(previous, saved)
  assert.deepEqual(applyMarkdownPreparationUpdate(undefined, { replace: false, upserts: new Map(), removed: [] }), new Map())
})

test('clone failures fall back to uncached originals without failing preparation', async t => {
  const p = page()
  const original = prepared()
  t.mock.method(globalThis, 'structuredClone', () => { throw new Error('clone unavailable') })
  const loader = t.mock.fn(async () => original)
  const cache = new MarkdownPreparationCache({ pages: [p] }, loader)
  assert.equal(await cache.prepare(p), original)
  assert.equal(await cache.prepare(p), original)
  assert.equal(loader.mock.callCount(), 2)
  assert.equal(cache.getUpdate().upserts.size, 0)
})

test('invalidated unprepared entries are removed and repeated updates retain only current versions', async () => {
  const p = page()
  let previous = baseline([p])
  const changes = { ...delta, upsertedPaths: [p.pageFile.filepath] }
  const unprepared = new MarkdownPreparationCache({ pages: [p], previous, changes })
  assert.equal(applyMarkdownPreparationUpdate(previous, unprepared.getUpdate()).size, 0)
  for (let version = 0; version < 5; version++) {
    const cache = new MarkdownPreparationCache({ pages: [p], previous, changes }, async () => prepared({ version }))
    await cache.prepare(p)
    previous = applyMarkdownPreparationUpdate(previous, cache.getUpdate())
    assert.equal(previous.size, 1)
    assert.equal(previous.get(p.pageFile.filepath)?.prepared.vars['version'], version)
  }
})

test('concurrent preparation loads once and gives each consumer isolated vars', async t => {
  const p = page()
  const loader = t.mock.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return prepared()
  })
  const cache = new MarkdownPreparationCache({ pages: [p] }, loader)
  const results = await Promise.all(Array.from({ length: 12 }, () => cache.prepare(p)))
  assert.equal(loader.mock.callCount(), 1)
  assert.equal(cache.getUpdate().upserts.size, 1)
  assert.equal(new Set(results.map(result => result.vars['nested'])).size, 12)
  for (const result of results) result.vars['nested'].list.push('changed')
  assert.deepEqual((await cache.prepare(p)).vars['nested'].list, ['original'])
})
