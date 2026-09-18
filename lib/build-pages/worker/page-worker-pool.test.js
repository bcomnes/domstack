/**
 * @import { TestContext } from 'node:test'
 * @import { WorkerOptions } from 'node:worker_threads'
 * @import { SiteData } from '../../builder.js'
 * @import { BuildPagesOptions } from '../index.js'
 * @import { WorkerBuildMessage, WorkerResultMessage } from './protocol.js'
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { identifyPages } from '../../identify-pages.js'
import { PageWorkerPool } from './page-worker-pool.js'
import { DomStackDataError } from '../../helpers/domstack-error.js'
import { PageOutputLedger } from '../../watch/page-output-ledger.js'
import { workerResultTransportFailure } from './protocol.js'

const workerURL = new URL('./worker.js', import.meta.url)
const emptySite = /** @type {SiteData} */ ({})
/** @returns {WorkerResultMessage} */
const success = () => ({
  type: 'result',
  result: { type: 'page', report: { pages: [], templates: [] }, outputs: [], warnings: [], errors: [] },
})

class FakeWorker extends EventEmitter {
  /** @type {WorkerBuildMessage[]} */
  messages = []
  /** @type {PromiseWithResolvers<WorkerBuildMessage>} */
  posted = Promise.withResolvers()
  /** @type {PromiseWithResolvers<number>} */
  termination = Promise.withResolvers()
  terminateCalls = 0
  /** @type {Error | undefined} */
  cloneError

  /** @param {WorkerBuildMessage} message */
  postMessage (message) {
    if (this.cloneError) throw this.cloneError
    this.messages.push(message)
    this.posted.resolve(message)
  }

  terminate () {
    this.terminateCalls++
    return this.termination.promise
  }

  finishTermination () {
    this.emit('exit', 1)
    this.termination.resolve(1)
  }
}

/** @param {TestContext} t */
function fakePool (t) {
  /** @type {FakeWorker[]} */
  const workers = []
  /** @type {{ url: URL, options: WorkerOptions, cwd: string }[]} */
  const starts = []
  const pool = new PageWorkerPool({
    workerURL,
    workerFactory (url, options) {
      const worker = new FakeWorker()
      workers.push(worker)
      starts.push({ url, options, cwd: process.cwd() })
      return /** @type {Worker} */ (/** @type {unknown} */ (worker))
    },
  })
  t.after(async () => {
    // Release controlled barriers even when an assertion fails.
    for (const worker of workers) {
      if (worker.listenerCount('error')) worker.emit('error', new Error('Test cleanup'))
      worker.finishTermination()
    }
    await pool.close().catch(() => {})
  })
  /** @param {number} [index] */
  function at (index = workers.length - 1) {
    const worker = workers[index]
    assert.ok(worker, `worker ${index} exists`)
    return worker
  }
  return { pool, workers, starts, at }
}

/** @param {Promise<unknown>} promise */
async function assertPending (promise) {
  let settled = false
  promise.then(() => { settled = true }, () => { settled = true })
  await turn()
  assert.equal(settled, false, 'must wait for the controlled barrier')
}

/** @param {FakeWorker} worker */
async function complete (worker) {
  worker.emit('message', { type: 'ready' })
  await worker.posted.promise
  worker.emit('message', success())
  worker.finishTermination()
}

test('warming reserves one slot; dispatch waits for ready and a result waits for termination', { timeout: 5000 }, async t => {
  const { pool, workers, starts, at } = fakePool(t)
  assert.equal(workers.length, 0, 'construction is lazy')
  assert.equal(pool.warm(), undefined)
  pool.warm()
  const worker = at()
  const opts = { buildDrafts: true, pageFilterPaths: ['/src/page.js'], onBuild: () => {} }
  const build = pool.build('/src', '/dest', emptySite, opts)
  pool.warm()
  assert.equal(workers.length, 1, 'consuming a starting slot does not enable more speculation')
  assert.equal(worker.messages.length, 0)
  worker.emit('message', { type: 'ready' })
  await worker.posted.promise
  const [message] = worker.messages
  assert.ok(message)
  assert.equal(message.type, 'build')
  assert.equal(message.src, '/src')
  assert.equal(message.dest, '/dest')
  assert.equal(message.siteData, emptySite)
  assert.equal(message.opts.buildDrafts, true)
  assert.deepEqual(message.opts.pageFilterPaths, opts.pageFilterPaths)
  assert.equal(Object.hasOwn(message.opts, 'onBuild'), false)
  assert.equal(starts[0]?.url, workerURL)
  pool.warm()
  assert.equal(workers.length, 1, 'no warming during an active job')

  const result = success()
  worker.emit('message', result)
  worker.emit('message', { type: 'result', result: null })
  worker.emit('error', new Error('Late error while terminating'))
  worker.emit('messageerror', new Error('Late deserialize error'))
  worker.emit('exit', 0)
  pool.warm()
  assert.equal(workers.length, 1, 'a retiring worker still owns its slot')
  await assertPending(build)
  assert.equal(worker.terminateCalls, 1)
  worker.finishTermination()
  assert.deepEqual(await build, result.result, 'late events cannot replace the accepted result')
  assert.equal(worker.listenerCount('message'), 0)
  assert.equal(worker.listenerCount('error'), 0)
  pool.warm()
  assert.equal(workers.length, 2, 'only an explicit warm starts a replacement')
})

test('protocol and transport failures reject and await retirement before or after readiness', { timeout: 5000 }, async t => {
  const original = new Error('Worker crashed')
  const deserialize = new Error('Bad wire data')
  /** @type {{ name: string, running: boolean, event: string, value: unknown, expected: RegExp | Error }[]} */
  const cases = [
    { name: 'error before ready', running: false, event: 'error', value: original, expected: original },
    { name: 'error before result', running: true, event: 'error', value: original, expected: original },
    { name: 'exit zero before ready', running: false, event: 'exit', value: 0, expected: /exit code 0/ },
    { name: 'exit zero before result', running: true, event: 'exit', value: 0, expected: /exit code 0/ },
    { name: 'result before ready', running: false, event: 'message', value: success(), expected: /protocol/ },
    { name: 'malformed ready', running: false, event: 'message', value: null, expected: /protocol/ },
    { name: 'duplicate ready after dispatch', running: true, event: 'message', value: { type: 'ready' }, expected: /result message/ },
    { name: 'malformed result', running: true, event: 'message', value: { type: 'result', result: { type: 'page' } }, expected: /result message/ },
    { name: 'messageerror before ready', running: false, event: 'messageerror', value: deserialize, expected: /deserialized/ },
    { name: 'messageerror before result', running: true, event: 'messageerror', value: deserialize, expected: /deserialized/ },
  ]
  for (const scenario of cases) {
    await t.test(scenario.name, async t => {
      const { pool, at, workers } = fakePool(t)
      const build = pool.build('/src', '/dest', emptySite, {})
      const rejected = assert.rejects(build, error => {
        assert.ok(error instanceof Error)
        if (scenario.expected instanceof Error) assert.equal(error, scenario.expected)
        else assert.match(error.message, scenario.expected)
        if (scenario.event === 'messageerror') assert.equal(error.cause, deserialize)
        return true
      })
      const worker = at()
      if (scenario.running) {
        worker.emit('message', { type: 'ready' })
        await worker.posted.promise
      }
      worker.emit(scenario.event, scenario.value)
      await assertPending(build)
      pool.warm()
      assert.equal(workers.length, 1)
      worker.finishTermination()
      await rejected
      assert.equal(worker.terminateCalls, 1)
      await turn()
      assert.equal(workers.length, 1, 'failure does not respawn')
    })
  }
})

test('a synchronous postMessage clone failure is preserved and still awaits termination', { timeout: 5000 }, async t => {
  const { pool, at } = fakePool(t)
  const build = pool.build('/src', '/dest', emptySite, {})
  const worker = at()
  const error = new DOMException('Uncloneable input', 'DataCloneError')
  worker.cloneError = error
  const rejected = assert.rejects(build, actual => actual === error)
  worker.emit('message', { type: 'ready' })
  await assertPending(build)
  assert.equal(worker.terminateCalls, 1)
  worker.finishTermination()
  await rejected
})

test('speculative failures are observed without respawn, including duplicate readiness and constructor throws', { timeout: 5000 }, async t => {
  /** @type {unknown[]} */
  const unhandled = []
  /** @param {unknown} error */
  const onUnhandled = error => { unhandled.push(error) }
  process.on('unhandledRejection', onUnhandled)
  t.after(() => { process.off('unhandledRejection', onUnhandled) })
  const { pool, at, workers } = fakePool(t)
  pool.warm()
  const worker = at()
  worker.emit('message', { type: 'ready' })
  worker.emit('message', { type: 'ready' })
  await turn()
  assert.equal(worker.terminateCalls, 1)
  pool.warm()
  assert.equal(workers.length, 1)
  const build = pool.build('/src', '/dest', emptySite, {})
  await assertPending(build)
  assert.equal(workers.length, 1, 'demand waits for failed speculation to retire')
  worker.finishTermination()
  await turn()
  assert.equal(workers.length, 2, 'demand gets a fresh worker after speculative failure')
  await complete(at())
  await build
  await turn()
  assert.equal(workers.length, 2)

  let constructions = 0
  const failure = new Error('Cannot construct worker')
  const broken = new PageWorkerPool({ workerFactory () { constructions++; throw failure } })
  broken.warm()
  await turn()
  await turn()
  assert.equal(constructions, 1)
  await assert.rejects(broken.build('/src', '/dest', emptySite, {}), error => error === failure)
  await broken.close()
  assert.equal(constructions, 2)
  assert.deepEqual(unhandled, [])
})

test('context is rechecked after readiness, including full env additions, deletions and same-size replacement', { timeout: 5000 }, async t => {
  const key = 'DOMSTACK_POOL_TEST_CONTEXT'
  const other = 'DOMSTACK_POOL_TEST_CONTEXT_OTHER'
  const saved = { [key]: process.env[key], [other]: process.env[other] }
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  for (const change of ['addition', 'deletion', 'value', 'same-size replacement']) {
    await t.test(change, async t => {
      delete process.env[key]
      delete process.env[other]
      if (change !== 'addition') process.env[key] = 'before'
      const { pool, at, starts, workers } = fakePool(t)
      pool.warm()
      const stale = at()
      const build = pool.build('/src', '/dest', emptySite, {})
      if (change === 'deletion' || change === 'same-size replacement') delete process.env[key]
      else process.env[key] = 'after'
      if (change === 'same-size replacement') process.env[other] = 'after'
      stale.emit('message', { type: 'ready' })
      await assertPending(build)
      assert.deepEqual(stale.messages, [], 'stale context never receives application code')
      assert.equal(stale.terminateCalls, 1)
      pool.warm()
      assert.equal(workers.length, 1)
      stale.finishTermination()
      await turn()
      assert.equal(workers.length, 2)
      assert.deepEqual(starts[1]?.options.env, { ...process.env }, 'replacement inherits the entire current environment')
      await complete(at())
      await build
    })
  }
})

test('CWD changes while waiting for ready retire the stale worker before dispatch', { timeout: 5000 }, async t => {
  const cwd = process.cwd()
  const tmp = await mkdtemp(join(import.meta.dirname, '.tmp-pool-cwd-'))
  t.after(async () => { process.chdir(cwd); await rm(tmp, { recursive: true, force: true }) })
  const { pool, at, starts } = fakePool(t)
  pool.warm()
  const stale = at()
  const build = pool.build('/src', '/dest', emptySite, {})
  process.chdir(tmp)
  stale.emit('message', { type: 'ready' })
  await assertPending(build)
  assert.deepEqual(stale.messages, [])
  stale.finishTermination()
  await turn()
  assert.equal(starts[1]?.cwd, tmp)
  await complete(at())
  await build
})

test('option getters cannot change context between its final validation and dispatch', { timeout: 5000 }, async t => {
  const key = 'DOMSTACK_POOL_TEST_GETTER'
  const saved = process.env[key]
  delete process.env[key]
  t.after(() => {
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
  })
  const { pool, at, starts } = fakePool(t)
  const build = pool.build('/src', '/dest', emptySite, {
    get buildDrafts () { process.env[key] = 'changed'; return true },
  })
  const stale = at()
  stale.emit('message', { type: 'ready' })
  await assertPending(build)
  assert.deepEqual(stale.messages, [])
  stale.finishTermination()
  await turn()
  assert.equal(/** @type {NodeJS.ProcessEnv} */ (starts[1]?.options.env)?.[key], 'changed')
  await complete(at())
  await build
})

test('stopWarming retires unused speculation but permits a draining pipeline to build', { timeout: 5000 }, async t => {
  const { pool, at, workers } = fakePool(t)
  pool.warm()
  const idle = at()
  pool.stopWarming()
  pool.stopWarming()
  pool.warm()
  assert.equal(workers.length, 1)
  assert.equal(idle.terminateCalls, 1)
  const build = pool.build('/src', '/dest', emptySite, {})
  await complete(at())
  await build
  assert.equal(workers.length, 2)
  pool.warm()
  assert.equal(workers.length, 2, 'stopWarming remains in effect after a build')
  const closing = pool.close()
  assert.equal(pool.close(), closing)
  await assertPending(closing)
  idle.finishTermination()
  await closing
})

test('close drains accepted builds through readiness and termination, rejecting new builds', { timeout: 5000 }, async t => {
  const { pool, at, workers } = fakePool(t)
  pool.warm()
  const build = pool.build('/src', '/dest', emptySite, {})
  const worker = at()
  const closing = pool.close()
  assert.equal(pool.close(), closing)
  await assert.rejects(pool.build('/src', '/other', emptySite, {}), /closed/)
  pool.warm()
  await assertPending(closing)
  assert.equal(worker.terminateCalls, 0, 'closing cannot terminate accepted work before its result')
  worker.emit('message', { type: 'ready' })
  await worker.posted.promise
  worker.emit('message', success())
  await assertPending(closing)
  worker.finishTermination()
  await Promise.all([build, closing])
  assert.equal(workers.length, 1)
  assert.equal(worker.terminateCalls, 1)
  assert.equal(pool.close(), closing)
})

const preloadFlags = ['--import', '--require', '-r', '--loader', '--experimental-loader', '--experimental_loader']

test('startup imports suppress speculation for execArgv and quoted NODE_OPTIONS forms without disabling builds', { timeout: 5000 }, async t => {
  const savedArgs = process.execArgv
  const savedOptions = process.env['NODE_OPTIONS']
  t.after(() => {
    process.execArgv = savedArgs
    if (savedOptions === undefined) delete process.env['NODE_OPTIONS']
    else process.env['NODE_OPTIONS'] = savedOptions
  })
  for (const flag of preloadFlags) {
    const attached = `${flag}${flag === '-r' ? '' : '='}./preload.cjs`
    for (const source of ['execArgv', 'NODE_OPTIONS']) {
      await t.test(`${source}: ${flag}`, async t => {
        const forms = source === 'execArgv'
          ? [[flag, './preload.cjs'], [attached]]
          : [[`${flag} ./preload.cjs`], [attached], [`"${flag}" "./preload with spaces.cjs"`], [`"${flag}${flag === '-r' ? '' : '='}./preload with spaces.cjs"`]]
        for (const form of forms) {
          process.execArgv = source === 'execArgv' ? form : []
          if (source === 'NODE_OPTIONS') process.env['NODE_OPTIONS'] = `--no-warnings ${form[0]}`
          else delete process.env['NODE_OPTIONS']
          const { pool, workers, starts, at } = fakePool(t)
          pool.warm()
          pool.warm()
          assert.equal(workers.length, 0, `must not speculate with ${form.join(' ')}`)
          const build = pool.build('/src', '/dest', emptySite, {})
          assert.equal(workers.length, 1, 'explicit builds still create a worker')
          assert.equal(Object.hasOwn(starts[0]?.options ?? {}, 'execArgv'), false, 'let Node inherit process flags')
          assert.deepEqual(starts[0]?.options.env, { ...process.env }, 'NODE_OPTIONS is not stripped')
          await complete(at())
          assert.deepEqual(await build, success().result)
          assert.deepEqual(process.execArgv, source === 'execArgv' ? form : [])
          pool.warm()
          assert.equal(workers.length, 1, 'preload flags continue to suppress speculative replacement')
          await pool.close()
        }
      })
    }
  }
  process.execArgv = ['--trace-warnings']
  process.env['NODE_OPTIONS'] = '--no-warnings'
  const { pool, workers } = fakePool(t)
  pool.warm()
  assert.equal(workers.length, 1, 'unrelated flags do not disable warming')
})

/** @param {TestContext} t @param {Record<string, string>} [files] */
async function realPool (t, files = {}) {
  const tmp = await mkdtemp(join(import.meta.dirname, '.tmp-pool-'))
  const src = join(tmp, 'src')
  const dest = join(tmp, 'output')
  await mkdir(src)
  await mkdir(dest)
  /** @type {{ worker: Worker, ready: Promise<unknown[]> }[]} */
  const workers = []
  const pool = new PageWorkerPool({
    workerFactory (url, options) {
      const worker = new Worker(url, options)
      const ready = once(worker, 'message')
      ready.catch(() => {})
      workers.push({ worker, ready })
      return worker
    },
  })
  t.after(async () => {
    try { await pool.close() } finally { await rm(tmp, { recursive: true, force: true }) }
  })
  for (const [name, contents] of Object.entries({
    'global.vars.js': "export default { layout: 'root' }",
    'root.layout.js': 'export default ({ children }) => children',
    'page.js': "export default () => 'ok'",
    ...files,
  })) await writeFile(join(src, name), contents)
  /** @param {BuildPagesOptions} [opts] @param {SiteData} [site] */
  const build = async (opts = {}, site) => pool.build(src, dest, site ?? await identifyPages(src), opts)
  async function warm () {
    pool.warm()
    const latest = workers.at(-1)
    assert.ok(latest)
    assert.deepEqual(await latest.ready, [{ type: 'ready' }])
    return latest.worker
  }
  return { src, dest, pool, workers, build, warm }
}

test('real warming imports no site code; transitive edits made while idle are fresh for every job', { timeout: 15000 }, async t => {
  const { src, dest, build, warm, workers } = await realPool(t, {
    'audit.js': "import { appendFileSync } from 'node:fs'; export default name => appendFileSync(new URL('./imports.log', import.meta.url), name + '\\n')",
    'leaf.js': "export default 'before'",
    'middle.js': "export { default } from './leaf.js'",
    'global.vars.js': "import mark from './audit.js'; import value from './middle.js'; mark('vars'); export default { layout: 'root', value }",
    'global.data.js': "import mark from './audit.js'; mark('data'); export default {}",
    'root.layout.js': "import mark from './audit.js'; import value from './middle.js'; mark('layout'); export default ({ children }) => value + '|' + children",
    'page.js': "import mark from './audit.js'; import value from './middle.js'; mark('page'); export default ({ vars }) => value + '|' + vars.value",
  })
  for (const value of ['first', 'second']) {
    const worker = await warm()
    const before = await readFile(join(src, 'imports.log'), 'utf8').catch(error => {
      assert.equal(error.code, 'ENOENT')
      return ''
    })
    assert.equal(before.split('\n').filter(Boolean).length, value === 'first' ? 0 : 4)
    await writeFile(join(src, 'leaf.js'), `export default '${value}'`)
    const result = await build()
    assert.deepEqual(result.errors, [])
    assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), `${value}|${value}|${value}`)
    assert.equal(worker.threadId, -1, 'build does not resolve until worker exit')
    const imported = (await readFile(join(src, 'imports.log'), 'utf8')).trim().split('\n')
    assert.deepEqual(imported.slice(-4).sort(), ['data', 'layout', 'page', 'vars'])
  }
  assert.equal(workers.length, 2)
})

test('real worker termination is awaited and stops live application timers', { timeout: 15000 }, async t => {
  const { src, build, warm, pool } = await realPool(t, {
    'page.js': `import { appendFileSync } from 'node:fs'
const tick = () => appendFileSync(new URL('./ticks.log', import.meta.url), 'tick\\n')
tick()
setInterval(tick, 5)
export default async () => { await new Promise(resolve => setTimeout(resolve, 30)); return 'ok' }
`,
  })
  const worker = await warm()
  assert.deepEqual((await build()).errors, [])
  assert.equal(worker.threadId, -1)
  const ticks = await readFile(join(src, 'ticks.log'), 'utf8')
  assert.ok(ticks.length > 0)
  await delay(40)
  assert.equal(await readFile(join(src, 'ticks.log'), 'utf8'), ticks)
  const closing = pool.close()
  assert.equal(pool.close(), closing)
  await closing
})

test('real input clone failures preserve caller state and a subsequent build uses a fresh worker', { timeout: 15000 }, async t => {
  const { src, dest, build, warm, workers } = await realPool(t)
  await writeFile(join(dest, 'sentinel.txt'), 'keep')
  const site = await identifyPages(src)
  const snapshot = structuredClone(site)
  const uncloneable = () => 'caller owned'
  const input = { ...site, uncloneable }
  const worker = await warm()
  await assert.rejects(build({}, input), { name: 'DataCloneError' })
  assert.equal(worker.threadId, -1)
  assert.equal(input.uncloneable, uncloneable)
  assert.deepEqual(site, snapshot)
  assert.equal(await readFile(join(dest, 'sentinel.txt'), 'utf8'), 'keep')
  assert.deepEqual((await build()).errors, [])
  assert.equal(workers.length, 2)
})

test('real result clone failures return a build error rather than hanging or losing existing output', { timeout: 15000 }, async t => {
  const errorURL = new URL('../../helpers/domstack-error.js', import.meta.url).href
  const { dest, build, warm } = await realPool(t, {
    // Domain errors preserve their cause, forcing the result itself to fail cloning.
    'page.js': `import { DomStackDataError } from ${JSON.stringify(errorURL)}
export default () => { throw new DomStackDataError('Uncloneable result', {
  reason: 'MISSING_KEY', consumer: 'Page "page.js"', key: 'missing'
}, { cause: () => {} }) }
`,
  })
  await writeFile(join(dest, 'sentinel.txt'), 'keep')
  const worker = await warm()
  const result = await build()
  assert.equal(result.errors.length, 2, 'transport and application errors both survive')
  const error = result.errors[0]
  assert.ok(error instanceof Error)
  assert.equal(error.name, 'DataCloneError')
  assert.match(error.message, /clone/i)
  const applicationError = result.errors[1]
  assert.ok(applicationError instanceof DomStackDataError)
  assert.match(applicationError.message, /Uncloneable result.*page: "\/"/)
  assert.equal(applicationError.code, 'DOM_STACK_ERROR_DATA')
  assert.deepEqual(applicationError.dataDependency, { reason: 'MISSING_KEY', consumer: 'Page "page.js"', key: 'missing' })
  assert.equal(applicationError.cause, undefined, 'only the uncloneable cause is removed')
  assert.match(applicationError.stack ?? '', /page\.js/)
  assert.equal(worker.threadId, -1)
  assert.equal(await readFile(join(dest, 'sentinel.txt'), 'utf8'), 'keep')
})

test('real uncloneable top-level failures fall back to a serializable error report', { timeout: 15000 }, async t => {
  const { build, warm } = await realPool(t, {
    'global.vars.js': "throw new Error('Uncloneable failure', { cause: () => {} })",
  })
  const worker = await warm()
  const result = await build()
  assert.equal(result.errors.length, 1)
  const error = result.errors[0]
  assert.ok(error instanceof Error)
  assert.match(error.message, /failure could not be serialized/)
  assert.deepEqual(result.outputs, [])
  assert.equal(worker.threadId, -1)
})

test('cold real builds inherit startup imports and loaders from both CLI flags and NODE_OPTIONS', { timeout: 30000 }, async t => {
  const { src, dest } = await realPool(t, {
    'page.js': "export default () => globalThis.__poolPreload ?? 'preload missing'",
    'worker preload.cjs': "globalThis.__poolPreload = 'inherited'",
    'worker loader.mjs': `export async function load (url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (url.endsWith('/page.js')) return { ...result, source: "globalThis.__poolPreload = 'inherited';\\n" + result.source }
  return result
}
`,
  })
  const runner = join(src, 'runner.mjs')
  await writeFile(runner, `import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { PageWorkerPool } from ${JSON.stringify(new URL('./page-worker-pool.js', import.meta.url).href)}
import { identifyPages } from ${JSON.stringify(new URL('../../identify-pages.js', import.meta.url).href)}
let starts = 0
const pool = new PageWorkerPool({ workerFactory (url, options) { starts++; return new Worker(url, options) } })
try {
  pool.warm()
  assert.equal(starts, 0, 'preloads forbid speculative startup')
  const result = await pool.build(${JSON.stringify(src)}, ${JSON.stringify(dest)}, await identifyPages(${JSON.stringify(src)}), {})
  assert.deepEqual(result.errors, [])
  assert.equal(starts, 1)
  assert.equal(await readFile(${JSON.stringify(join(dest, 'index.html'))}, 'utf8'), 'inherited')
  pool.warm()
  assert.equal(starts, 1)
} finally { await pool.close() }
process.stdout.write('inherited cold build passed\\n')
`)
  const run = promisify(execFile)
  for (const flag of preloadFlags) {
    const preload = join(src, flag.includes('loader') ? 'worker loader.mjs' : 'worker preload.cjs')
    const specifier = flag.includes('loader') || flag === '--import' ? pathToFileURL(preload).href : preload
    for (const source of ['execArgv', 'NODE_OPTIONS']) {
      await t.test(`${source}: ${flag}`, async () => {
        const env = { ...process.env }
        delete env['NODE_OPTIONS']
        const args = ['--no-warnings']
        if (source === 'execArgv') {
          if (flag === '--loader') args.push(`${flag}=${specifier}`)
          else args.push(flag, specifier)
        } else {
          env['NODE_OPTIONS'] = flag === '-r' || flag === '--require' || flag === '--experimental-loader'
            ? `"${flag}" "${specifier}"`
            : `${flag}="${specifier}"`
        }
        const { stdout } = await run(process.execPath, [...args, runner], { env, timeout: 10000 })
        assert.equal(stdout, 'inherited cold build passed\n')
      })
    }
  }
})

test('partial result clone failure preserves sidecar ownership and cache for recovery cleanup', { timeout: 15000 }, async t => {
  const errorURL = new URL('../../helpers/domstack-error.js', import.meta.url).href
  const { src, dest, build, warm, workers } = await realPool(t, {
    'page.js': `import { DomStackDataError } from ${JSON.stringify(errorURL)}
export default () => 'main'
export async function * pageOutputs () {
  yield { outputName: 'stale.json', content: 'partial sidecar' }
  throw new DomStackDataError('Hook failed after writing', {
    reason: 'MISSING_KEY', consumer: 'Page "page.js"', key: 'missing'
  }, { cause: () => {} })
}
`,
  })
  const ledger = new PageOutputLedger(dest)
  const sidecar = join(dest, 'stale.json')
  await writeFile(join(dest, 'sentinel.txt'), 'unowned')
  const worker = await warm()
  const partial = await build({ trackWatchDependencies: true })
  assert.equal(worker.threadId, -1)
  assert.equal(partial.errors.length, 2)
  assert.ok(partial.errors[0] instanceof Error)
  assert.equal(partial.errors[0].name, 'DataCloneError')
  const applicationError = partial.errors[1]
  assert.ok(applicationError instanceof DomStackDataError)
  assert.match(applicationError.message, /pageOutputs.*Hook failed after writing/)
  assert.equal(applicationError.cause, undefined)
  assert.deepEqual(applicationError.dataDependency, { reason: 'MISSING_KEY', consumer: 'Page "page.js"', key: 'missing' })
  assert.ok('page' in applicationError)
  assert.deepEqual(applicationError.page, (await identifyPages(src)).pages[0])
  assert.equal(await readFile(sidecar, 'utf8'), 'partial sidecar')
  assert.equal(partial.report.pages.length, 1)
  assert.equal(partial.report.pages[0]?.sourcePageFilePath, join(src, 'page.js'))
  assert.deepEqual(partial.report.pages[0]?.outputs, partial.outputs)
  assert.deepEqual(partial.outputs.map(output => [output.outputRelname, output.kind]), [['stale.json', 'page-output']])
  assert.ok(partial.report.pageOutputCache instanceof Map)
  assert.equal(partial.report.pageOutputCache.size, 1)
  assert.equal(partial.report.pageOutputCache.get(sidecar)?.hash, createHash('sha256').update('partial sidecar').digest('hex'))
  assert.ok(partial.report.pageOutputCache.get(sidecar)?.metadata)
  const snapshot = structuredClone(partial.report)
  ledger.recordWrites(partial)
  assert.deepEqual(partial.report, snapshot, 'recording failed writes preserves the report')
  assert.ok(ledger.cache.has(sidecar))

  await writeFile(join(src, 'page.js'), "export default () => 'recovered'")
  const recovery = await build({ trackWatchDependencies: true, previousPageOutputCache: ledger.cache })
  assert.deepEqual(recovery.errors, [])
  assert.equal(workers.length, 2, 'recovery is a fresh cold job')
  assert.ok(recovery.report.pageOutputCache?.has(sidecar), 'old cache entry remains until ownership reconciliation')
  ledger.recordWrites(recovery)
  await ledger.reconcileSuccessfulBuild(recovery, { filtered: false })
  await assert.rejects(readFile(sidecar), { code: 'ENOENT' })
  assert.equal(ledger.cache.has(sidecar), false)
  assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), 'recovered')
  assert.equal(await readFile(join(dest, 'sentinel.txt'), 'utf8'), 'unowned')
})

test('transport recovery preserves cloneable error causes and metadata while dropping only uncloneable optional fields', () => {
  const result = success().result
  const cause = new Error('Original cause')
  const original = new TypeError('Application failure', { cause })
  const dataDependency = { reason: /** @type {const} */ ('MISSING_KEY'), consumer: 'Page "page.js"', key: 'missing' }
  result.errors.push(
    { error: original, errorData: { code: 'DOM_STACK_ERROR_DATA', dataDependency } },
    { error: new Error('Uncloneable context'), errorData: { dataDependency, code: 'DOM_STACK_ERROR_DATA', page: /** @type {any} */ () => {} } }
  )
  result.report.globalDataBaseline = { state: () => {}, sourceIds: ['page.js'] }
  result.report.pageOutputCache = new Map([['/dest/sidecar.json', { hash: 'hash', metadata: 'metadata' }]])
  const recovered = workerResultTransportFailure(result, new DOMException('Cannot clone result', 'DataCloneError'))
  assert.doesNotThrow(() => structuredClone(recovered))
  assert.equal(recovered.errors.length, 3)
  assert.equal(recovered.errors[0]?.error.name, 'DataCloneError')
  assert.equal(recovered.errors[1]?.error.name, original.name)
  assert.equal(recovered.errors[1]?.error.message, original.message)
  assert.equal(recovered.errors[1]?.error.stack, original.stack)
  assert.deepEqual(recovered.errors[1]?.error.cause, cause)
  assert.deepEqual(recovered.errors[1]?.errorData, result.errors[0]?.errorData)
  assert.deepEqual(recovered.errors[2]?.errorData, { code: 'DOM_STACK_ERROR_DATA', dataDependency })
  assert.equal(Object.hasOwn(recovered.report, 'globalDataBaseline'), false)
  assert.deepEqual(recovered.report.pageOutputCache, result.report.pageOutputCache)
  assert.equal(typeof result.report.globalDataBaseline.state, 'function', 'caller state is not sanitized in place')
  assert.equal(typeof result.errors[1]?.errorData?.page, 'function')
})
