import { test, mock } from 'node:test'
import assert from 'node:assert'
import { DomStack } from '../../index.js'
import { cp, rm, writeFile, readFile, unlink, mkdtemp, stat, readdir } from 'fs/promises'
import * as path from 'path'

const fixtureDir = path.join(import.meta.dirname, '../general-features/src')

/**
 * Copy the general-features fixture to a temp dir inside the project tree
 * so that node_modules resolution still works for esbuild bare specifiers.
 * @returns {Promise<{ src: string, dest: string, tmp: string }>}
 */
async function setupTempSite () {
  const tmp = await mkdtemp(path.join(import.meta.dirname, '.tmp-'))
  const src = path.join(tmp, 'src')
  const dest = path.join(tmp, 'public')
  await cp(fixtureDir, src, { recursive: true })
  return { src, dest, tmp }
}

/**
 * Wait for chokidar to detect a change and the rebuild to settle.
 * @param {DomStack} domStack
 * @param {number} [ms=800]
 */
async function settle (domStack, ms = 800) {
  await new Promise(resolve => setTimeout(resolve, ms))
  await domStack.settled()
}

/**
 * Collect all console.log call arguments and logger chunks into a flat string array.
 * @param {ReturnType<typeof mock.method>} mockLog
 * @param {string[]} loggerLogs
 * @returns {string[]}
 */
function getLogLines (mockLog, loggerLogs) {
  const consoleLines = mockLog.mock.calls.map(c => c.arguments.map(String).join(' '))
  return [...consoleLines, ...loggerLogs]
}

/**
 * @param {string[]} logs
 */
function createTestLogger (logs) {
  /** @param {unknown[]} args */
  const write = (args) => {
    const first = args[0]
    const messageArgs = first && typeof first === 'object'
      ? args.slice(1)
      : args
    logs.push(messageArgs.map(String).join(' '))
  }

  const logger = {
    level: 'info',
    /** @param {...unknown} args */
    info (...args) { write(args) },
    /** @param {...unknown} args */
    warn (...args) { write(args) },
    /** @param {...unknown} args */
    error (...args) { write(args) },
    child () { return logger },
  }

  return /** @type {import('pino').Logger} */ (/** @type {unknown} */ (logger))
}

test.describe('watch', () => {
  test('progressive rebuilds', { timeout: 60_000 }, async (t) => {
    const { src, dest, tmp } = await setupTempSite()

    t.after(async () => {
      await rm(tmp, { recursive: true, force: true })
    })

    const mockLog = mock.method(console, 'log')
    const loggerLogs = /** @type {string[]} */ ([])
    const logger = createTestLogger(loggerLogs)
    const domStack = new DomStack(src, dest, { logger })

    t.after(async () => {
      if (domStack.watching) await domStack.stopWatching()
      mockLog.mock.restore()
    })

    // ── Initial build ────────────────────────────────────────────────
    const results = await domStack.watch({ serve: false })
    assert.ok(results, 'watch() returned initial build results')
    assert.ok(results.siteData, 'results include siteData')
    assert.equal(results.domstackManifest, undefined, 'watch mode does not return a domstack manifest')

    const jsPageIndex = path.join(dest, 'js-page/index.html')
    const st = await stat(jsPageIndex)
    assert.ok(st.isFile(), 'js-page/index.html was built')
    await assert.rejects(
      () => stat(path.join(dest, 'domstack-manifest.json')),
      'watch mode does not write a domstack manifest'
    )
    const serviceWorkerStat = await stat(path.join(dest, 'service-worker.js'))
    assert.ok(serviceWorkerStat.isFile(), 'watch mode builds site service-worker entries')
    const serviceWorkerContent = await readFile(path.join(dest, 'service-worker.js'), 'utf8')
    assert.ok(!serviceWorkerContent.includes('process.env.DOMSTACK_MANIFEST_ENABLED'), 'watch service worker receives the domstack manifest enabled define')
    assert.ok(serviceWorkerContent.includes('"false"'), 'watch service worker knows the domstack manifest is disabled')

    // ── Chunks have hashed names in watch mode ───────────────────────
    // html-page/client.js, js-page/client.js, and md-page/client.js all import
    // client-helper.js, so esbuild splits it into a shared chunk. The chunk must
    // have a hash in its name even in watch mode to avoid output path collisions.
    const chunkFiles = await readdir(path.join(dest, 'chunks', 'js'))
    const jsChunks = chunkFiles.filter(f => f.endsWith('.js'))
    assert.ok(jsChunks.length > 0, 'at least one shared JS chunk was produced')
    assert.ok(
      jsChunks.every(f => /chunk-.+\.js$/.test(f)),
      `all chunk filenames must include a hash (got: ${jsChunks.join(', ')})`
    )

    // ── Page file change → only that page rebuilds ───────────────────
    await t.test('page file change rebuilds only that page', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0

      const pageFile = path.join(src, 'js-page/page.js')
      const original = await readFile(pageFile, 'utf8')
      await writeFile(pageFile, original.replace('jus some html', 'UPDATED html'))

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('"page.js" changed:')),
        'log shows page.js triggered a rebuild'
      )
      assert.ok(
        logs.some(l => l.includes('js-page/index.html')),
        'log shows js-page/index.html was targeted'
      )
      assert.ok(
        logs.some(l => l.includes('Pages built: 1')),
        'only 1 page was built'
      )

      const output = await readFile(jsPageIndex, 'utf8')
      assert.ok(output.includes('UPDATED html'), 'output file contains updated content')
    })

    // ── Layout change → pages using that layout rebuild ──────────────
    await t.test('layout change rebuilds only pages using that layout', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const layoutFile = path.join(src, 'layouts/root.layout.js')
      const original = await readFile(layoutFile, 'utf8')
      await writeFile(layoutFile, original.replace('safe-area-inset', 'safe-area-inset layout-touched'))

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('"root.layout.js" changed:')),
        'log shows root.layout.js triggered a rebuild'
      )
      assert.ok(
        logs.some(l => l.includes('Build Success')),
        'build succeeded'
      )
      // Should NOT be a full rebuild
      assert.ok(
        !logs.some(l => l.includes('Triggering full rebuild')),
        'did not trigger a full rebuild'
      )
    })

    // ── esbuild entry point change → no page rebuild ─────────────────
    await t.test('esbuild entry point change does not rebuild pages', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const clientFile = path.join(src, 'js-page/client.js')
      const original = await readFile(clientFile, 'utf8')
      await writeFile(clientFile, original + '\n// touch')

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('esbuild will handle rebundling')),
        'log confirms esbuild handles the change'
      )
      assert.ok(
        !logs.some(l => l.includes('Pages built')),
        'no page rebuild was triggered'
      )
    })

    // ── service worker change → esbuild rebuilds, no page rebuild ───
    await t.test('service worker change does not rebuild pages', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0

      const serviceWorkerFile = path.join(src, 'globals/service-worker.mts')
      const original = await readFile(serviceWorkerFile, 'utf8')
      await writeFile(serviceWorkerFile, original + '\n// touch')

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('esbuild will handle rebundling')),
        'domstack lets esbuild rebundle the service worker'
      )
      assert.ok(
        !logs.some(l => l.includes('Pages built')),
        'no page rebuild was triggered'
      )
    })

    // ── esbuild dep change → esbuild rebuilds, no page rebuild ─────
    await t.test('changing a client.js dependency triggers esbuild rebuild only', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const helperFile = path.join(src, 'libs/client-helper.js')
      const original = await readFile(helperFile, 'utf8')
      await writeFile(helperFile, original.replace('hello from client-helper', 'UPDATED client-helper'))

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      // client-helper.js is NOT an esbuild entry point itself, but it IS imported by
      // client.js which IS an esbuild entry point. esbuild's own watcher tracks the
      // transitive imports of its entry points, so it should detect this and rebuild.
      // The domstack chokidar watcher should NOT trigger a page rebuild for this file.
      assert.ok(
        !logs.some(l => l.includes('Pages built')),
        'no page rebuild was triggered for a client dependency change'
      )
    })

    // ── page dependency change → only that page rebuilds ─────────────
    await t.test('changing a page.js dependency rebuilds only affected pages', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const helperFile = path.join(src, 'libs/page-helper.js')
      const original = await readFile(helperFile, 'utf8')
      await writeFile(helperFile, original.replace('page-helper-stamp', 'UPDATED-page-stamp'))

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('"page-helper.js" changed:')),
        'log shows page-helper.js triggered a rebuild'
      )
      assert.ok(
        logs.some(l => l.includes('js-page/index.html')),
        'log shows js-page/index.html was targeted'
      )
      assert.ok(
        logs.some(l => l.includes('Pages built: 1')),
        'only 1 page was built'
      )

      const output = await readFile(path.join(dest, 'js-page/index.html'), 'utf8')
      assert.ok(output.includes('UPDATED-page-stamp'), 'output file contains updated dep content')
    })

    // ── layout dependency change → only pages using that layout rebuild
    await t.test('changing a layout dependency rebuilds only pages using that layout', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const helperFile = path.join(src, 'libs/layout-helper.js')
      const original = await readFile(helperFile, 'utf8')
      await writeFile(helperFile, original.replace('layout-helper-marker', 'UPDATED-layout-marker'))

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('"layout-helper.js" changed:')),
        'log shows layout-helper.js triggered a rebuild'
      )
      // Should rebuild pages using root layout, but NOT be a full rebuild
      assert.ok(
        logs.some(l => l.includes('Build Success')),
        'build succeeded'
      )
      assert.ok(
        !logs.some(l => l.includes('Triggering full rebuild')),
        'did not trigger a full rebuild'
      )

      const output = await readFile(path.join(dest, 'js-page/index.html'), 'utf8')
      assert.ok(output.includes('UPDATED-layout-marker'), 'output file contains updated layout dep content')
    })

    // ── Add client.js to page dir → esbuild restart + targeted rebuild
    await t.test('adding client.js restarts esbuild and rebuilds only that page', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const newClient = path.join(src, 'js-page/js-no-style-client/client.js')
      await writeFile(newClient, 'console.log("new client")\n')

      await settle(domStack, 1200)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('"client.js" added, restarting esbuild')),
        'log shows esbuild restart on client.js add'
      )
      assert.ok(
        logs.some(l => l.includes('js-page/js-no-style-client/index.html')),
        'log shows the affected page was targeted'
      )
      assert.ok(
        logs.some(l => l.includes('Build Success')),
        'build succeeded'
      )
    })

    // ── Remove the client.js we just added → esbuild restart + targeted rebuild
    await t.test('removing client.js restarts esbuild and rebuilds only that page', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const clientToRemove = path.join(src, 'js-page/js-no-style-client/client.js')
      await unlink(clientToRemove)

      await settle(domStack, 1200)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('"client.js" removed, restarting esbuild')),
        'log shows esbuild restart on client.js removal'
      )
      assert.ok(
        logs.some(l => l.includes('Build Success')),
        'build succeeded'
      )
    })

    // ── global.data.js change → all pages rebuild ────────────────────
    await t.test('global.data.js change rebuilds all pages', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const globalData = path.join(src, 'global.data.js')
      const original = await readFile(globalData, 'utf8')
      await writeFile(globalData, original + '\n// touch')

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('rebuilding all pages')),
        'log shows all pages are being rebuilt'
      )
      assert.ok(
        logs.some(l => l.includes('Build Success')),
        'build succeeded'
      )
    })

    // ── stopWatching cleans up ───────────────────────────────────────
    await t.test('stopWatching completes without error', async () => {
      await domStack.stopWatching()
      assert.ok(!domStack.watching, 'watcher is stopped')
    })
  })
})
