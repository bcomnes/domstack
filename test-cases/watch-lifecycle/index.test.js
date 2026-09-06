/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'
import { DomStack } from '../../index.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(import.meta.dirname, '.tmp-'))
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
    watcher = watch(...args)
    return watcher
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
