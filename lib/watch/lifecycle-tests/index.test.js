/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 */
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import fsPromises, { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { Server } from 'node:net'
import { join, resolve } from 'node:path'
import { requestWatchRebuild } from '../control.js'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'
import { createSessionRegistry } from '@domstack/sync'
import { DomStack } from '../../../index.js'

/**
 * @param {TestContext} t
 * @param {(watcher: FSWatcher) => void} [onWatcher]
 * @param {string} [prefix]
 */
async function fixture (t, onWatcher, prefix = '.tmp-') {
  const root = await mkdtemp(join(import.meta.dirname, prefix))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  await mkdir(src)
  await writeFile(join(src, 'root.layout.js'), 'export default ({ children }) => children\n')
  await writeFile(join(src, 'page.js'), "export default () => 'initial'\n")
  const dom = new DomStack(src, dest)
  /** @type {FSWatcher | undefined} */
  let watcher
  const watch = chokidar.watch
  /** @param {Parameters<typeof watch>} args */
  const captureWatcher = (...args) => {
    const result = watch(...args)
    // The dev server also uses Chokidar; only capture DOMStack's source watcher.
    if (args[0] === src) {
      watcher = result
      onWatcher?.(watcher)
    }
    return result
  }
  t.mock.method(chokidar, 'watch', captureWatcher)
  t.after(async () => {
    if (dom.watching) await dom.stopWatching()
    await rm(root, { recursive: true, force: true })
  })
  return {
    dom,
    src,
    dest,
    watcher: () => {
      assert.ok(watcher)
      return watcher
    }
  }
}

const run = promisify(execFile)
const cli = resolve(import.meta.dirname, '../../../bin.js')
const inUse = { code: 'DOMSTACK_DESTINATION_IN_USE' }

/** @param {{ src: string; dest: string }} site @param {string[]} args */
function runBuild (site, ...args) {
  return run(process.execPath, [cli, 'build', '--src', site.src, '--dest', site.dest, ...args])
}

/** @param {RegExp} pattern */
function cliFailure (pattern) {
  return (/** @type {unknown} */ error) => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error)
    assert.equal(error.code, 1, String(error.stderr))
    assert.match(String(error.stderr), pattern)
    return true
  }
}

const checkConflict = cliFailure(/Destination is in use/)

test('a watch keeps its destination claimed until an in-flight copy finishes', { timeout: 15_000 }, async t => {
  const site = await fixture(t, undefined, 'tmp-claim-')
  const assets = join(site.src, 'assets')
  await mkdir(assets)
  await writeFile(join(assets, 'image.txt'), 'watch copied this')
  const entered = Promise.withResolvers()
  const unblock = Promise.withResolvers()
  const target = join(site.dest, 'assets')
  const mkdirOriginal = fsPromises.mkdir
  t.mock.method(fsPromises, 'mkdir', async (/** @type {string} */ dir, /** @type {{ recursive: true }} */ options) => {
    if (resolve(dir) === target) {
      entered.resolve(undefined)
      await unblock.promise
    }
    return mkdirOriginal(dir, options)
  })
  const starting = site.dom.watch({ serve: false })
  /** @type {Promise<void> | undefined} */
  let stopping
  try {
    await Promise.race([entered.promise, starting.then(() => { throw new Error('watch did not start the copy') })])
    const other = new DomStack(site.src, site.dest)
    await assert.rejects(other.watch({ serve: false }), inUse)
    stopping = site.dom.stopWatching()
    await assert.rejects(other.build(), inUse)
    await assert.rejects(runBuild(site), process.getuid ? cliFailure(/session is stopping/) : cliFailure(/not available on this platform/))
    await assert.rejects(access(join(target, 'image.txt')), { code: 'ENOENT' })
  } finally {
    unblock.resolve(undefined)
    await Promise.all([starting, stopping])
  }
  assert.equal(await readFile(join(target, 'image.txt'), 'utf8'), 'watch copied this')
  await runBuild(site)
})

for (const kind of ['static', 'extra']) {
  test(`failed ${kind} copies keep the one-shot claim until sibling writes finish`, { timeout: 15_000 }, async t => {
    const site = await fixture(t, undefined, 'tmp-claim-')
    const copySource = kind === 'static' ? site.src : join(site.src, '..', 'extra')
    const dom = kind === 'static' ? site.dom : new DomStack(site.src, site.dest, { copy: [copySource] })
    for (const name of ['slow', 'broken']) {
      await mkdir(join(copySource, name), { recursive: true })
      await writeFile(join(copySource, name, 'file.txt'), name)
    }
    const entered = Promise.withResolvers()
    const failed = Promise.withResolvers()
    const unblock = Promise.withResolvers()
    const mkdirOriginal = fsPromises.mkdir
    t.mock.method(fsPromises, 'mkdir', async (/** @type {string} */ dir, /** @type {{ recursive: true }} */ options) => {
      if (resolve(dir) === join(site.dest, 'slow')) {
        entered.resolve(undefined)
        await unblock.promise
      }
      if (resolve(dir) === join(site.dest, 'broken')) {
        await entered.promise
        failed.resolve(undefined)
        throw new Error('injected copy failure')
      }
      return mkdirOriginal(dir, options)
    })
    const checked = assert.rejects(dom.build(), /Prebuild finished but there were errors/)
    try {
      await Promise.race([failed.promise, checked.then(() => { throw new Error('build did not reach the failed copy') })])
      await assert.rejects(runBuild(site), checkConflict)
      await assert.rejects(access(join(site.dest, 'slow', 'file.txt')), { code: 'ENOENT' })
    } finally {
      unblock.resolve(undefined)
      await checked
    }
    assert.equal(await readFile(join(site.dest, 'slow', 'file.txt'), 'utf8'), 'slow')
    await runBuild(site)
  })
}

/** @param {TestContext} t @param {string} directory */
function useRegistry (t, directory) {
  const previous = process.env['DOMSTACK_SESSION_DIR']
  process.env['DOMSTACK_SESSION_DIR'] = directory
  t.after(() => {
    if (previous === undefined) delete process.env['DOMSTACK_SESSION_DIR']
    else process.env['DOMSTACK_SESSION_DIR'] = previous
  })
  return createSessionRegistry({ directory })
}

test('watchInfo exposes lifecycle without replacing the initial build report', async t => {
  const site = await fixture(t)
  const registry = useRegistry(t, join(site.dest, '..', 'registry'))
  const watchInfo = () => site.dom.watchInfo
  assert.equal(watchInfo(), null)
  let initial
  const report = await site.dom.watch({
    serve: false,
    port: undefined,
    async onInitialBuild (result) {
      initial = result
      const info = watchInfo()
      assert.ok(info?.id)
      assert.equal(info.state, 'starting')
      assert.equal((await registry.get(info.id))?.state, 'starting')
    },
  })
  assert.equal(report, initial)
  const info = watchInfo()
  assert.ok(info?.id)
  assert.equal(info.state, 'watching')
  assert.equal(info.port, null)
  assert.equal(info.url, null)
  assert.equal((await registry.get(info.id))?.state, 'watching')
  const stopping = site.dom.stopWatching()
  assert.equal(watchInfo()?.state, 'stopping')
  await stopping
  assert.equal(watchInfo(), null)
  assert.equal(await registry.get(info.id), null)
})

test('embedded watch delegates rebuilds, resets inputs, and survives failures', { timeout: 15_000, skip: !process.getuid }, async t => {
  const site = await fixture(t)
  useRegistry(t, join(site.dest, '..', 'registry'))
  await writeFile(join(site.src, '.value'), 'initial data')
  await writeFile(join(site.src, 'global.data.js'), `import { readFile } from 'node:fs/promises'
export default async ({ previousState, setState }) => {
  const value = previousState ?? await readFile(new URL('./.value', import.meta.url), 'utf8')
  setState(value)
  return { value }
}
`)
  const page = `import { appendFile, readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
export const vars = { dataDeps: ['value'] }
export default async ({ data }) => {
  const trace = new URL('./.trace', import.meta.url)
  await appendFile(trace, 'start\\n')
  await setTimeout(50)
  if (await readFile(new URL('./.value', import.meta.url), 'utf8') === 'broken') throw new Error('intentional render failure')
  await appendFile(trace, 'finish\\n')
  return data.value
}
`
  await writeFile(join(site.src, 'page.js'), page)
  await site.dom.watch({
    serve: false,
    async onInitialBuild () {
      const id = site.dom.watchInfo?.id
      assert.ok(id)
      await assert.rejects(requestWatchRebuild(id), /still starting/)
    },
  })
  const readOutput = () => readFile(join(site.dest, 'index.html'), 'utf8')
  assert.match(await readOutput(), /initial data/)
  await writeFile(join(site.src, '.value'), 'broken')
  await assert.rejects(runBuild(site), cliFailure(/Page build finished but there were errors/))
  await assert.rejects(runBuild(site, '--drafts'), cliFailure(/Cannot delegate with --drafts/))
  await assert.rejects(runBuild({ ...site, src: join(site.src, 'other') }), checkConflict)
  await assert.rejects(runBuild({ ...site, dest: join(site.dest, 'nested') }), checkConflict)
  assert.equal(site.dom.watching, true)
  await writeFile(join(site.src, '.trace'), '')
  await writeFile(join(site.src, '.value'), 'updated data')
  const requests = await Promise.all([runBuild(site), runBuild(site)])
  for (const request of requests) {
    assert.match(request.stdout, /Rebuilding via active watch session .* \(watch mode\)/)
    assert.match(request.stdout, /Watch rebuild succeeded/)
  }
  assert.equal(await readFile(join(site.src, '.trace'), 'utf8'), 'start\nfinish\nstart\nfinish\n')
  assert.match(await readOutput(), /updated data/)
})

test('watch closes discovery on startup failure', async t => {
  const site = await fixture(t)
  const registry = useRegistry(t, join(site.dest, '..', 'registry'))
  await assert.rejects(site.dom.watch({
    serve: false,
    onInitialBuild () { throw new Error('initial callback failed') },
  }), /initial callback failed/)
  assert.equal(site.dom.watchInfo, null)
  assert.deepEqual(await registry.list(), [])
})

test('watchInfo survives an unavailable registry', async t => {
  const site = await fixture(t)
  const directory = join(site.dest, '..', 'registry')
  await writeFile(directory, 'not a directory')
  useRegistry(t, directory)
  await site.dom.watch({ serve: false })
  assert.ok(site.dom.watchInfo?.id)
  assert.equal(site.dom.watchInfo.state, 'watching')
  await site.dom.stopWatching()
  assert.equal(site.dom.watchInfo, null)
})

test('idle facade reports no watch session before startup and after shutdown', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  assert.equal(site.dom.watching, false)
  await assert.doesNotReject(site.dom.settled())
  await assert.rejects(site.dom.stopWatching(), { message: 'Not watching' })

  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()

  assert.equal(site.dom.watching, false)
  await assert.doesNotReject(site.dom.settled())
  await assert.rejects(site.dom.stopWatching(), { message: 'Not watching' })
})

test('watch uses replaced facade options before startup and across sessions', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  await writeFile(join(site.src, 'draft.draft.md'), '# Draft\n')

  for (const buildDrafts of [true, false]) {
    site.dom.opts = { ...site.dom.opts, buildDrafts }
    const built = await site.dom.build()
    const watched = await site.dom.watch({ serve: false })
    for (const report of [built, watched]) {
      assert.equal(report.siteData.pages.some(page => page.pageFile.relname === 'draft.draft.md'), buildDrafts)
    }
    await site.dom.stopWatching()
  }
})

test('shutdown during the initial build drains startup and permits a retry', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  let callbacks = 0
  const starting = site.dom.watch({
    serve: true,
    onInitialBuild () { callbacks++ },
  })
  assert.equal(site.dom.watching, true)
  const shutdown = site.dom.stopWatching()
  const repeatedShutdown = site.dom.stopWatching()
  await assert.rejects(site.dom.watch({ serve: false }), /Already watching/)
  await Promise.all([starting, shutdown, repeatedShutdown])
  assert.equal(callbacks, 0)
  assert.equal(site.dom.watching, false)
  assert.equal(site.watcher().closed, true)
  assert.equal(site.watcher().listenerCount('ready'), 0)
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('shutdown cancels watcher readiness without waiting for a ready event', { timeout: 15_000 }, async t => {
  const reachedReady = Promise.withResolvers()
  let holdReady = true
  const site = await fixture(t, watcher => {
    if (!holdReady) return
    const emit = watcher.emit.bind(watcher)
    /** @param {Parameters<typeof emit>} args */
    const emitWithoutReady = (...args) => {
      if (args[0] === 'ready') {
        reachedReady.resolve(undefined)
        return false
      }
      return emit(...args)
    }
    t.mock.method(watcher, 'emit', emitWithoutReady)
  })
  const registry = useRegistry(t, join(site.dest, '..', 'registry'))
  let callbacks = 0
  const starting = site.dom.watch({
    serve: false,
    onInitialBuild () { callbacks++ },
  })
  await reachedReady.promise
  await Promise.all([site.dom.stopWatching(), starting])
  assert.deepEqual(await registry.list(), [])
  assert.equal(callbacks, 0)
  assert.equal(site.dom.watching, false)
  assert.equal(site.watcher().closed, true)
  assert.equal(site.watcher().listenerCount('ready'), 0)
  assert.equal(site.watcher().listenerCount('change'), 0)
  holdReady = false
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('shutdown cancels a pending copy scan without acquiring late native watchers', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  const copyDir = join(site.src, '..', 'copy')
  await mkdir(copyDir)
  await writeFile(join(copyDir, 'asset.txt'), 'copied')
  const dom = new DomStack(site.src, site.dest, { copy: [copyDir] })
  t.after(async () => { if (dom.watching) await dom.stopWatching() })
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const resumed = Promise.withResolvers()
  const lstat = fsPromises.lstat
  let rootChecks = 0
  /** @param {Parameters<typeof lstat>} args */
  const lstatWithGate = async (...args) => {
    // Hold the symlink check after cpx2's first session guard: the 9.0.1 leak window.
    if (resolve(String(args[0])) === copyDir && ++rootChecks === 2) {
      entered.resolve(undefined)
      await release.promise
      try {
        return await Reflect.apply(lstat, fsPromises, args)
      } finally {
        resumed.resolve(undefined)
      }
    }
    return Reflect.apply(lstat, fsPromises, args)
  }
  t.mock.method(fsPromises, 'lstat', lstatWithGate)
  const watch = fs.watch
  /** @type {ReturnType<typeof watch>[]} */
  const handles = []
  /** @type {Promise<unknown>[]} */
  const closures = []
  /** @param {Parameters<typeof watch>} args */
  const trackNativeWatcher = (...args) => {
    const watcher = Reflect.apply(watch, fs, args)
    if (resolve(String(args[0])) === copyDir) {
      handles.push(watcher)
      closures.push(once(watcher, 'close'))
    }
    return watcher
  }
  t.mock.method(fs, 'watch', trackNativeWatcher)
  const starting = dom.watch({ serve: false })
  try {
    await entered.promise
    // Shutdown must finish while the scan is still held, not wait for watch-ready.
    await Promise.all([starting, dom.stopWatching()])
    assert.equal(dom.watching, false)
    release.resolve(undefined)
    await resumed.promise
    await setImmediate()
    assert.equal(handles.length, 0)
    await assert.rejects(access(join(site.dest, 'asset.txt')), { code: 'ENOENT' })

    await dom.watch({ serve: false })
    assert.equal(await readFile(join(site.dest, 'asset.txt'), 'utf8'), 'copied')
    assert.ok(handles.length > 0)
    await dom.stopWatching()
    await Promise.all(closures)
    assert.equal(dom.watching, false)
  } finally {
    release.resolve(undefined)
    await starting
    await resumed.promise
    await setImmediate()
    // Also close any leaked handles when checking against a regressed dependency.
    for (const handle of handles) handle.close()
    await Promise.all(closures)
  }
})

test('copy watcher startup errors settle watch and permit a retry', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  const copyDir = join(site.src, '..', 'missing-copy')
  const dom = new DomStack(site.src, site.dest, { copy: [copyDir] })
  t.after(async () => { if (dom.watching) await dom.stopWatching() })
  await assert.rejects(dom.watch({ serve: false }), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.message, 'Copy watch startup failed')
    assert.equal(error.errors[0].code, 'ENOENT')
    return true
  })
  assert.equal(dom.watching, false)
  await mkdir(copyDir)
  await writeFile(join(copyDir, 'asset.txt'), 'copied')
  await dom.watch({ serve: false })
  assert.equal(await readFile(join(site.dest, 'asset.txt'), 'utf8'), 'copied')
  await dom.stopWatching()
})

test('shutdown drains late server creation and closes its listening ports', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const listen = Server.prototype.listen
  /** @type {Set<Server>} */
  const servers = new Set()
  let holdListen = true
  /**
   * @this {Server}
   * @param {Parameters<typeof listen>} args
   */
  function listenWithGate (...args) {
    if (typeof args[0] === 'string') return Reflect.apply(listen, this, args)
    servers.add(this)
    if (holdListen) {
      holdListen = false
      entered.resolve(undefined)
      // Hold the real server factory at its first TCP bind, not a replacement
      // server implementation. After release, all normal server resources start.
      release.promise.then(() => Reflect.apply(listen, this, args))
      return this
    }
    return Reflect.apply(listen, this, args)
  }
  t.mock.method(Server.prototype, 'listen', listenWithGate)
  const starting = site.dom.watch({ serve: true })
  try {
    await entered.promise
    let stopped = false
    const shutdown = site.dom.stopWatching().then(() => { stopped = true })
    await delay(20)
    assert.equal(stopped, false)
    await assert.rejects(site.dom.watch({ serve: false }), /Already watching/)
    release.resolve(undefined)
    await Promise.all([starting, shutdown])
    assert.ok(servers.size > 0)
    assert.ok([...servers].every(server => !server.listening))
    assert.equal(site.dom.watching, false)
    assert.equal(site.watcher().listenerCount('change'), 0)

    // A normal served session must still start, serve the page, and stop afterward.
    await site.dom.watch({ serve: true })
    const pages = await Promise.all([...servers].filter(server => server.listening).map(async server => {
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const response = await fetch(`http://127.0.0.1:${address.port}/`)
      return response.text()
    }))
    assert.ok(pages.some(page => page.includes('initial')))
    await site.dom.stopWatching()
    assert.ok([...servers].every(server => !server.listening))
  } finally {
    release.resolve(undefined)
    await starting
  }
})

test('shutdown awaits asynchronous watcher closure and supports repeated cycles', async t => {
  const site = await fixture(t)
  await site.dom.watch({ serve: false })
  const watcher = site.watcher()
  const close = watcher.close.bind(watcher)
  const gate = Promise.withResolvers()
  t.mock.method(watcher, 'close', async () => {
    await close()
    await gate.promise
  })
  let stopped = false
  const shutdown = site.dom.stopWatching().then(() => { stopped = true })
  await delay(20)
  assert.equal(stopped, false)
  await assert.rejects(site.dom.watch({ serve: false }), /Already watching/)
  gate.resolve(undefined)
  await shutdown
  assert.equal(site.dom.watching, false)
  for (let i = 0; i < 3; i++) {
    await site.dom.watch({ serve: false })
    await site.dom.stopWatching()
    assert.equal(site.watcher().closed, true)
  }
})

test('failed startup closes acquired watchers and permits a retry', async t => {
  const site = await fixture(t)
  await assert.rejects(site.dom.watch({
    serve: false,
    onInitialBuild () { throw new Error('callback failed') },
  }), /callback failed/)
  assert.equal(site.watcher().closed, true)
  assert.equal(site.dom.watching, false)
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('stopping in the initial-build callback does not resume watch startup', async t => {
  const site = await fixture(t)
  await site.dom.watch({
    serve: true,
    onInitialBuild: () => site.dom.stopWatching(),
  })
  assert.equal(site.dom.watching, false)
  assert.equal(site.watcher().closed, true)
  assert.equal(site.watcher().listenerCount('change'), 0)
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('a late callback failure cannot clean up a replacement session', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const starting = site.dom.watch({
    serve: true,
    async onInitialBuild () {
      entered.resolve(undefined)
      await release.promise
      throw new Error('old callback failed')
    },
  })
  const failed = assert.rejects(starting, /old callback failed/)
  try {
    await entered.promise
    await site.dom.stopWatching()
    await site.dom.watch({ serve: false })
    const replacement = site.watcher()
    release.resolve(undefined)
    await failed
    assert.equal(site.dom.watching, true)
    assert.equal(replacement.closed, false)
    assert.equal(replacement.listenerCount('change'), 1)
    await site.dom.stopWatching()
  } finally {
    release.resolve(undefined)
    await failed
  }
})

test('cleanup reports close failures after releasing remaining resources', async t => {
  const site = await fixture(t)
  await site.dom.watch({ serve: false })
  const watcher = site.watcher()
  const close = watcher.close.bind(watcher)
  t.mock.method(watcher, 'close', async () => {
    await close()
    throw new Error('close failed')
  })
  await assert.rejects(site.dom.stopWatching(), error => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.errors[0].message, /close failed/)
    return true
  })
  assert.equal(site.dom.watching, false)
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('readiness failure preserves both startup and cleanup errors', { timeout: 15_000 }, async t => {
  const startupError = new Error('watcher failed before ready')
  const cleanupError = new Error('watcher close failed')
  let failReady = true
  let closes = 0
  const site = await fixture(t, watcher => {
    if (!failReady) return
    const emit = watcher.emit.bind(watcher)
    /** @param {Parameters<typeof emit>} args */
    const emitErrorInsteadOfReady = (...args) => {
      if (args[0] === 'ready') return emit('error', startupError)
      return emit(...args)
    }
    t.mock.method(watcher, 'emit', emitErrorInsteadOfReady)
    const close = watcher.close.bind(watcher)
    t.mock.method(watcher, 'close', async () => {
      closes++
      await close()
      throw cleanupError
    })
  })
  await assert.rejects(site.dom.watch({ serve: false }), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.errors[0], startupError)
    assert.ok(error.errors[1] instanceof AggregateError)
    assert.deepEqual(error.errors[1].errors, [cleanupError])
    return true
  })
  assert.equal(closes, 1)
  assert.equal(site.dom.watching, false)
  assert.equal(site.watcher().closed, true)
  failReady = false
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('a callback-requested stop reports its cleanup failure only once', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  const cleanupError = new Error('watcher close failed')
  let closes = 0
  await assert.rejects(site.dom.watch({
    serve: true,
    onInitialBuild () {
      const watcher = site.watcher()
      const close = watcher.close.bind(watcher)
      t.mock.method(watcher, 'close', async () => {
        closes++
        await close()
        throw cleanupError
      })
      return site.dom.stopWatching()
    },
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [cleanupError])
    return true
  })
  assert.equal(closes, 1)
  assert.equal(site.dom.watching, false)
  await site.dom.watch({ serve: false })
  await site.dom.stopWatching()
})

test('service-worker startup failure disposes both esbuild contexts', async t => {
  const site = await fixture(t)
  await writeFile(join(site.src, 'client.js'), 'console.log("client")\n')
  await writeFile(join(site.src, 'service-worker.js'), 'export default (\n')
  await writeFile(join(site.src, 'esbuild.settings.js'), `import { appendFileSync } from 'node:fs'
export default options => ({ ...options, plugins: [{
  name: 'observe-disposal',
  setup (build) {
    build.onDispose(() => appendFileSync(import.meta.dirname + '/.disposed', 'disposed\\n'))
  },
}] })
`)
  await assert.rejects(site.dom.watch({ serve: false }), /Error starting esbuild watch context/)
  for (let i = 0; i < 100; i++) {
    const contents = await readFile(join(site.src, '.disposed'), 'utf8').catch(() => '')
    if (contents === 'disposed\ndisposed\n') break
    await delay(10)
  }
  assert.equal(await readFile(join(site.src, '.disposed'), 'utf8'), 'disposed\ndisposed\n')
  assert.equal(site.dom.watching, false)
})

test('shutdown drains an active page build and cancels queued events', { timeout: 15_000 }, async t => {
  const site = await fixture(t)
  await writeFile(join(site.src, 'page.js'), `import { existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
export default async () => {
  const root = import.meta.dirname
  if (existsSync(root + '/.block')) {
    appendFileSync(root + '/.runs', 'run\\n')
    writeFileSync(root + '/.started', '')
    while (!existsSync(root + '/.release')) await setTimeout(10)
  }
  return 'rendered'
}
`)
  await site.dom.watch({ serve: false })
  await writeFile(join(site.src, '.block'), '')
  site.watcher().emit('change', join(site.src, 'page.js'))
  for (let i = 0; i < 500; i++) {
    if (await access(join(site.src, '.started')).then(() => true, () => false)) break
    await delay(10)
  }
  await access(join(site.src, '.started'))
  site.watcher().emit('change', join(site.src, 'page.js'))
  let stopped = false
  const shutdown = site.dom.stopWatching().then(() => { stopped = true })
  await delay(20)
  assert.equal(stopped, false)
  await writeFile(join(site.src, '.release'), '')
  await shutdown
  assert.equal(await readFile(join(site.src, '.runs'), 'utf8'), 'run\n')
  assert.equal(await readFile(join(site.dest, 'index.html'), 'utf8'), 'rendered')
})
