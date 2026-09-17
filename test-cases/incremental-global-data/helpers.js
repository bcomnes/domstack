/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @import { IndexRow } from './fixtures/global.data.js'
 * @typedef {{ type: 'added' | 'removed' | 'change', filepath: string }} InputEvent
 * @typedef {object} ProducerCall
 * @property {'reset' | 'delta'} kind
 * @property {string} [reason]
 * @property {InputEvent[]} events
 * @property {string[]} upserted Source-root-relative IDs.
 * @property {string[]} removed
 * @property {string[]} rendered
 * @property {string[] | null} previousKeys
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'
import pino from 'pino'
import { DomStack } from '../../index.js'
import { startWatch } from '../../lib/watch/test-helpers.js'

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
 * Deterministic tests mock only source event delivery; native tests use real watchers.
 * Builds, workers, rendering and cleanup are real in both modes.
 * @param {TestContext} t
 * @param {{ native?: boolean, files?: Record<string, string> }} [options]
 */
export async function fixture (t, { native = false, files = {} } = {}) {
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
  if (!native) {
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
  }
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
  await cp(new URL('./fixtures/', import.meta.url), src, { recursive: true })
  const defaults = {
    'a/page.md': article('Alpha'),
    'b/page.md': article('Beta'),
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
      const report = native ? await startWatch(t, dom, src) : await dom.watch({ serve: false })
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
