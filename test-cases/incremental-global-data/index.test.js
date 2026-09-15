/**
 * @import { InputEvent, ProducerCall } from './helpers.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsPromises, { readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { article, assertDelta, assertPrivateReport, assertReset, fixture, waitFor } from './helpers.js'

const options = { timeout: 30_000 }

test('standalone builds reset state and public build/watch reports do not expose private candidates', options, async t => {
  const site = await fixture(t)
  const first = await site.build()
  const second = await site.build()
  const calls = await site.calls()
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assertReset(call)
    assert.deepEqual(call.events, [])
  }
  assert.deepEqual(calls[0]?.publicData, calls[1]?.publicData)
  const watched = await site.start()
  await site.matchesFresh()
  await t.test('standalone reports', () => {
    assertPrivateReport(first)
    assertPrivateReport(second)
  })
  await t.test('watch report', () => assertPrivateReport(watched))
})

test('body-only edits render one producer input, preserve navigation sibling mtime, and match a fresh build', options, async t => {
  const site = await fixture(t)
  await site.start()
  const initial = (await site.calls())[0]
  assertReset(initial)
  assert.deepEqual(initial.events, [])
  assert.deepEqual(initial.pages, ['a/page.md', 'b/page.md', 'nav/page.js'], 'templates and generated pages are not producer inputs')
  assert.deepEqual(initial.rendered, ['a/page.md', 'b/page.md'])

  const untouched = ['nav/index.html', 'b/index.html', 'summary.html'].map(name => join(site.dest, name))
  const sentinel = new Date('2000-01-01T00:00:00Z')
  for (const path of untouched) await utimes(path, sentinel, sentinel)
  const times = await Promise.all(untouched.map(async path => (await stat(path, { bigint: true })).mtimeNs))
  const event = site.event('a/page.md')
  await site.write('a/page.md', article('Alpha', 'Only this body changed.'))
  const call = await site.rebuild([event])
  assertDelta(call, ['a/page.md'])
  assert.notEqual(call.threadId, initial.threadId)
  assert.deepEqual(call.previousKeys, initial.rendered)
  assert.deepEqual(call.events, [event])
  assert.deepEqual(call.rendered, ['a/page.md'])
  assert.deepEqual(call.publicData.navigation, initial.publicData.navigation)
  assert.notDeepEqual(call.publicData.search, initial.publicData.search)
  assert.match(await readFile(join(site.dest, 'a/index.html'), 'utf8'), /Only this body changed/)
  assert.deepEqual(await Promise.all(untouched.map(async path => (await stat(path, { bigint: true })).mtimeNs)), times)
  await site.matchesFresh()

  // A standalone build on the same source must not replace the live session's state.
  await site.write('b/page.md', article('Beta', 'A second edit.'))
  const second = await site.rebuild([site.event('b/page.md')])
  assertDelta(second, ['b/page.md'])
  assert.deepEqual(second.rendered, ['b/page.md'])
  await site.matchesFresh()
})

test('H1, frontmatter title/metadata, companion vars, and transitive page/layout imports update input rows', options, async t => {
  const site = await fixture(t, {
    files: {
      'code/page.js': "import { content } from '../page-middle.js'; export const vars = { article: true, layout: 'article', title: 'Code' }; export default () => content\n",
      'page-middle.js': "import { content } from './page-leaf.js'; export { content }\n",
      'page-leaf.js': "export const content = 'Code one'\n",
    },
  })
  await site.start()
  const changes = [
    { name: 'a/page.md', content: article('New H1'), inputs: ['a/page.md'], expected: 'New H1' },
    { name: 'a/page.md', content: article('New H1', 'Body.', 'title: Explicit title\ntag: Frontmatter tag\n'), inputs: ['a/page.md'], expected: 'Explicit title' },
    { name: 'b/page.vars.js', content: "export default { tag: 'New companion' }\n", type: 'added', inputs: ['a/page.md', 'b/page.md', 'code/page.js', 'nav/page.js'], expected: 'New companion' },
    { name: 'b/page.vars.js', content: "export default { tag: 'Edited companion' }\n", inputs: ['b/page.md'], expected: 'Edited companion' },
    { name: 'a/page.md', content: article('New H1', 'Body.', 'title: Explicit title\n'), inputs: ['a/page.md'], expected: 'Tag one' },
    { name: 'companion-leaf.js', content: "export const tag = 'Imported companion'\n", inputs: ['a/page.md'], expected: 'Imported companion' },
    { name: 'page-leaf.js', content: "export const content = 'Code two'\n", inputs: ['code/page.js'], expected: 'Code two' },
    { name: 'layout-leaf.js', content: "export const section = 'Section two'\n", inputs: ['a/page.md', 'b/page.md', 'code/page.js'], expected: 'Section two' },
  ]
  for (const change of changes) {
    await t.test(change.name + ': ' + change.expected, async () => {
      await site.write(change.name, change.content)
      const event = site.event(change.name, /** @type {InputEvent['type']} */ (change.type ?? 'change'))
      const call = await site.rebuild([event])
      assertDelta(call, change.inputs)
      assert.deepEqual(call.events, [event])
      assert.match(JSON.stringify(call.publicData), new RegExp(change.expected))
      await site.matchesFresh()
    })
  }
})

test('barrel re-export leaves upsert source pages shared with templates and reset producer inputs', options, async t => {
  const site = await fixture(t, {
    files: {
      'code/page.js': "import { content } from '../page-barrel.js'; export const vars = { article: true, layout: 'article', title: 'Barrel page' }; export default () => content\n",
      'page-barrel.js': "export * from './page-named.js'\n",
      'page-named.js': "export { content } from './page-leaf.js'\n",
      'page-leaf.js': "export const content = 'Barrel one'\n",
      'shared.txt.template.js': "import { content } from './page-leaf.js'; export default () => content\n",
      'producer-middle.js': "export * from './producer-barrel.js'\n",
      'producer-barrel.js': "export { prefix } from './producer-leaf.js'\n",
    },
  })
  await site.start()
  assert.equal(await readFile(join(site.dest, 'shared.txt'), 'utf8'), 'Barrel one')
  await site.write('page-leaf.js', "export const content = 'Barrel two'\n")
  const event = site.event('page-leaf.js')
  const call = await site.rebuild([event])
  const source = 'code/page.js'
  assertDelta(call, [source])
  assert.deepEqual(call.events, [event])
  assert.deepEqual(call.rendered, [source], 'a direct template consumer must not hide the source page reached through barrels')
  assert.equal(await readFile(join(site.dest, 'shared.txt'), 'utf8'), 'Barrel two')
  assert.match(await readFile(join(site.dest, 'code/index.html'), 'utf8'), /Barrel two/)
  assert.ok(call.publicData.search.some(row => row.html.includes('Barrel two')))
  await site.matchesFresh()

  await site.write('producer-leaf.js', "export const prefix = 'Barrel search: '\n")
  const producerEvent = site.event('producer-leaf.js')
  const reset = await site.rebuild([producerEvent])
  assertReset(reset)
  assert.equal(reset.reason, 'global-data-changed', 'producer barrels are recognized dependencies, not unknown-event fallbacks')
  assert.deepEqual(reset.events, [producerEvent])
  assert.deepEqual(reset.rendered, ['a/page.md', 'b/page.md', 'code/page.js'])
  assert.ok(reset.publicData.search.every(row => row.html.startsWith('Barrel search: ')))
  await site.matchesFresh()
})

test('global vars, markdown settings, and producer roots and transitive imports reset the producer', options, async t => {
  const site = await fixture(t, { files: { 'a/page.md': article('Alpha', '<strong>Raw HTML</strong>') } })
  await site.start()
  const changes = [
    ['vars-leaf.js', "export const site = 'Site two'\n", 'Site two'],
    ['global.vars.js', "import { site } from './vars-middle.js'; export default { layout: 'root', site: site + ' direct' }\n", 'Site two direct'],
    ['markdown-leaf.js', 'export const html = false\n', '&lt;strong&gt;'],
    ['markdown-it.settings.js', "import { html } from './markdown-middle.js'; export default md => md.set({ html: !html })\n", '<strong>'],
    ['producer-leaf.js', "export const prefix = 'Search two: '\n", 'Search two:'],
    ['global.data.js', null, 'Search two:'],
  ]
  for (const [name, content, expected] of changes) {
    assert.ok(name && expected)
    await t.test(name, async () => {
      await site.write(name, content ?? (await readFile(join(site.src, name), 'utf8')) + '\n// Edited producer entry.\n')
      const event = site.event(name)
      const call = await site.rebuild([event])
      assertReset(call)
      assert.deepEqual(call.events, [event])
      assert.deepEqual(call.rendered, ['a/page.md', 'b/page.md'])
      assert.ok(JSON.stringify(call.publicData).includes(expected))
      await site.matchesFresh()
    })
  }
})

test('same-basename source IDs keep separate cache entries and removals delete only the matching state', options, async t => {
  const site = await fixture(t)
  await site.start()
  const initial = (await site.calls())[0]
  assertReset(initial)
  assert.deepEqual(initial.pages, ['a/page.md', 'b/page.md', 'nav/page.js'])
  assert.deepEqual(initial.rendered, ['a/page.md', 'b/page.md'])
  assert.deepEqual(initial.publicData.navigation.map(row => row.title), ['Alpha', 'Beta'])

  await rm(join(site.src, 'a/page.md'))
  const event = site.event('a/page.md', 'removed')
  const removed = await site.rebuild([event])
  assertDelta(removed, [], ['a/page.md'])
  assert.deepEqual(removed.events, [event], 'watch events retain absolute filesystem paths')
  assert.deepEqual(removed.previousKeys, ['a/page.md', 'b/page.md'], 'same basenames occupy distinct cache entries')
  assert.deepEqual(removed.pages, ['b/page.md', 'nav/page.js'])
  assert.deepEqual(removed.rendered, [], 'the surviving row comes from cached state')
  assert.deepEqual(removed.publicData.navigation, initial.publicData.navigation.filter(row => row.title === 'Beta'))
  assert.deepEqual(removed.publicData.search, initial.publicData.search.filter(row => row.url === initial.publicData.navigation[1]?.url))
  await assert.rejects(stat(join(site.dest, 'a/index.html')), { code: 'ENOENT' })
  await site.matchesFresh()

  await site.write('b/page.md', article('Surviving Beta'))
  const edited = await site.rebuild([site.event('b/page.md')])
  assertDelta(edited, ['b/page.md'])
  assert.deepEqual(edited.previousKeys, ['b/page.md'], 'the removed ID is absent from the next committed state')
  assert.deepEqual(edited.rendered, ['b/page.md'])
  assert.deepEqual(edited.publicData.navigation.map(row => row.title), ['Surviving Beta'])
  await site.matchesFresh()
})

test('adds, deletes, renames, and draft eligibility reconcile relative source IDs and stale outputs', options, async t => {
  for (const buildDrafts of [false, true]) {
    await t.test(`buildDrafts: ${buildDrafts}`, async t => {
      const site = await fixture(t, { opts: { buildDrafts } })
      await site.start()
      await site.write('c/page.md', article('Gamma'))
      const added = site.event('c/page.md', 'added')
      const call = await site.rebuild([added])
      assertDelta(call, ['c/page.md'])
      assert.deepEqual(call.events, [added])
      await site.matchesFresh()

      for (const [from, to] of /** @type {const} */ ([
        ['c/page.md', 'c/renamed.md'],
        ['c/renamed.md', 'c/renamed.draft.md'],
        ['c/renamed.draft.md', 'c/page.md'],
      ])) {
        await rename(join(site.src, from), join(site.src, to))
        const events = [site.event(from, 'removed'), site.event(to, 'added')]
        const call = await site.rebuild(events)
        const wasEligible = buildDrafts || !from.includes('.draft.')
        const eligible = buildDrafts || !to.includes('.draft.')
        assertDelta(call, eligible ? [to] : [], wasEligible ? [from] : [])
        assert.deepEqual(call.events, events)
        assert.equal(call.pages.includes(to), eligible)
        assert.equal(call.publicData.navigation.some(row => row.title === 'Gamma'), eligible)
        await site.matchesFresh()
      }
      await rm(join(site.src, 'c/page.md'))
      const removed = site.event('c/page.md', 'removed')
      const deleted = await site.rebuild([removed])
      assertDelta(deleted, [], ['c/page.md'])
      assert.deepEqual(deleted.rendered, [])
      assert.deepEqual(deleted.events, [removed])
      await assert.rejects(stat(join(site.dest, 'c/index.html')), { code: 'ENOENT' })
      await site.matchesFresh()
    })
  }
})

test('one batch unions direct and transitive inputs, deduplicates upserts, and retains event order', options, async t => {
  const site = await fixture(t)
  await site.start()
  await site.write('a/page.md', article('Alpha', 'Batch body.'))
  await site.write('companion-leaf.js', "export const tag = 'Batch tag'\n")
  await site.write('b/page.md', article('Batch Beta'))
  const events = [site.event('a/page.md'), site.event('companion-leaf.js'), site.event('a/page.md'), site.event('b/page.md')]
  const call = await site.rebuild(events)
  const inputs = ['a/page.md', 'b/page.md']
  assertDelta(call, inputs)
  assert.deepEqual(call.rendered, inputs)
  assert.deepEqual(call.events, events)
  await site.matchesFresh()

  await site.write('a/page.md', article('Reset batch'))
  await site.write('producer-leaf.js', "export const prefix = 'Reset batch: '\n")
  const resetEvents = [site.event('a/page.md'), site.event('producer-leaf.js')]
  const reset = await site.rebuild(resetEvents)
  assertReset(reset)
  assert.deepEqual(reset.events, resetEvents)
  await site.matchesFresh()
})

test('events arriving during an active producer are buffered into the next unioned batch', options, async t => {
  const site = await fixture(t)
  await site.start()
  await writeFile(site.gate, '')
  await site.write('a/page.md', article('Alpha', 'Active build body.'))
  site.emit([site.event('a/page.md')])
  try {
    await waitFor(async () => (await site.calls()).length === 2, 'active producer reaches its gate')
    await site.write('b/page.md', article('Buffered Beta'))
    await site.write('companion-leaf.js', "export const tag = 'Buffered tag'\n")
    const events = [site.event('b/page.md'), site.event('companion-leaf.js'), site.event('b/page.md')]
    site.emit(events)
    await rm(site.gate)
    await site.dom.settled()
    const calls = await site.calls()
    assert.equal(calls.length, 3, 'initial, active, and one buffered build')
    assertDelta(calls[1], ['a/page.md'])
    assertDelta(calls[2], ['a/page.md', 'b/page.md'])
    assert.deepEqual(calls[2].events, events)
    await site.matchesFresh()
  } finally {
    await rm(site.gate, { force: true })
  }
})

test('watch registers before initial producer work and buffers startup changes and membership events', options, async t => {
  const site = await fixture(t)
  await writeFile(site.gate, '')
  const starting = site.start()
  try {
    await waitFor(async () => (await site.calls()).length === 1, 'initial producer reaches its gate')
    assert.equal(site.watcherOptions()?.ignoreInitial, true)
    await site.write('a/page.md', article('Startup Alpha'))
    await site.write('c/page.md', article('Startup Gamma'))
    const events = [site.event('a/page.md'), site.event('c/page.md', 'added')]
    site.emit(events)
    await rm(site.gate)
    await starting
    await site.dom.settled()
    const calls = await site.calls()
    assert.equal(calls.length, 2, 'initial build followed by one buffered startup batch')
    assertReset(calls[0])
    assertDelta(calls[1], ['a/page.md', 'c/page.md'])
    assert.deepEqual(calls[1].events, events)
    await site.matchesFresh()
  } finally {
    await rm(site.gate, { force: true })
    await starting
  }
})

test('setState from a failed producer or later render is not reused and recovery resumes deltas', options, async t => {
  for (const phase of ['producer', 'render']) {
    await t.test(phase, async t => {
      const site = await fixture(t)
      await site.start()
      const before = await readFile(join(site.dest, 'data.json'), 'utf8')
      const marker = phase === 'producer' ? site.producerFailure : site.renderFailure
      await writeFile(marker, '')
      await site.write('a/page.md', article('Alpha', 'Failed build body.'))
      const failed = await site.rebuild([site.event('a/page.md')])
      assertDelta(failed, ['a/page.md'])
      assert.equal(await readFile(join(site.dest, 'data.json'), 'utf8'), before, 'failed phase does not publish the new public-data template')

      await rm(marker)
      await site.write('b/page.md', article('Recovered Beta'))
      const event = site.event('b/page.md')
      const recovered = await site.rebuild([event])
      assertReset(recovered)
      assert.deepEqual(recovered.events, [event])
      assert.ok(JSON.stringify(recovered.publicData).includes('Failed build body.'), 'recovery recomputes inputs changed in the failed build too')
      await site.matchesFresh()

      await site.write('a/page.md', article('Alpha', 'Successful delta after recovery.'))
      const delta = await site.rebuild([site.event('a/page.md')])
      assertDelta(delta, ['a/page.md'])
      assert.deepEqual(delta.rendered, ['a/page.md'])
      await site.matchesFresh()
    })
  }
})

test('cleanup failure discards producer state but retains new sidecar ownership for recovery', options, async t => {
  const site = await fixture(t, {
    files: {
      'a/page.md': article('Initial Alpha', 'Initial body.', 'sidecar: initial.txt\n'),
      'a/page.vars.js': `export default {}
export const pageOutputs = ({ vars }) => ({ outputName: vars.sidecar, content: vars.title })\n`,
    },
  })
  await site.start()
  const stale = join(site.dest, 'a/initial.txt')
  const candidate = join(site.dest, 'a/candidate.txt')
  assert.equal(await readFile(stale, 'utf8'), 'Initial Alpha')
  const originalRm = fsPromises.rm
  let cleanupAttempts = 0
  /** @param {Parameters<typeof originalRm>} args */
  const failFirstCleanup = async (...args) => {
    if (String(args[0]) === stale && cleanupAttempts++ === 0) {
      throw Object.assign(new Error('intentional stale sidecar cleanup failure'), { code: 'EACCES' })
    }
    return originalRm(...args)
  }
  const cleanup = t.mock.method(fsPromises, 'rm', failFirstCleanup)
  syncBuiltinESMExports()
  try {
    await site.write('a/page.md', article('Candidate Alpha', 'Candidate body.', 'sidecar: candidate.txt\n'))
    const failed = await site.rebuild([site.event('a/page.md')])
    assertDelta(failed, ['a/page.md'])
    assert.equal(cleanupAttempts, 1, 'failure occurs in stale-output cleanup, after rendering')
    assert.equal(await readFile(stale, 'utf8'), 'Initial Alpha')
    assert.equal(await readFile(candidate, 'utf8'), 'Candidate Alpha', 'new page-owned output was already written')
    assert.deepEqual(JSON.parse(await readFile(join(site.dest, 'data.json'), 'utf8')), failed.publicData)

    // Only B emits an event: failure recovery must rediscover A's final sidecar too.
    await site.write('a/page.md', article('Recovered Alpha', 'Recovered body.', 'sidecar: recovered.txt\n'))
    await site.write('b/page.md', article('Recovery Beta'))
    const event = site.event('b/page.md')
    const recovered = await site.rebuild([event])
    assertReset(recovered)
    assert.deepEqual(recovered.events, [event])
    assert.equal(cleanupAttempts, 2)
    assert.equal(await readFile(join(site.dest, 'a/recovered.txt'), 'utf8'), 'Recovered Alpha')
    await assert.rejects(stat(stale), { code: 'ENOENT' })
    await assert.rejects(stat(candidate), { code: 'ENOENT' }, 'sidecar written before cleanup failed must not be orphaned')
    await site.matchesFresh()
  } finally {
    cleanup.mock.restore()
    syncBuiltinESMExports()
  }
})

test('events buffered during a failing producer batch automatically recover without retaining its candidate', options, async t => {
  const site = await fixture(t)
  await site.start()
  await writeFile(site.producerFailure, '')
  await writeFile(site.gate, '')
  await site.write('a/page.md', article('Alpha', 'Body from the failing batch.'))
  const activeEvent = site.event('a/page.md')
  site.emit([activeEvent])
  try {
    await waitFor(async () => (await site.calls()).length === 2, 'failing producer snapshots its candidate and reaches the gate')
    await site.write('b/page.md', article('Buffered recovery Beta'))
    await site.write('companion-leaf.js', "export const tag = 'Buffered recovery tag'\n")
    const events = [site.event('b/page.md'), site.event('companion-leaf.js')]
    site.emit(events)
    // The active worker captured failure already; the next worker must succeed.
    await rm(site.producerFailure)
    await rm(site.gate)
    await site.dom.settled()
    const calls = await site.calls()
    assert.equal(calls.length, 3, 'initial, failed, and one buffered recovery build')
    assertDelta(calls[1], ['a/page.md'])
    assert.deepEqual(calls[1].events, [activeEvent])
    assertReset(calls[2])
    assert.deepEqual(calls[2].events, events)
    assert.deepEqual(calls[2].rendered, ['a/page.md', 'b/page.md'])
    assert.ok(JSON.stringify(calls[2].publicData).includes('Body from the failing batch.'))
    assert.ok(JSON.stringify(calls[2].publicData).includes('Buffered recovery tag'))
    await site.matchesFresh()

    await site.write('b/page.md', article('Beta after buffered recovery'))
    const delta = await site.rebuild([site.event('b/page.md')])
    assertDelta(delta, ['b/page.md'])
    assert.deepEqual(delta.rendered, ['b/page.md'])
    await site.matchesFresh()
  } finally {
    await rm(site.producerFailure, { force: true })
    await rm(site.gate, { force: true })
  }
})

test('independent sessions and a stopped/restarted instance never inherit each other\'s Map state', options, async t => {
  const first = await fixture(t)
  const second = await fixture(t, { files: { 'a/page.md': article('Other session') } })
  await first.start()
  await first.write('a/page.md', article('First session edited'))
  await first.rebuild([first.event('a/page.md')])
  await second.start()
  assertReset((await second.calls())[0])
  await second.write('b/page.md', article('Other Beta'))
  const other = await second.rebuild([second.event('b/page.md')])
  assertDelta(other, ['b/page.md'])
  assert.deepEqual(other.previousKeys, ['a/page.md', 'b/page.md'])
  assert.deepEqual(other.publicData.navigation.map(row => row.title), ['Other session', 'Other Beta'])
  assert.equal((await first.calls()).length, 2)
  await second.matchesFresh()

  await first.dom.stopWatching()
  await first.write('b/page.md', article('Edited while stopped'))
  await first.start()
  const restarted = (await first.calls()).at(-1)
  assert.ok(restarted)
  assertReset(restarted)
  assert.deepEqual(restarted.events, [])
  await first.write('a/page.md', article('Restart delta'))
  const delta = await first.rebuild([first.event('a/page.md')])
  assertDelta(delta, ['a/page.md'])
  await first.matchesFresh()
})

test('native static JSON leaf edits reset producer, global-vars, and markdown-settings inputs', options, async t => {
  const site = await fixture(t, {
    native: true,
    files: {
      'a/page.md': article('Alpha', '<strong>Raw JSON HTML</strong>'),
      'producer-leaf.js': "import settings from './producer.json' with { type: 'json' }; export const prefix = settings.prefix\n",
      'producer.json': JSON.stringify({ prefix: 'JSON search one: ' }),
      'vars-leaf.js': "import settings from './vars.json' with { type: 'json' }; export const site = settings.site\n",
      'vars.json': JSON.stringify({ site: 'JSON site one' }),
      'markdown-leaf.js': "import settings from './markdown.json' with { type: 'json' }; export const html = settings.html\n",
      'markdown.json': JSON.stringify({ html: true }),
    },
  })
  await site.start()
  const changes = [
    { name: 'producer.json', content: { prefix: 'JSON search two: ' }, reason: 'global-data-changed', expected: 'JSON search two: ' },
    { name: 'vars.json', content: { site: 'JSON site two' }, reason: 'global-vars-changed', expected: 'JSON site two' },
    { name: 'markdown.json', content: { html: false }, reason: 'markdown-settings-changed', expected: '&lt;strong&gt;' },
  ]
  for (const change of changes) {
    await t.test(change.name, async () => {
      await site.settleNative()
      const beforeEdit = (await site.calls()).length
      await site.write(change.name, JSON.stringify(change.content))
      await waitFor(async () => (await site.calls()).length > beforeEdit, `native watcher dispatches ${change.name}`)
      await site.settleNative()
      const calls = (await site.calls()).slice(beforeEdit)
      assertNativeEvents(calls, site.event(change.name))
      for (const call of calls) {
        assertReset(call)
        assert.equal(call.reason, change.reason)
        assert.deepEqual(call.rendered, ['a/page.md', 'b/page.md'])
        assert.ok(JSON.stringify(call.publicData).includes(change.expected))
      }
      await site.matchesFresh()
    })
  }
})

test('native atomic replacement updates one producer input and keeps watching the replacement', options, async t => {
  const site = await fixture(t, { native: true })
  await site.start()
  await site.settleNative()
  const source = join(site.src, 'a/page.md')
  const oldInode = (await stat(source)).ino
  const replacement = join(site.root, 'replacement.md')
  await writeFile(replacement, article('Atomic Alpha', 'Atomically replaced body.'))
  const beforeEdit = (await site.calls()).length
  await rename(replacement, source)
  assert.notEqual((await stat(source)).ino, oldInode, 'replacement uses a new inode, not an in-place write')
  await waitFor(async () => (await site.calls()).length > beforeEdit, 'native watcher dispatches the atomic replacement')
  await site.settleNative()
  const calls = (await site.calls()).slice(beforeEdit)
  assertNativeEvents(calls, site.event('a/page.md'))
  for (const replaced of calls) {
    assertDelta(replaced, ['a/page.md'])
    assert.deepEqual(replaced.rendered, ['a/page.md'])
  }
  assert.match(await readFile(join(site.dest, 'a/index.html'), 'utf8'), /Atomically replaced body/)
  await site.matchesFresh()

  await site.settleNative()
  const beforeNextEdit = (await site.calls()).length
  await site.write('a/page.md', article('Atomic Alpha', 'Edited replacement body.'))
  await waitFor(async () => (await site.calls()).length > beforeNextEdit, 'native watcher follows the replacement inode')
  await site.settleNative()
  const nextCalls = (await site.calls()).slice(beforeNextEdit)
  assertNativeEvents(nextCalls, site.event('a/page.md'))
  for (const edited of nextCalls) {
    assertDelta(edited, ['a/page.md'])
    assert.deepEqual(edited.rendered, ['a/page.md'])
  }
  assert.match(await readFile(join(site.dest, 'a/index.html'), 'utf8'), /Edited replacement body/)
  await site.matchesFresh()
})

test('native chokidar body edits reach the same incremental public API', options, async t => {
  const site = await fixture(t, { native: true })
  await site.start()
  // Native startup may conservatively report unchanged files; measure only the edit.
  await site.settleNative()
  const beforeEdit = (await site.calls()).length
  await site.write('a/page.md', article('Alpha', 'Native watcher body edit.'))
  await waitFor(async () => (await site.calls()).length > beforeEdit, 'native watcher dispatches the source edit')
  await site.settleNative()
  const calls = (await site.calls()).slice(beforeEdit)
  assertNativeEvents(calls, site.event('a/page.md'))
  for (const edited of calls) {
    assertDelta(edited, ['a/page.md'])
    assert.deepEqual(edited.rendered, ['a/page.md'])
  }
  await site.matchesFresh()
})

/** @param {ProducerCall[]} calls @param {InputEvent} expectedEvent */
function assertNativeEvents (calls, expectedEvent) {
  // Native delivery is not exactly-once: an edit can repeat within or across batches.
  // Deterministic tests retain exact invocation and input-render counts per batch.
  const details = JSON.stringify({
    expectedEvent,
    calls: calls.map(({ kind, reason, events, upserted, removed, rendered }) => ({ kind, reason, events, upserted, removed, rendered })),
  }, null, 2)
  assert.ok(calls.length > 0, `Expected at least one native edit invocation: ${details}`)
  for (const call of calls) {
    assert.ok(call.events.length > 0, `Native edit invocation has no events: ${details}`)
    for (const event of call.events) {
      assert.deepEqual(event, expectedEvent, `Unexpected native event or source path: ${details}`)
    }
  }
}
