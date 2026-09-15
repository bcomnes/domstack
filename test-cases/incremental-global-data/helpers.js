/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @typedef {{ type: 'added' | 'removed' | 'change', filepath: string }} InputEvent
 * @typedef {object} ProducerCall
 * @property {'reset' | 'delta'} kind
 * @property {string} [reason]
 * @property {InputEvent[]} events
 * @property {string[]} upserted Source-root-relative IDs.
 * @property {string[]} removed
 * @property {string[]} rendered
 * @property {string[] | null} previousKeys
 * @typedef {{ url: string, title: string, html: string }} IndexRow
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'
import pino from 'pino'
import { DomStack } from '../../index.js'

/** @param {string} heading @param {string} [body] @param {string} [frontmatter] */
export function article (heading, body = 'Original body.', frontmatter = '') {
  return `---\narticle: true\n${frontmatter}---\n# ${heading}\n\n${body}\n`
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
 * Mock only source event delivery; builds, workers, rendering and cleanup are real.
 * @param {TestContext} t
 * @param {{ files?: Record<string, string> }} [options]
 */
export async function fixture (t, { files = {} } = {}) {
  const root = await mkdtemp(join(import.meta.dirname, '.tmp-'))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  const log = join(root, 'producer.jsonl')
  const gate = join(root, 'hold-producer')
  const producerFailure = join(root, 'fail-producer')
  const renderFailure = join(root, 'fail-render')
  const dom = new DomStack(src, dest, { metafile: false, domstackManifest: false, logger: pino({ level: 'silent' }) })
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
import { appendFileSync, existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { prefix } from './producer-middle.js'
export default async ({ pages, previousState, changes, setState }) => {
  const state = changes.kind === 'reset' ? new Map() : new Map(previousState)
  const rendered = []
  for (const sourceId of changes.removed ?? []) state.delete(sourceId)
  for (const page of changes.kind === 'reset' ? pages : changes.upserted) {
    if (!page.vars.article) { state.delete(page.sourceId); continue }
    rendered.push(page.sourceId)
    state.set(page.sourceId, {
      url: page.pageInfo.url,
      title: page.vars.title,
      html: prefix + await page.renderFullPage(),
    })
  }
  setState(state)
  // Capture failure before the gate so a buffered retry can recover.
  const fail = existsSync(${JSON.stringify(producerFailure)})
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({
    kind: changes.kind, reason: changes.reason,
    events: changes.events.map(({ type, filepath }) => ({ type, filepath })),
    upserted: (changes.upserted ?? []).map(page => page.sourceId).sort(),
    removed: [...(changes.removed ?? [])].sort(), rendered: rendered.sort(),
    previousKeys: previousState === undefined ? null : [...previousState.keys()].sort(),
  }) + '\\n')
  const deadline = Date.now() + 8000
  while (existsSync(${JSON.stringify(gate)})) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test producer gate')
    await delay(10)
  }
  if (fail) throw new Error('intentional producer failure after setState')
  return { index: [...state.values()].sort((a, b) => a.url.localeCompare(b.url)) }
}
`
  const defaults = {
    'global.data.js': producer,
    'producer-middle.js': "import { prefix } from './producer-leaf.js'; export { prefix }\n",
    'producer-leaf.js': "export const prefix = 'Search: '\n",
    'a/page.md': article('Alpha'),
    'b/page.md': article('Beta'),
    'data.json.template.js': `import { existsSync } from 'node:fs'
export const dataDeps = ['index']
export default ({ data }) => {
  if (existsSync(${JSON.stringify(renderFailure)})) throw new Error('intentional later render failure')
  return JSON.stringify(data.index)
}\n`,
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
    assert.ok(watcher, 'source watcher exists before initial build finishes')
    for (const { type, filepath } of events) {
      watcher.emit(type === 'added' ? 'add' : type === 'removed' ? 'unlink' : 'change', filepath)
    }
  }
  return {
    src,
    dest,
    dom,
    write,
    calls,
    emit,
    gate,
    producerFailure,
    renderFailure,
    /** @returns {Promise<IndexRow[]>} */
    async data () { return JSON.parse(await readFile(join(dest, 'data.json'), 'utf8')) },
    /** @param {string} name @param {InputEvent['type']} [type] @returns {InputEvent} */
    event: (name, type = 'change') => ({ type, filepath: join(src, name) }),
    /** @param {InputEvent[]} events */
    async rebuild (events) {
      const count = (await calls()).length
      emit(events)
      await nextTurn()
      await dom.settled()
      const added = (await calls()).slice(count)
      assert.equal(added.length, 1, 'one producer invocation per event batch')
      const call = added[0]
      assert.ok(call)
      return call
    },
    async start () {
      const report = await dom.watch({ serve: false })
      assert.deepEqual(report.pageBuildResults?.errors, [], 'initial page build succeeded')
      return report
    },
  }
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
  assert.deepEqual(call.upserted, [...upserted].sort())
  assert.deepEqual(call.removed, [...removed].sort())
}

/** @param {ProducerCall | undefined} call @returns {asserts call is ProducerCall} */
export function assertReset (call) {
  assert.ok(call)
  assert.equal(call.kind, 'reset')
  assert.equal(call.previousKeys, null)
}
