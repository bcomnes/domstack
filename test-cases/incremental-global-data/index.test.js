import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsPromises, { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { article, assertDelta, assertReset, fixture, waitFor } from './helpers.js'

const options = { timeout: 30_000 }

test('cached index adds, updates and removes distinct source IDs without rerendering unchanged rows', options, async t => {
  const site = await fixture(t)
  const report = await site.start()
  assert.equal(report.pageBuildResults?.report.globalDataBaseline, undefined, 'retained state is private to the watch session')
  const initial = (await site.calls())[0]
  assertReset(initial)
  assert.deepEqual(initial.events, [])
  assert.deepEqual(initial.rendered, ['a/page.md', 'b/page.md'])
  const original = await site.data()
  assert.deepEqual(original.map(row => row.title), ['Alpha', 'Beta'])

  await site.write('c/page.md', article('Gamma'))
  const added = await site.rebuild([site.event('c/page.md', 'added')])
  assertDelta(added, ['c/page.md'])
  assert.deepEqual(added.rendered, ['c/page.md'])
  assert.deepEqual((await site.data()).map(row => row.title), ['Alpha', 'Beta', 'Gamma'])

  await site.write('a/page.md', article('Updated Alpha', 'Updated body.'))
  const event = site.event('a/page.md')
  const updated = await site.rebuild([event])
  assertDelta(updated, ['a/page.md'])
  assert.deepEqual(updated.events, [event])
  assert.deepEqual(updated.rendered, ['a/page.md'])
  const data = await site.data()
  assert.equal(data[0]?.title, 'Updated Alpha')
  assert.match(data[0]?.html ?? '', /Updated body/)
  assert.deepEqual(data[1], original[1], 'same-basename sibling retains its cached row')

  await rm(join(site.src, 'a/page.md'))
  const removed = await site.rebuild([site.event('a/page.md', 'removed')])
  assertDelta(removed, [], ['a/page.md'])
  assert.deepEqual(removed.rendered, [])
  assert.deepEqual(await site.data(), data.slice(1))
  await assert.rejects(stat(join(site.dest, 'a/index.html')), { code: 'ENOENT' })
})

test.todo('re-exported page helpers shared with templates upsert affected source pages (https://github.com/bcomnes/domstack/issues/328)')
test.todo('named, star, and namespace re-exports of global-data helpers trigger an index reset (https://github.com/bcomnes/domstack/issues/328)')

test('a shared dependency upserts a transitive source page even when a template imports it directly', options, async t => {
  const site = await fixture(t, {
    files: {
      'code/page.js': "import { content } from '../page-middle.js'; export const vars = { article: true, title: 'Code' }; export default () => content\n",
      'page-middle.js': "import { content } from './page-leaf.js'; export { content }\n",
      'page-leaf.js': "export const content = 'Code one'\n",
      'shared.txt.template.js': "import { content } from './page-leaf.js'; export default () => content\n",
    },
  })
  await site.start()
  await site.write('page-leaf.js', "export const content = 'Code two'\n")
  const call = await site.rebuild([site.event('page-leaf.js')])
  assertDelta(call, ['code/page.js'])
  assert.deepEqual(call.rendered, ['code/page.js'])
  assert.equal(await readFile(join(site.dest, 'shared.txt'), 'utf8'), 'Code two')
  assert.match(await readFile(join(site.dest, 'code/index.html'), 'utf8'), /Code two/)
  assert.ok((await site.data()).some(row => row.html.includes('Code two')))
})

test('a global producer dependency resets the whole index, including in a mixed page batch', options, async t => {
  const site = await fixture(t)
  await site.start()
  await site.write('a/page.md', article('Reset Alpha'))
  await site.write('producer-leaf.js', "export const prefix = 'New search: '\n")
  const events = [site.event('a/page.md'), site.event('producer-leaf.js')]
  const call = await site.rebuild(events)
  assertReset(call)
  assert.equal(call.reason, 'global-data-changed')
  assert.deepEqual(call.events, events)
  assert.deepEqual(call.rendered, ['a/page.md', 'b/page.md'])
  const data = await site.data()
  assert.deepEqual(data.map(row => row.title), ['Reset Alpha', 'Beta'])
  assert.ok(data.every(row => row.html.startsWith('New search: ')))
})

test('helpers shared by pages and global configuration reset the index and rebuild unrelated outputs', options, async t => {
  const site = await fixture(t, {
    files: {
      'global.vars.js': "import { site } from './vars-helper.js'; export default { layout: 'root', site }\n",
      'vars-helper.js': "export const site = 'Site one'\n",
      'root.layout.js': "export default ({ vars, children }) => '<header>' + vars.site + '</header>' + children\n",
      'markdown-it.settings.js': "import { html } from './markdown-helper.js'; export default md => md.set({ html })\n",
      'markdown-helper.js': 'export const html = true\n',
      'code/page.js': "import { site } from '../vars-helper.js'; import { html } from '../markdown-helper.js'; export default () => site + ':' + html\n",
      'unrelated.txt.template.js': "import { randomUUID } from 'node:crypto'; export const dataDeps = []; export default () => randomUUID()\n",
      'a/page.md': article('Alpha', '<strong>Raw HTML</strong>'),
    },
  })
  await site.start()
  assert.match((await site.data())[0]?.html ?? '', /<header>Site one<\/header>.*<strong>Raw HTML<\/strong>/s)

  await site.write('vars-helper.js', "export const site = 'Site two'\n")
  const vars = await site.rebuild([site.event('vars-helper.js')])
  assertReset(vars)
  assert.equal(vars.reason, 'global-config-changed')
  assert.ok((await site.data()).every(row => row.html.includes('<header>Site two</header>')))
  assert.match(await readFile(join(site.dest, 'b/index.html'), 'utf8'), /<header>Site two<\/header>/)
  assert.match(await readFile(join(site.dest, 'code/index.html'), 'utf8'), /Site two:true/)

  const unrelated = await readFile(join(site.dest, 'unrelated.txt'), 'utf8')
  await site.write('markdown-helper.js', 'export const html = false\n')
  const markdown = await site.rebuild([site.event('markdown-helper.js')])
  assertReset(markdown)
  assert.equal(markdown.reason, 'global-config-changed')
  assert.match((await site.data())[0]?.html ?? '', /&lt;strong&gt;Raw HTML&lt;\/strong&gt;/)
  assert.match(await readFile(join(site.dest, 'a/index.html'), 'utf8'), /&lt;strong&gt;Raw HTML&lt;\/strong&gt;/)
  assert.match(await readFile(join(site.dest, 'code/index.html'), 'utf8'), /Site two:false/)
  assert.notEqual(await readFile(join(site.dest, 'unrelated.txt'), 'utf8'), unrelated, 'Markdown settings rerender templates without settings imports or data subscriptions')
})

test('in-flight events become one ordered batch with deduplicated inputs', options, async t => {
  const site = await fixture(t)
  await site.start()
  await writeFile(site.gate, '')
  await site.write('a/page.md', article('Active Alpha'))
  site.emit([site.event('a/page.md')])
  try {
    await waitFor(async () => (await site.calls()).length === 2, 'active producer reaches its gate')
    await site.write('a/page.md', article('Buffered Alpha'))
    await site.write('b/page.md', article('Buffered Beta'))
    const events = [site.event('b/page.md'), site.event('a/page.md'), site.event('b/page.md')]
    site.emit(events)
    await rm(site.gate)
    await site.dom.settled()
    const calls = await site.calls()
    assert.equal(calls.length, 3, 'initial, active, and one buffered build')
    assertDelta(calls[1], ['a/page.md'])
    assertDelta(calls[2], ['a/page.md', 'b/page.md'])
    assert.deepEqual(calls[2].events, events)
    assert.deepEqual(calls[2].rendered, ['a/page.md', 'b/page.md'])
    assert.deepEqual((await site.data()).map(row => row.title), ['Buffered Alpha', 'Buffered Beta'])
  } finally {
    await rm(site.gate, { force: true })
  }
})

test('watch buffers edits and additions during the initial producer build', options, async t => {
  const site = await fixture(t)
  await writeFile(site.gate, '')
  const starting = site.start()
  try {
    await waitFor(async () => (await site.calls()).length === 1, 'initial producer reaches its gate')
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
    assert.deepEqual((await site.data()).map(row => row.title), ['Startup Alpha', 'Beta', 'Startup Gamma'])
  } finally {
    await rm(site.gate, { force: true })
    await starting
  }
})

test('a later render failure discards the producer candidate and recovery resumes deltas', options, async t => {
  const site = await fixture(t)
  await site.start()
  const before = await site.data()
  await writeFile(site.renderFailure, '')
  await site.write('a/page.md', article('Failed Alpha'))
  assertDelta(await site.rebuild([site.event('a/page.md')]), ['a/page.md'])
  assert.deepEqual(await site.data(), before, 'failed template does not publish candidate data')

  await rm(site.renderFailure)
  await site.write('b/page.md', article('Recovered Beta'))
  assertReset(await site.rebuild([site.event('b/page.md')]))
  assert.deepEqual((await site.data()).map(row => row.title), ['Failed Alpha', 'Recovered Beta'])

  await site.write('b/page.md', article('Delta Beta'))
  assertDelta(await site.rebuild([site.event('b/page.md')]), ['b/page.md'])
  assert.deepEqual((await site.data()).map(row => row.title), ['Failed Alpha', 'Delta Beta'])
})

test('cleanup failure discards state but retains sidecar ownership for recovery', options, async t => {
  const site = await fixture(t, {
    files: {
      'a/page.md': article('Initial Alpha', 'Body.', 'sidecar: initial.txt\n'),
      'a/page.vars.js': 'export const pageOutputs = ({ vars }) => ({ outputName: vars.sidecar, content: vars.title })\n',
    },
  })
  await site.start()
  const stale = join(site.dest, 'a/initial.txt')
  const candidate = join(site.dest, 'a/candidate.txt')
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
    await site.write('a/page.md', article('Candidate Alpha', 'Body.', 'sidecar: candidate.txt\n'))
    assertDelta(await site.rebuild([site.event('a/page.md')]), ['a/page.md'])
    assert.equal(cleanupAttempts, 1)
    assert.equal(await readFile(stale, 'utf8'), 'Initial Alpha')
    assert.equal(await readFile(candidate, 'utf8'), 'Candidate Alpha', 'new output was written before cleanup failed')

    // Only B emits an event: recovery must rediscover A and clean up both old sidecars.
    await site.write('a/page.md', article('Recovered Alpha', 'Body.', 'sidecar: recovered.txt\n'))
    await site.write('b/page.md', article('Recovered Beta'))
    assertReset(await site.rebuild([site.event('b/page.md')]))
    assert.equal(await readFile(join(site.dest, 'a/recovered.txt'), 'utf8'), 'Recovered Alpha')
    await assert.rejects(stat(stale), { code: 'ENOENT' })
    await assert.rejects(stat(candidate), { code: 'ENOENT' }, 'candidate sidecar must not be orphaned')
    assert.deepEqual((await site.data()).map(row => row.title), ['Recovered Alpha', 'Recovered Beta'])
  } finally {
    cleanup.mock.restore()
    syncBuiltinESMExports()
  }
})

test('a buffered batch recovers automatically after the producer fails after setState', options, async t => {
  const site = await fixture(t)
  await site.start()
  await writeFile(site.producerFailure, '')
  await writeFile(site.gate, '')
  await site.write('a/page.md', article('Failed Alpha'))
  site.emit([site.event('a/page.md')])
  try {
    await waitFor(async () => (await site.calls()).length === 2, 'failing producer reaches its gate')
    await site.write('b/page.md', article('Buffered Beta'))
    const events = [site.event('b/page.md')]
    site.emit(events)
    // The active worker captured failure already; the next worker must succeed.
    await rm(site.producerFailure)
    await rm(site.gate)
    await site.dom.settled()
    const calls = await site.calls()
    assert.equal(calls.length, 3, 'initial, failed, and one buffered recovery build')
    assertDelta(calls[1], ['a/page.md'])
    assertReset(calls[2])
    assert.deepEqual(calls[2].events, events)
    assert.deepEqual((await site.data()).map(row => row.title), ['Failed Alpha', 'Buffered Beta'])

    await site.write('b/page.md', article('Delta Beta'))
    assertDelta(await site.rebuild([site.event('b/page.md')]), ['b/page.md'])
    assert.deepEqual((await site.data()).map(row => row.title), ['Failed Alpha', 'Delta Beta'])
  } finally {
    await rm(site.producerFailure, { force: true })
    await rm(site.gate, { force: true })
  }
})

test('independent sessions and a stopped/restarted instance do not inherit cached state', options, async t => {
  const first = await fixture(t)
  const second = await fixture(t, { files: { 'a/page.md': article('Other Alpha') } })
  await first.start()
  await first.write('a/page.md', article('First Alpha'))
  await first.rebuild([first.event('a/page.md')])
  await second.start()
  assertReset((await second.calls())[0])
  await second.write('b/page.md', article('Other Beta'))
  assertDelta(await second.rebuild([second.event('b/page.md')]), ['b/page.md'])
  assert.deepEqual((await second.data()).map(row => row.title), ['Other Alpha', 'Other Beta'])
  assert.deepEqual((await first.data()).map(row => row.title), ['First Alpha', 'Beta'])

  await first.dom.stopWatching()
  await first.write('b/page.md', article('Edited while stopped'))
  await first.start()
  assertReset((await first.calls()).at(-1))
  await first.write('a/page.md', article('Restart Alpha'))
  assertDelta(await first.rebuild([first.event('a/page.md')]), ['a/page.md'])
  assert.deepEqual((await first.data()).map(row => row.title), ['Restart Alpha', 'Edited while stopped'])
})

test('a native imported JSON edit resets the producer and publishes every updated row', options, async t => {
  const site = await fixture(t, {
    native: true,
    files: {
      'producer-leaf.js': "import settings from './prefix.json' with { type: 'json' }; export const prefix = settings.prefix\n",
      'prefix.json': JSON.stringify({ prefix: 'Original prefix: ' }),
    },
  })
  await site.start()
  assert.ok((await site.data()).every(row => row.html.startsWith('Original prefix: ')))
  const callsBeforeEdit = (await site.calls()).length
  await site.write('prefix.json', JSON.stringify({ prefix: 'Updated prefix: ' }))
  await waitFor(async () => (await site.calls()).length > callsBeforeEdit, 'native JSON edit reaches the producer')
  // The producer log precedes output writes; read the JSON only after they finish.
  await site.dom.settled()

  const call = (await site.calls()).at(-1)
  assertReset(call)
  assert.equal(call.reason, 'global-data-changed')
  assert.deepEqual(call.rendered, ['a/page.md', 'b/page.md'])
  const data = await site.data()
  assert.deepEqual(data.map(row => row.title), ['Alpha', 'Beta'])
  assert.ok(data.every(row => row.html.startsWith('Updated prefix: ')))
})
