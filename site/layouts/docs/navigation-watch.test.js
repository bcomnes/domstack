/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @import { NavigationEntry } from './navigation.js'
 * @typedef {{ docsNavigation: NavigationEntry[], docsIndexHtml: string }} DocsData
 * @typedef {{ kind: 'reset' | 'delta', rendered: string[], threadId: number, invocation: number, publicData: DocsData }} ProducerCall
 * @typedef {{ type: 'add' | 'unlink' | 'change', file: string }} SourceEvent
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

import chokidar from 'chokidar'
import pino from 'pino'
import { DomStack } from '../../../index.js'
import { startWatch } from '../../../test-cases/watch/helpers.js'

test('heading changes refresh shared navigation; body edits leave other pages alone', { timeout: 30_000 }, async t => {
  const root = resolve(import.meta.dirname, '../../..')
  const temp = await mkdtemp(join(root, '.tmp-docs-navigation-'))
  const src = join(temp, 'src')
  const dest = join(temp, 'public')
  const domstack = new DomStack(src, dest, { logger: pino({ level: 'silent' }) })
  t.after(async () => {
    if (domstack.watching) await domstack.stopWatching()
    await rm(temp, { recursive: true, force: true })
  })
  for (const file of [
    'site/globals/global.data.ts',
    'site/layouts/docs/navigation.js',
    'site/layouts/docs/docs.layout.js',
    'site/layouts/root/root.layout.js',
  ]) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await cp(join(root, file), join(src, file))
  }
  /** @param {string} file @param {string} text */
  async function write (file, text) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await writeFile(join(src, file), text)
  }
  const index = '---\nlayout: docs\ndataDeps: [docsIndexHtml]\n---\n# Docs\n\n{{{ data.docsIndexHtml }}}'
  const first = '---\nlayout: docs\ndocsOrder: 10\n---\n# First\n\n## Original\n\nBody'
  await write('docs/README.md', index)
  await write('docs/first/README.md', first)
  await write('docs/second/README.md', '---\nlayout: docs\ndocsOrder: 20\n---\n# Second\n\n## Other')
  const result = await startWatch(t, domstack, src)
  assert.equal(result.pageBuildResults?.errors.length, 0)
  const output = join(dest, 'docs/second/index.html')
  assert.match(await readFile(output, 'utf8'), /first\/#original/)

  /** @param {string} file @param {string} text */
  async function edit (file, text) {
    await write(file, text)
    await new Promise(resolve => setTimeout(resolve, 800))
    await domstack.settled()
  }
  const renamed = first.replace('## Original', '## Renamed')
  await edit('docs/first/README.md', renamed)
  const contents = await readFile(output, 'utf8')
  assert.match(contents, /first\/#renamed/)
  assert.doesNotMatch(contents, /first\/#original/)
  const mtime = (await stat(output)).mtimeMs
  const bodyEdited = renamed.replace('Body', 'Changed body only')
  await edit('docs/first/README.md', bodyEdited)
  assert.match(await readFile(join(dest, 'docs/first/index.html'), 'utf8'), /Changed body only/)
  assert.equal((await stat(output)).mtimeMs, mtime, 'unchanged navigation does not invalidate another page')
})

const eligibleDocs = [
  'docs/first/README.md',
  'docs/first/child/README.md',
  'docs/first/child/leaf/README.md',
  'docs/second/README.md',
]
const firstDoc = doc('First', 'docsGroup: Guides\ndocsOrder: 10\n')
const secondDoc = doc('Second', 'docsGroup: Reference\ndocsOrder: 20\n')
const leafDoc = doc('Leaf', 'docsGroup: Guides\ndocsParent: /docs/first/child/\n')
const options = { timeout: 30_000 }

/** @param {string} title @param {string} [vars] */
function doc (title, vars = '') {
  return `---\nlayout: docs\n${vars}---\n# ${title}\n\n## Original\n\nBody\n`
}

/** @param {ProducerCall} call @param {'reset' | 'delta'} kind @param {string[]} rendered */
function assertRenders (call, kind, rendered) {
  assert.equal(call.kind, kind)
  assert.deepEqual(call.rendered, [...rendered].sort(), 'actual producer renderInnerPage calls, including duplicates')
}

/** @param {string} directory @returns {Promise<Record<string, string>>} */
async function docsSnapshot (directory) {
  /** @type {Record<string, string>} */
  const snapshot = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const [name, content] of Object.entries(await docsSnapshot(path))) snapshot[join(entry.name, name)] = content
    } else {
      snapshot[entry.name] = await readFile(path, 'utf8')
    }
  }
  return snapshot
}

/**
 * Mock only source notifications; discovery, dependency tracking, worker isolation,
 * rendering and output writes still run through the real watch/build implementation.
 * @param {TestContext} t
 */
async function instrumentedFixture (t) {
  const root = resolve(import.meta.dirname, '../../..')
  const temp = await mkdtemp(join(root, '.tmp-docs-navigation-'))
  const src = join(temp, 'src')
  const dest = join(temp, 'public')
  const log = join(temp, 'producer.jsonl')
  const buildOptions = { logger: pino({ level: 'silent' }), metafile: false, domstackManifest: false }
  const domstack = new DomStack(src, dest, buildOptions)
  t.after(async () => {
    try {
      if (domstack.watching) await domstack.stopWatching()
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
  for (const file of [
    'site/globals/global.data.ts',
    'site/layouts/docs/navigation.js',
    'site/layouts/docs/docs.layout.js',
    'site/layouts/root/root.layout.js',
  ]) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await cp(join(root, file), join(src, file))
  }
  /** @param {string} file @param {string} text */
  async function write (file, text) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await writeFile(join(src, file), text)
  }

  // Keep the real producer's relative imports, but only the wrapper is a global root.
  await rename(join(src, 'site/globals/global.data.ts'), join(src, 'site/globals/producer.ts'))
  await write('site/globals/global.data.ts', `
import { appendFileSync } from 'node:fs'
import { relative } from 'node:path'
import { threadId } from 'node:worker_threads'
import produce from './producer.ts'
let invocation = 0
export default async function (params) {
  const rendered = []
  const originals = params.pages.map(page => [page, page.renderInnerPage])
  for (const [page, render] of originals) {
    page.renderInnerPage = function (...args) {
      rendered.push(relative(${JSON.stringify(src)}, page.pageInfo.pageFile.filepath))
      return Reflect.apply(render, this, args)
    }
  }
  let publicData
  try {
    publicData = await Reflect.apply(produce, this, [params])
  } finally {
    for (const [page, render] of originals) page.renderInnerPage = render
  }
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({
    kind: params.changes.kind, rendered: rendered.sort(),
    threadId, invocation: ++invocation, publicData,
  }) + '\\n')
  return publicData
}
`)
  await write('docs/README.md', '---\nlayout: docs\ndataDeps: [docsIndexHtml]\n---\n# Docs\n\n{{{ data.docsIndexHtml }}}')
  await write('docs/first/README.md', firstDoc)
  await write('docs/second/README.md', secondDoc)
  await write('docs/first/child/README.md', doc('Child', 'docsGroup: Guides\ndocsParent: /docs/first/\n'))
  await write('docs/first/child/leaf/README.md', leafDoc)
  await write('outside/README.md', '---\nlayout: root\n---\n# Not documentation')
  await write('docs/script/page.js', "export const vars = { layout: 'docs' }; export default () => '<h1>Not Markdown</h1>'\n")
  await write('docs/hidden/page.draft.md', doc('Unpublished'))
  await write('docs/navigation.json.template.js', `
export const dataDeps = ['docsNavigation', 'docsIndexHtml']
export default ({ data }) => JSON.stringify({ docsNavigation: data.docsNavigation, docsIndexHtml: data.docsIndexHtml })
`)
  await write('site/globals/markdown-it.settings.js', 'export default md => md.set({ typographer: false })\n')

  /** @type {FSWatcher | undefined} */
  let watcher
  const watch = chokidar.watch
  /** @param {Parameters<typeof watch>} args */
  const sourceWatch = (...args) => {
    if (args[0] !== src) return watch(...args)
    const fake = Object.assign(new EventEmitter(), {
      closed: false,
      async close () { fake.closed = true },
    })
    watcher = /** @type {FSWatcher} */ (/** @type {unknown} */ (fake))
    setImmediate(() => { if (!fake.closed) fake.emit('ready') })
    return watcher
  }
  t.mock.method(chokidar, 'watch', sourceWatch)

  /** @returns {Promise<ProducerCall[]>} */
  async function calls () {
    const text = await readFile(log, 'utf8')
    return text.trim().split('\n').map(line => JSON.parse(line))
  }
  /** @type {Set<number>} */
  const workers = new Set()
  /** @param {number} before */
  async function newCall (before) {
    const added = (await calls()).slice(before)
    assert.equal(added.length, 1, 'one producer invocation per build, not one per output')
    const call = added[0]
    assert.ok(call)
    assert.equal(call.invocation, 1, 'the producer module is loaded anew for every build')
    assert.ok(call.threadId > 0, 'producer runs in a real worker')
    assert.ok(!workers.has(call.threadId), 'each build uses a fresh worker, not module-local state')
    workers.add(call.threadId)
    assert.deepEqual(Object.keys(call.publicData).sort(), ['docsIndexHtml', 'docsNavigation'], 'public keys remain unchanged')
    return call
  }
  /** @param {SourceEvent[]} events */
  async function rebuild (events) {
    const before = (await calls()).length
    assert.ok(watcher)
    for (const { type, file } of events) watcher.emit(type, join(src, file))
    await nextTurn()
    await domstack.settled()
    return newCall(before)
  }
  /** @param {string} file @param {string} text */
  async function edit (file, text) {
    await write(file, text)
    return rebuild([{ type: 'change', file }])
  }
  /** @param {string} file */
  const output = file => readFile(join(dest, 'docs', file), 'utf8')
  /** @param {ProducerCall} watched @param {string[]} [eligible] */
  async function matchesFresh (watched, eligible = eligibleDocs) {
    const snapshot = await docsSnapshot(join(dest, 'docs'))
    assert.deepEqual(JSON.parse(await output('navigation.json')), watched.publicData, 'published data matches the producer return value')
    const fresh = join(temp, 'fresh')
    await rm(fresh, { recursive: true, force: true })
    const before = (await calls()).length
    const report = await new DomStack(src, fresh, buildOptions).build()
    assert.deepEqual(report.pageBuildResults?.errors, [], 'fresh build succeeded')
    const call = await newCall(before)
    assertRenders(call, 'reset', eligible)
    assert.deepEqual(watched.publicData, call.publicData, 'incremental public data equals a full build')
    assert.deepEqual(snapshot, await docsSnapshot(join(fresh, 'docs')), 'docs output paths and bytes equal a full build')
  }
  return {
    src,
    dest,
    write,
    rebuild,
    edit,
    output,
    matchesFresh,
    async start () {
      const report = await domstack.watch({ serve: false })
      assert.deepEqual(report.pageBuildResults?.errors, [], 'initial watch build succeeded')
      const call = await newCall(0)
      assertRenders(call, 'reset', eligibleDocs)
      return call
    },
  }
}

test('docs index resets render every eligible Markdown source in fresh workers', options, async t => {
  const site = await instrumentedFixture(t)
  const initial = await site.start()
  assert.deepEqual(initial.publicData.docsNavigation.map(entry => entry.url), ['/docs/first/', '/docs/second/'])
  assert.doesNotMatch(JSON.stringify(initial.publicData), /Not documentation|Not Markdown|Unpublished/)
  await site.matchesFresh(initial)
  await site.matchesFresh(initial)
})

test('body-only docs edits render one producer input and preserve public data and sibling mtimes', options, async t => {
  const site = await instrumentedFixture(t)
  const initial = await site.start()
  const untouched = ['index.html', 'second/index.html', 'first/child/index.html', 'first/child/leaf/index.html', 'navigation.json']
    .map(file => join(site.dest, 'docs', file))
  const sentinel = new Date('2000-01-01T00:00:00Z')
  for (const path of untouched) await utimes(path, sentinel, sentinel)
  const mtimes = await Promise.all(untouched.map(async path => (await stat(path, { bigint: true })).mtimeNs))
  const call = await site.edit('docs/first/README.md', firstDoc.replace('Body', 'Only this body changed'))
  assert.deepEqual(call.publicData, initial.publicData, 'both navigation and index HTML are unchanged')
  assert.match(await site.output('first/index.html'), /Only this body changed/)
  assert.deepEqual(await Promise.all(untouched.map(async path => (await stat(path, { bigint: true })).mtimeNs)), mtimes)
  await site.matchesFresh(call)
  assertRenders(call, 'delta', ['docs/first/README.md'])
})

test('heading edits render one producer input and refresh sibling navigation and the docs index', options, async t => {
  const site = await instrumentedFixture(t)
  const initial = await site.start()
  const call = await site.edit('docs/first/README.md', firstDoc.replace('## Original', '## Renamed'))
  assert.notDeepEqual(call.publicData.docsNavigation, initial.publicData.docsNavigation)
  assert.notEqual(call.publicData.docsIndexHtml, initial.publicData.docsIndexHtml)
  for (const file of ['index.html', 'second/index.html']) {
    const html = await site.output(file)
    assert.match(html, /first\/#renamed/)
    assert.doesNotMatch(html, /first\/#original/)
  }
  await site.matchesFresh(call)
  assertRenders(call, 'delta', ['docs/first/README.md'])
})

test('docs adds, renames and deletes reconcile navigation and output ownership like fresh builds', options, async t => {
  const site = await instrumentedFixture(t)
  await site.start()
  const added = 'docs/third/README.md'
  const renamed = 'docs/third/renamed.md'
  await t.test('add', async () => {
    await site.write(added, doc('Third', 'docsGroup: Guides\ndocsOrder: 5\n'))
    const call = await site.rebuild([{ type: 'add', file: added }])
    assert.deepEqual(call.publicData.docsNavigation.map(entry => entry.url), ['/docs/third/', '/docs/first/', '/docs/second/'])
    await site.matchesFresh(call, [...eligibleDocs, added])
    assertRenders(call, 'delta', [added])
  })
  await t.test('rename a directory index to a flat page', async () => {
    await rename(join(site.src, added), join(site.src, renamed))
    const call = await site.rebuild([{ type: 'unlink', file: added }, { type: 'add', file: renamed }])
    assert.deepEqual(call.publicData.docsNavigation.map(entry => entry.url), ['/docs/third/renamed.html', '/docs/first/', '/docs/second/'])
    await assert.rejects(site.output('third/index.html'), { code: 'ENOENT' })
    assert.match(await site.output('index.html'), /third\/renamed\.html#original/)
    await site.matchesFresh(call, [...eligibleDocs, renamed])
    assertRenders(call, 'delta', [renamed])
  })
  await t.test('delete without rendering surviving docs', async () => {
    await rm(join(site.src, renamed))
    const call = await site.rebuild([{ type: 'unlink', file: renamed }])
    assert.deepEqual(call.publicData.docsNavigation.map(entry => entry.url), ['/docs/first/', '/docs/second/'])
    await assert.rejects(site.output('third/renamed.html'), { code: 'ENOENT' })
    assert.doesNotMatch(await site.output('index.html'), /Third/)
    await site.matchesFresh(call)
    assertRenders(call, 'delta', [])
  })
})

test('group, order and parent edits reproject cached docs without accumulating nested entries', options, async t => {
  const site = await instrumentedFixture(t)
  await site.start()
  for (const [name, text, titles] of /** @type {const} */ ([
    ['group', secondDoc.replace('Reference', 'Basics'), ['Second', 'First']],
    ['order', secondDoc.replace('Reference', 'Guides').replace('20', '5'), ['Second', 'First']],
    ['reorder', secondDoc.replace('Reference', 'Guides').replace('20', '30'), ['First', 'Second']],
  ])) {
    await t.test(name, async () => {
      const call = await site.edit('docs/second/README.md', text)
      assert.deepEqual(call.publicData.docsNavigation.map(entry => entry.title), titles)
      assert.equal(call.publicData.docsNavigation.find(entry => entry.title === 'Second')?.group, name === 'group' ? 'Basics' : 'Guides')
      await site.matchesFresh(call)
      assertRenders(call, 'delta', ['docs/second/README.md'])
    })
  }
  for (const parent of ['/docs/first/', undefined, '/docs/first/child/']) {
    await t.test(`parent: ${parent ?? 'none'}`, async () => {
      const text = leafDoc.replace('docsParent: /docs/first/child/\n', parent ? `docsParent: ${parent}\n` : '')
      const call = await site.edit('docs/first/child/leaf/README.md', text)
      const first = call.publicData.docsNavigation.find(entry => entry.url === '/docs/first/')
      const child = first?.sections.find(entry => entry.url === '/docs/first/child/')
      assert.ok(first && child)
      const container = parent === first.url ? first.sections : parent === child.url ? child.sections : call.publicData.docsNavigation
      assert.equal(container.filter(entry => entry.url === '/docs/first/child/leaf/').length, 1, 'leaf appears once beneath its current parent')
      await site.matchesFresh(call)
      assertRenders(call, 'delta', ['docs/first/child/leaf/README.md'])
    })
  }
})

test('producer, navigation helper and Markdown settings edits reset all eligible docs', options, async t => {
  const site = await instrumentedFixture(t)
  const initial = await site.start()
  for (const file of ['site/globals/producer.ts', 'site/layouts/docs/navigation.js', 'site/globals/markdown-it.settings.js']) {
    await t.test(file, async () => {
      const text = await readFile(join(site.src, file), 'utf8')
      const call = await site.edit(file, text + '\n// Trigger a dependency reset.\n')
      assert.deepEqual(call.publicData, initial.publicData)
      await site.matchesFresh(call)
      assertRenders(call, 'reset', eligibleDocs)
    })
  }
})
