/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @import { Worker } from 'node:worker_threads'
 * @typedef {{ warm: number, stop: number, close: number }} PoolCalls
 * @typedef {{ worker: Worker, ready: Promise<unknown[]>, dispatches: number, terminations: number }} WorkerRecord
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fsPromises, { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'
import workerThreads from 'node:worker_threads'
import chokidar from 'chokidar'
import pino from 'pino'
import { DomStack } from '../../../index.js'
import { PageWorkerPool } from '../../build-pages/worker/page-worker-pool.js'

const options = { timeout: 30_000 }

/** @param {() => boolean | Promise<boolean>} check */
async function until (check) {
  for (let attempt = 0; !await check(); attempt++) {
    assert.ok(attempt < 500, 'timed out waiting for lifecycle checkpoint')
    await delay(10)
  }
}

/** @param {Promise<unknown>} promise */
async function assertPending (promise) {
  let settled = false
  promise.then(() => { settled = true }, () => { settled = true })
  await setImmediate()
  assert.equal(settled, false, 'shutdown must wait for owned work/resources')
}

/** @param {TestContext} t */
function observePools (t) {
  /** @type {Map<PageWorkerPool, PoolCalls>} */
  const pools = new Map()
  for (const [method, counter] of /** @type {const} */ ([['warm', 'warm'], ['stopWarming', 'stop'], ['close', 'close']])) {
    const original = PageWorkerPool.prototype[method]
    t.mock.method(PageWorkerPool.prototype, method, /** @this {PageWorkerPool} */ function () {
      const calls = pools.get(this) ?? { warm: 0, stop: 0, close: 0 }
      pools.set(this, calls)
      calls[counter]++
      return original.call(this)
    })
  }
  return pools
}

/** @param {TestContext} t */
function observeWorkers (t) {
  const OriginalWorker = workerThreads.Worker
  /** @type {WorkerRecord[]} */
  const workers = []
  const probe = {
    workers,
    /** @type {((record: WorkerRecord) => void) | undefined} */
    onCreate: undefined,
  }
  // Replace the default export's constructor, then synchronize the named binding.
  // All workers still run the real bootstrap, protocol and application code.
  const mock = t.mock.method(workerThreads, 'Worker', class extends OriginalWorker {
    /** @param {ConstructorParameters<typeof Worker>} args */
    constructor (...args) {
      super(...args)
      if (String(args[0]) !== new URL('../../build-pages/worker/worker.js', import.meta.url).href) return
      const ready = once(this, 'message')
      ready.catch(() => {})
      /** @type {WorkerRecord} */
      const record = { worker: this, ready, dispatches: 0, terminations: 0 }
      workers.push(record)
      const postMessage = this.postMessage.bind(this)
      /** @param {Parameters<Worker['postMessage']>} args */
      const dispatch = (...args) => {
        record.dispatches++
        return postMessage(...args)
      }
      t.mock.method(record.worker, 'postMessage', dispatch)
      const terminate = this.terminate.bind(this)
      t.mock.method(record.worker, 'terminate', () => {
        record.terminations++
        return terminate()
      })
      probe.onCreate?.(record)
    }
  })
  syncBuiltinESMExports()
  // Restore explicitly: Node's automatic mock restoration does not synchronize ESM.
  t.after(() => {
    mock.mock.restore()
    syncBuiltinESMExports()
  })
  return probe
}

/** @param {WorkerRecord[]} workers @param {number} index */
function at (workers, index) {
  const record = workers[index]
  assert.ok(record, `expected page worker ${index}`)
  return record
}

/** @param {Map<PageWorkerPool, PoolCalls>} pools @param {number} [index] */
function callsAt (pools, index = 0) {
  const calls = [...pools.values()][index]
  assert.ok(calls, `expected pool ${index}`)
  return calls
}

/** @param {WorkerRecord[]} workers */
function assertRetired (workers) {
  assert.ok(workers.length)
  for (const { worker, terminations } of workers) {
    assert.equal(worker.threadId, -1, 'public completion follows actual worker exit')
    assert.equal(terminations, 1)
  }
}

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(import.meta.dirname, '.tmp-prewarmed-'))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  await mkdir(src)
  await Promise.all(Object.entries({
    'audit.js': "import { appendFileSync } from 'node:fs'; import { isMainThread } from 'node:worker_threads'; export default name => { if (!isMainThread) appendFileSync(new URL('../imports.log', import.meta.url), name + '\\n') }",
    'global.vars.js': "import mark from './audit.js'; mark('vars'); export default { layout: 'root' }",
    'root.layout.js': "import mark from './audit.js'; mark('layout'); export default ({ children }) => children",
    'value.js': "export default 'initial'",
    'page.js': "import mark from './audit.js'; import value from './value.js'; mark('page'); export default () => value",
  }).map(([name, content]) => writeFile(join(src, name), content)))
  const dom = new DomStack(src, dest, { logger: pino({ level: 'silent' }) })
  /** @type {{ watcher: FSWatcher, emit: FSWatcher['emit'] }[]} */
  const watchers = []
  const watch = chokidar.watch
  /** @param {Parameters<typeof watch>} args */
  const controlledWatch = (...args) => {
    const watcher = watch(...args)
    if (args[0] === src) {
      const emit = watcher.emit.bind(watcher)
      watchers.push({ watcher, emit })
      // Preserve native readiness, membership and closure; deliver edits explicitly.
      /** @param {Parameters<typeof emit>} args */
      const controlledEmit = (...args) => {
        if (typeof args[0] === 'string' && ['add', 'change', 'unlink', 'all'].includes(args[0])) return false
        return emit(...args)
      }
      t.mock.method(watcher, 'emit', controlledEmit)
    }
    return watcher
  }
  t.mock.method(chokidar, 'watch', controlledWatch)
  t.after(async () => {
    // Also release a real page render if an assertion failed while it was held.
    await writeFile(join(root, 'release'), '')
    try {
      if (dom.watching) await dom.stopWatching()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  return {
    root,
    src,
    dest,
    dom,
    watchers,
    /** @param {'add' | 'change'} [event] @param {string} [name] */
    emit (event = 'change', name = 'page.js') {
      const source = watchers.at(-1)
      assert.ok(source)
      source.emit(event, join(src, name))
    },
    imports: () => readFile(join(root, 'imports.log'), 'utf8'),
    output: () => readFile(join(dest, 'index.html'), 'utf8'),
  }
}

/** @param {TestContext} t @param {string} dest */
function pausePreparation (t, dest) {
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const original = fsPromises.mkdir
  let held = false
  /** @param {Parameters<typeof original>} args */
  const gatedMkdir = async (...args) => {
    if (String(args[0]) === dest && !held) {
      held = true
      entered.resolve(undefined)
      await release.promise
    }
    return Reflect.apply(original, fsPromises, args)
  }
  const mock = t.mock.method(fsPromises, 'mkdir', gatedMkdir)
  syncBuiltinESMExports()
  return {
    entered: entered.promise,
    release () {
      release.resolve(undefined)
      mock.mock.restore()
      syncBuiltinESMExports()
    },
  }
}

/** @param {Awaited<ReturnType<typeof fixture>>} site */
async function installGatedPage (site) {
  await writeFile(join(site.src, 'page.js'), `import { existsSync, appendFileSync, writeFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
export default async () => {
  const root = new URL('../', import.meta.url)
  appendFileSync(new URL('runs', root), 'run\\n')
  if (existsSync(new URL('block', root))) {
    writeFileSync(new URL('entered', root), '')
    while (!existsSync(new URL('release', root))) await setTimeout(10)
  }
  return 'drained'
}
`)
}

/** @param {Awaited<ReturnType<typeof fixture>>} site */
async function pageEntered (site) {
  await until(() => access(join(site.root, 'entered')).then(() => true, () => false))
}

test('watch warms one unused worker at idle and replenishes only after a fresh build retires', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  const report = await site.dom.watch({ serve: false })
  assert.deepEqual(report.pageBuildResults?.errors, [])
  assert.equal(await site.output(), 'initial')
  assert.equal(callsAt(pools).warm, 1)
  assert.equal(workers.length, 2)
  assertRetired(workers.slice(0, 1))
  const initialImports = await site.imports()
  assert.deepEqual(initialImports.trim().split('\n').sort(), ['layout', 'page', 'vars'])
  assert.deepEqual(await at(workers, 1).ready, [{ type: 'ready' }])
  assert.equal(at(workers, 1).dispatches, 0)
  assert.equal(await site.imports(), initialImports, 'idle readiness imports no application modules')

  await writeFile(join(site.src, 'value.js'), "export default 'edited while idle'")
  site.emit()
  await site.dom.settled()
  assert.equal(await site.output(), 'edited while idle')
  assert.equal(at(workers, 1).dispatches, 1, 'the speculative worker serves the next real build')
  assertRetired(workers.slice(0, 2))
  assert.equal(workers.length, 3)
  assert.equal(callsAt(pools).warm, 2)
  await at(workers, 2).ready
  assert.equal(at(workers, 2).dispatches, 0)
  assert.equal((await site.imports()).trim().split('\n').length, 6)
  await site.dom.stopWatching()
  assert.equal(pools.size, 1)
  assert.equal(callsAt(pools).close, 1)
  assertRetired(workers)
  assert.ok(site.watchers.every(({ watcher }) => watcher.closed))
})

test('startup events and events queued during a build warm only after the entire drain', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  await installGatedPage(site)
  await site.dom.watch({
    serve: false,
    async onInitialBuild () {
      await writeFile(join(site.root, 'block'), '')
      site.emit()
    },
  })
  await pageEntered(site)
  assert.equal(pools.size, 0, 'pending startup events bypass the initial warm call')
  assert.equal(workers.length, 2)
  site.emit()
  await writeFile(join(site.root, 'release'), '')
  await site.dom.settled()
  assert.equal(await readFile(join(site.root, 'runs'), 'utf8'), 'run\nrun\nrun\n')
  assert.equal(callsAt(pools).warm, 1, 'no speculative slot is created between queued builds')
  assert.equal(workers.length, 4)
  assertRetired(workers.slice(0, 3))
  await at(workers, 3).ready
  assert.equal(at(workers, 3).dispatches, 0)
  await site.dom.stopWatching()
  assertRetired(workers)
})

test('stopping before startup page dispatch disables warming but drains the initial build', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  const gate = pausePreparation(t, site.dest)
  let callbacks = 0
  const starting = site.dom.watch({ serve: false, onInitialBuild () { callbacks++ } })
  try {
    await gate.entered
    assert.equal(workers.length, 0)
    const stopping = site.dom.stopWatching()
    assert.deepEqual(callsAt(pools), { warm: 0, stop: 1, close: 0 })
    await assertPending(stopping)
    gate.release()
    const [report] = await Promise.all([starting, stopping])
    assert.deepEqual(report.pageBuildResults?.errors, [])
    assert.equal(await site.output(), 'initial')
    assert.equal(callbacks, 0)
    assert.equal(callsAt(pools).warm, 0)
    assert.equal(callsAt(pools).close, 1)
    assert.equal(workers.length, 1)
    assertRetired(workers)
  } finally {
    gate.release()
    await starting
  }
})

test('stopping an active warmed build drains it without replenishing or dispatching queued work', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  await installGatedPage(site)
  await site.dom.watch({ serve: false })
  await at(workers, 1).ready
  await writeFile(join(site.root, 'block'), '')
  site.emit()
  await pageEntered(site)
  site.emit()
  const stopping = site.dom.stopWatching()
  assert.deepEqual(callsAt(pools), { warm: 1, stop: 1, close: 0 })
  await until(() => site.watchers.every(({ watcher }) => watcher.closed))
  await assertPending(stopping)
  assert.equal(callsAt(pools).close, 0, 'pool close waits for the active build lock')
  assert.notEqual(at(workers, 1).worker.threadId, -1)
  await writeFile(join(site.root, 'release'), '')
  await stopping
  assert.equal(await site.output(), 'drained')
  assert.equal(await readFile(join(site.root, 'runs'), 'utf8'), 'run\nrun\n')
  assert.equal(callsAt(pools).warm, 1)
  assert.equal(callsAt(pools).close, 1)
  assert.equal(workers.length, 2)
  assertRetired(workers)
})

test('stopping structural preparation retires speculation but permits the draining page dispatch', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  await site.dom.watch({ serve: false })
  await at(workers, 1).ready
  await writeFile(join(site.src, 'added.md'), '# Added')
  const gate = pausePreparation(t, site.dest)
  try {
    site.emit('add', 'added.md')
    await gate.entered
    assert.equal(at(workers, 1).dispatches, 0)
    const stopping = site.dom.stopWatching()
    assert.deepEqual(callsAt(pools), { warm: 1, stop: 1, close: 0 })
    await until(() => at(workers, 1).worker.threadId === -1)
    await assertPending(stopping)
    assert.equal(callsAt(pools).close, 0, 'pool stays open until structural preparation dispatches')
    gate.release()
    await stopping
    assert.match(await readFile(join(site.dest, 'added.html'), 'utf8'), /Added/)
    assert.equal(workers.length, 3, 'draining preparation can acquire a non-speculative worker')
    assert.equal(at(workers, 2).dispatches, 1)
    assert.equal(callsAt(pools).warm, 1)
    assert.equal(callsAt(pools).close, 1)
    assertRetired(workers)
  } finally {
    gate.release()
  }
})

test('a retired session callback and source events cannot warm or close its replacement', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const starting = site.dom.watch({
    serve: false,
    async onInitialBuild () {
      entered.resolve(undefined)
      await release.promise
      throw new Error('late callback failure')
    },
  })
  const rejected = assert.rejects(starting, /late callback failure/)
  try {
    await entered.promise
    const oldSource = site.watchers[0]
    assert.ok(oldSource)
    await site.dom.stopWatching()
    const oldCalls = callsAt(pools)
    assert.equal(oldCalls.warm, 0)
    assertRetired(workers)
    await site.dom.watch({ serve: false })
    assert.equal(pools.size, 2)
    const replacement = callsAt(pools, 1)
    assert.equal(replacement.warm, 1)
    release.resolve(undefined)
    await rejected
    oldSource.emit('change', join(site.src, 'page.js'))
    await site.dom.settled()
    assert.equal(oldCalls.warm, 0)
    assert.equal(oldCalls.close, 1)
    assert.deepEqual(replacement, { warm: 1, stop: 0, close: 0 })
    assert.equal(site.dom.watching, true)
    site.emit()
    await site.dom.settled()
    assert.equal(replacement.warm, 2)
    await site.dom.stopWatching()
    assert.equal(oldCalls.warm, 0)
    assertRetired(workers)
  } finally {
    release.resolve(undefined)
    await rejected
  }
})

test('independent watch sessions own separate idle workers and stopping one leaves the other usable', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const first = await fixture(t)
  const second = await fixture(t)
  await first.dom.watch({ serve: false })
  const firstCalls = callsAt(pools)
  const firstWorkers = workers.slice()
  await second.dom.watch({ serve: false })
  const secondCalls = callsAt(pools, 1)
  const secondIdle = at(workers, 3)
  await secondIdle.ready
  await first.dom.stopWatching()
  assertRetired(firstWorkers)
  assert.deepEqual(secondCalls, { warm: 1, stop: 0, close: 0 })
  assert.notEqual(secondIdle.worker.threadId, -1)
  await writeFile(join(second.src, 'value.js'), "export default 'second still works'")
  second.emit()
  await second.dom.settled()
  assert.equal(await second.output(), 'second still works')
  assert.equal(secondIdle.dispatches, 1)
  assert.equal(firstCalls.warm, 1)
  assert.equal(secondCalls.warm, 2)
  assert.equal(pools.size, 2)
  await second.dom.stopWatching()
  assertRetired(workers)
})

test('an awaited callback-requested stop retires the initial worker without ever warming', options, async t => {
  const pools = observePools(t)
  const { workers } = observeWorkers(t)
  const site = await fixture(t)
  let callbacks = 0
  await site.dom.watch({
    serve: false,
    async onInitialBuild () {
      callbacks++
      assert.equal(pools.size, 0)
      assertRetired(workers)
      await site.dom.stopWatching()
      assertRetired(workers)
    },
  })
  assert.equal(callbacks, 1)
  assert.equal(site.dom.watching, false)
  assert.equal(callsAt(pools).warm, 0)
  assert.equal(callsAt(pools).close, 1)
  assert.equal(workers.length, 1)
})

test('stopping a still-warming worker waits for actual retirement, not merely a close call', options, async t => {
  const pools = observePools(t)
  const probe = observeWorkers(t)
  const site = await fixture(t)
  const warming = Promise.withResolvers()
  const release = Promise.withResolvers()
  probe.onCreate = ({ worker }) => {
    if (probe.workers.length !== 2) return
    const emit = worker.emit.bind(worker)
    /** @param {Parameters<typeof emit>} args */
    const holdReady = (...args) => {
      if (args[0] === 'message' && args[1]?.type === 'ready') {
        warming.resolve(undefined)
        return false
      }
      return emit(...args)
    }
    t.mock.method(worker, 'emit', holdReady)
    const terminate = worker.terminate.bind(worker)
    t.mock.method(worker, 'terminate', async () => {
      await release.promise
      return terminate()
    })
  }
  try {
    await site.dom.watch({ serve: false })
    await warming.promise
    const idle = at(probe.workers, 1)
    assert.equal(idle.dispatches, 0)
    const stopping = site.dom.stopWatching()
    assert.equal(callsAt(pools).stop, 1, 'speculation stops synchronously')
    await until(() => callsAt(pools).close === 1)
    await assertPending(stopping)
    assert.notEqual(idle.worker.threadId, -1, 'the withheld termination still owns a live worker')
    assert.ok(site.watchers.every(({ watcher }) => watcher.closed))
    release.resolve(undefined)
    await stopping
    assert.equal(callsAt(pools).warm, 1)
    assertRetired(probe.workers)
    assert.equal(site.dom.watching, false)
  } finally {
    release.resolve(undefined)
  }
})
