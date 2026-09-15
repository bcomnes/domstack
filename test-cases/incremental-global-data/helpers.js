/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'

 * @import { Results, DomStackOpts } from '../../lib/builder.js'
 * @typedef {{ type: 'added' | 'removed' | 'change', filepath: string }} InputEvent
 * @typedef {object} ProducerCall
 * @property {'reset' | 'delta'} kind
 * @property {string} [reason]
 * @property {InputEvent[]} events
 * @property {string[]} pages
 * @property {string[]} upserted
 * @property {string[]} removed
 * @property {string[]} rendered
 * @property {string[] | null} previousKeys
 * @property {boolean} previousIsMap
 * @property {number} invocation
 * @property {number} threadId
 * @property {{ navigation: { url: string, title: string, tag: string | null, site: string, section: string }[], search: { url: string, html: string }[] }} publicData
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'
import pino from 'pino'
import { DomStack } from '../../index.js'

/** @param {string} heading @param {string} [body] @param {string} [frontmatter] */
export function article (heading, body = 'Original body.', frontmatter = '') {
  return `---\narticle: true\nlayout: article\n${frontmatter}---\n# ${heading}\n\n${body}\n`
}

/** @param {() => Promise<boolean>} predicate @param {string} message */
export async function waitFor (predicate, message) {
  const deadline = Date.now() + 8000
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, message)
    await delay(20)
  }
}

/**
 * Only source event delivery is mocked; discovery, dependency analysis, workers,
 * rendering, writes, cleanup, esbuild and copy watchers use the real implementation.
 * @param {TestContext} t
 * @param {{ native?: boolean, files?: Record<string, string>, opts?: DomStackOpts }} [options]
 */
export async function fixture (t, { native = false, files = {}, opts = {} } = {}) {
  const root = await mkdtemp(join(import.meta.dirname, '.tmp-'))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  const log = join(root, 'producer.jsonl')
  const gate = join(root, 'hold-producer')
  const producerFailure = join(root, 'fail-producer')
  const renderFailure = join(root, 'fail-render')
  const logger = pino({ level: 'silent' })
  const buildOptions = { metafile: false, domstackManifest: false, logger, ...opts }
  const dom = new DomStack(src, dest, buildOptions)
  /** @type {FSWatcher | undefined} */
  let watcher
  /** @type {Parameters<typeof chokidar.watch>[1]} */
  let watcherOptions
  let nativeEventCount = 0
  const watch = chokidar.watch
  /** @param {Parameters<typeof watch>} args */
  const sourceWatch = (...args) => {
    if (args[0] !== src) return watch(...args)
    watcherOptions = args[1]
    if (native) {
      watcher = watch(...args)
      watcher.on('all', () => { nativeEventCount++ })
    } else {
      const events = new EventEmitter()
      const fake = Object.assign(events, {
        closed: false,
        async close () { fake.closed = true },
      })
      watcher = /** @type {FSWatcher} */ (/** @type {unknown} */ (fake))
      setImmediate(() => { if (!fake.closed) fake.emit('ready') })
    }
    return watcher
  }
  t.mock.method(chokidar, 'watch', sourceWatch)
  t.after(async () => {
    await rm(gate, { force: true })
    try {
      if (dom.watching) await dom.stopWatching()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  /** @param {string} name @param {string} content */
  const write = async (name, content) => {
    const path = join(src, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  const producer = `
import assert from 'node:assert/strict'
import { appendFileSync, existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { threadId } from 'node:worker_threads'
import { prefix } from './producer-middle.js'
let invocation = 0
export default async ({ pages, previousState, changes, setState }) => {
  assert.ok(previousState === undefined || previousState instanceof Map)
  const previousKeys = previousState === undefined ? null : [...previousState.keys()].sort()
  const state = changes.kind === 'reset' ? new Map() : new Map(previousState)
  const changed = changes.kind === 'reset' ? pages : changes.upserted
  const rendered = []
  for (const path of changes.removed ?? []) state.delete(path)
  for (const page of changed) {
    assert.ok(pages.includes(page), 'upserts are current initialized PageData instances')
    const path = page.pageInfo.pageFile.filepath
    if (!page.vars.article) { state.delete(path); continue }
    rendered.push(path)
    state.set(path, {
      url: page.pageInfo.url,
      title: page.vars.title,
      tag: page.vars.tag ?? null,
      site: page.vars.site,
      section: page.vars.section,
      html: await page.renderFullPage(),
    })
  }
  const rows = [...state.values()].sort((a, b) => a.url.localeCompare(b.url))
  const publicData = {
    navigation: rows.map(({ html, ...row }) => row),
    search: rows.map(row => ({ url: row.url, html: prefix + row.html })),
  }
  // Capture this attempt's failure before the gate; a buffered retry can then recover.
  const fail = existsSync(${JSON.stringify(producerFailure)})
  if (fail) state.set('failed-candidate', {})
  setState(state)
  // Both mutations must be isolated from the explicit snapshot crossing workers.
  state.set('post-setState-mutation', {})
  previousState?.clear()
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({
    kind: changes.kind, reason: changes.reason,
    events: changes.events.map(({ type, filepath }) => ({ type, filepath })),
    pages: pages.map(page => page.pageInfo.pageFile.filepath).sort(),
    upserted: (changes.upserted ?? []).map(page => page.pageInfo.pageFile.filepath).sort(),
    removed: [...(changes.removed ?? [])].sort(), rendered: rendered.sort(),
    previousKeys, previousIsMap: previousState instanceof Map,
    invocation: ++invocation, threadId, publicData,
  }) + '\\n')
  const deadline = Date.now() + 8000
  while (existsSync(${JSON.stringify(gate)})) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test producer gate')
    await delay(10)
  }
  if (fail) throw new Error('intentional producer failure after setState')
  return publicData
}
`
  const defaults = {
    'global.vars.js': "import { site } from './vars-middle.js'; export default { layout: 'root', site }\n",
    'vars-middle.js': "import { site } from './vars-leaf.js'; export { site }\n",
    'vars-leaf.js': "export const site = 'Site one'\n",
    'global.data.js': producer,
    'producer-middle.js': "import { prefix } from './producer-leaf.js'; export { prefix }\n",
    'producer-leaf.js': "export const prefix = 'Search one: '\n",
    'markdown-it.settings.js': "import { html } from './markdown-middle.js'; export default md => md.set({ html })\n",
    'markdown-middle.js': "import { html } from './markdown-leaf.js'; export { html }\n",
    'markdown-leaf.js': 'export const html = true\n',
    'root.layout.js': 'export default ({ children }) => children\n',
    'article.layout.js': "import { section } from './layout-middle.js'; export const vars = { section }; export default ({ children }) => '<article>' + section + children + '</article>'\n",
    'layout-middle.js': "import { section } from './layout-leaf.js'; export { section }\n",
    'layout-leaf.js': "export const section = 'Section one'\n",
    'a/page.md': article('Alpha'),
    'a/page.vars.js': "import { tag } from '../companion-middle.js'; export default { tag }\n",
    'companion-middle.js': "import { tag } from './companion-leaf.js'; export { tag }\n",
    'companion-leaf.js': "export const tag = 'Tag one'\n",
    'b/page.md': article('Beta'),
    'nav/page.js': "export const vars = { dataDeps: ['navigation'] }; export default ({ data }) => JSON.stringify(data.navigation)\n",
    'data.json.template.js': `import { existsSync } from 'node:fs'
export const dataDeps = ['navigation', 'search']
export default ({ data }) => {
  if (existsSync(${JSON.stringify(renderFailure)})) throw new Error('intentional later render failure')
  return JSON.stringify({ navigation: data.navigation, search: data.search })
}\n`,
    'summary.pages.js': "export const dataDeps = ['navigation']; export default ({ data }) => ({ outputName: 'summary.html', children: JSON.stringify(data.navigation) })\n",
    ...files,
  }
  await Promise.all(Object.entries(defaults).map(([name, content]) => write(name, content)))

  /** @returns {Promise<ProducerCall[]>} */
  const calls = async () => {
    const text = await readFile(log, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : []
  }
  /** @param {InputEvent[]} events */
  const emit = events => {
    assert.ok(watcher, 'source watcher must exist before initial discovery/build finishes')
    for (const { type, filepath } of events) {
      watcher.emit(type === 'added' ? 'add' : type === 'removed' ? 'unlink' : 'change', filepath)
    }
  }
  /** @param {string} name @param {InputEvent['type']} [type] @returns {InputEvent} */
  const event = (name, type = 'change') => ({ type, filepath: join(src, name) })
  /** @param {InputEvent[]} events */
  const rebuild = async events => {
    const count = (await calls()).length
    emit(events)
    await nextTurn()
    await dom.settled()
    const added = (await calls()).slice(count)
    assert.equal(added.length, 1, 'one producer invocation per event batch')
    const call = added[0]
    assert.ok(call)
    return call
  }
  return {
    root,
    src,
    dest,
    dom,
    write,
    calls,
    emit,
    event,
    rebuild,
    gate,
    producerFailure,
    renderFailure,
    async settleNative () {
      assert.ok(native, 'quiescence waits are only for native source events')
      await waitFor(async () => {
        await dom.settled()
        const count = nativeEventCount
        // Allow delayed native notifications and the watcher's 300ms atomic window.
        await delay(500)
        await dom.settled()
        return nativeEventCount === count
      }, 'native source notifications become quiescent')
    },
    watcherOptions: () => watcherOptions,
    build: () => new DomStack(src, join(root, 'standalone'), buildOptions).build(),
    async start () {
      const report = await dom.watch({ serve: false })

      assert.deepEqual(report.pageBuildResults?.errors, [], 'initial page build succeeded')
      return report
    },
    async matchesFresh () {
      const watchedOutputs = await outputSnapshot(dest)
      const watchedData = JSON.parse(await readFile(join(dest, 'data.json'), 'utf8'))
      const freshDest = join(root, 'fresh')
      await rm(freshDest, { recursive: true, force: true })
      const report = await new DomStack(src, freshDest, buildOptions).build()
      assert.deepEqual(report.pageBuildResults?.errors, [], 'fresh page build succeeded')
      const freshCall = (await calls()).at(-1)
      assert.ok(freshCall)
      assert.equal(freshCall.kind, 'reset')
      assert.equal(freshCall.previousKeys, null)
      assert.deepEqual(freshCall.events, [])
      assert.deepEqual(watchedData, freshCall.publicData, 'public data matches a from-scratch producer')
      assert.deepEqual(watchedOutputs, await outputSnapshot(freshDest), 'all public output names and bytes match a fresh build')
    },
  }
}

/** @param {Results} report */
export function assertPrivateReport (report) {
  assert.deepEqual(report.pageBuildResults?.errors, [], 'page build succeeded')
  const pageReport = report.pageBuildResults?.report
  assert.ok(pageReport)
  for (const key of ['globalDataBaseline', 'previousGlobalDataBaseline', 'globalDataInputChanges', 'previousState']) {
    assert.equal(Object.hasOwn(pageReport, key), false, `${key} stays private`)
    assert.equal(Object.hasOwn(report, key), false, `${key} is not a public result`)
  }
}

/** @param {string} dir @returns {Promise<Record<string, string>>} */
async function outputSnapshot (dir) {
  /** @type {Record<string, string>} */
  const files = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const [name, content] of Object.entries(await outputSnapshot(path))) files[join(entry.name, name)] = content
    } else {
      files[entry.name] = await readFile(path, 'utf8')
    }
  }
  return files
}

/**
 * @param {ProducerCall | undefined} call
 * @param {string[]} upserted
 * @param {string[]} [removed]
 * @returns {asserts call is ProducerCall}
 */
export function assertDelta (call, upserted, removed = []) {
  assert.ok(call)
  assert.equal(call.kind, 'delta')
  assert.equal(call.previousIsMap, true, 'Map state survives the worker boundary')
  assert.deepEqual(call.upserted, [...upserted].sort())
  assert.deepEqual(call.removed, [...removed].sort())
  assert.equal(call.invocation, 1, 'each build loads the producer in a fresh worker')
  assert.ok(call.previousKeys?.every(key => !key.includes('mutation') && key !== 'failed-candidate'))
}

/** @param {ProducerCall | undefined} call @returns {asserts call is ProducerCall} */
export function assertReset (call) {
  assert.ok(call)
  assert.equal(call.kind, 'reset')
  assert.equal(typeof call.reason, 'string')
  assert.ok(call.reason)
  assert.equal(call.previousKeys, null)
  assert.equal(call.previousIsMap, false)
  assert.equal(call.invocation, 1)
}
