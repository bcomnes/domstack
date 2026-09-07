/**
 * @import { TestContext } from 'node:test'
 * @import { Logger } from 'pino'
 */

import { test, mock } from 'node:test'
import assert from 'node:assert'
import { DomStack } from '../../index.js'
import { cp, rm, writeFile, readFile, unlink, mkdtemp, stat, readdir, mkdir } from 'fs/promises'
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
 * Start a watched site from a small inline fixture and register its cleanup.
 *
 * @param {TestContext} t
 * @param {object} options
 * @param {string} options.prefix
 * @param {Record<string, string>} options.files
 * @param {Logger} [options.logger]
 */
async function setupTempWatch (t, { prefix, files, logger }) {
  const tmp = await mkdtemp(path.join(import.meta.dirname, prefix))
  const src = path.join(tmp, 'src')
  const dest = path.join(tmp, 'public')
  await mkdir(src, { recursive: true })
  await Promise.all(Object.entries(files).map(async ([relname, content]) => {
    const filepath = path.join(src, relname)
    await mkdir(path.dirname(filepath), { recursive: true })
    await writeFile(filepath, content)
  }))

  const domStack = new DomStack(src, dest, { logger })
  t.after(async () => {
    if (domStack.watching) await domStack.stopWatching()
    await rm(tmp, { recursive: true, force: true })
  })
  await domStack.watch({ serve: false })

  return { src, dest, domStack }
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

test('global-data imports refresh subscribers and any direct consumers of the same helper', { timeout: 30_000 }, async t => {
  for (const helper of ['value.js', 'client.js']) {
    await t.test(helper, async t => {
      const { src, dest, domStack } = await setupTempWatch(t, {
        prefix: '.tmp-data-imports-',
        files: {
          'global.vars.js': "export default { layout: 'root' }",
          'root.layout.js': 'export default ({ children }) => children',
          [helper]: "export const value = 'first'",
          'global.data.js': `import { value } from './${helper}'; export default { value }`,
          'page.js': "export const vars = { dataDeps: ['value'] }; export default ({data}) => data.value",
          'direct/page.js': `import { value } from '../${helper}'; export default () => value`,
          'unchanged/page.html': 'Unrelated',
          'value.txt.template.js': "export const dataDeps = ['value']; export default ({data}) => data.value",
          'value.pages.js': "export const dataDeps = ['value']; export default ({data}) => ({ outputName: 'generated.html', children: data.value })",
        },
      })
      const unrelatedTime = (await stat(path.join(dest, 'unchanged/index.html'))).mtimeMs
      await writeFile(path.join(src, helper), "export const value = 'second'")
      await settle(domStack)
      for (const name of ['index.html', 'direct/index.html', 'value.txt', 'generated.html']) {
        assert.match(await readFile(path.join(dest, name), 'utf8'), /second/)
      }
      if (helper === 'client.js') assert.match(await readFile(path.join(dest, helper), 'utf8'), /second/)
      assert.equal((await stat(path.join(dest, 'unchanged/index.html'))).mtimeMs, unrelatedTime)
    })
  }
})

test('targeted factories reserve untouched owners outputs and recover after a collision', { timeout: 30_000 }, async t => {
  /** @type {string[]} */
  const logs = []
  const { src, dest, domStack } = await setupTempWatch(t, {
    prefix: '.tmp-owner-conflict-',
    logger: createTestLogger(logs),
    files: {
      'global.vars.js': "export default { layout: 'root' }",
      'root.layout.js': 'export default ({ children }) => children',
      'a.pages.js': "export default { outputName: 'a.html', children: 'Owner A' }",
      'b.pages.js': "export default { outputName: 'b.html', children: 'Owner B' }",
    },
  })
  const retainedTime = (await stat(path.join(dest, 'b.html'))).mtimeMs
  await writeFile(path.join(src, 'a.pages.js'), "export default { outputName: 'b.html', children: 'Collision' }")
  await settle(domStack)
  assert.ok(logs.some(line => line.includes('Output path conflict: b.html is produced by both b.pages.js and a.pages.js#0.')), 'both conflicting producers use source-relative names')
  assert.match(await readFile(path.join(dest, 'b.html'), 'utf8'), /Owner B/)
  assert.match(await readFile(path.join(dest, 'a.html'), 'utf8'), /Owner A/)
  assert.equal((await stat(path.join(dest, 'b.html'))).mtimeMs, retainedTime)
  await writeFile(path.join(src, 'a.pages.js'), "export default { outputName: 'c.html', children: 'Recovered' }")
  await settle(domStack)
  assert.match(await readFile(path.join(dest, 'c.html'), 'utf8'), /Recovered/)
  await assert.rejects(stat(path.join(dest, 'a.html')), { code: 'ENOENT' })
  assert.match(await readFile(path.join(dest, 'b.html'), 'utf8'), /Owner B/)
})

test('watch recovers from an initial layout subscription error before any routing state exists', { timeout: 30_000 }, async t => {
  const { src, dest, domStack } = await setupTempWatch(t, {
    prefix: '.tmp-data-recovery-',
    logger: createTestLogger([]),
    files: {
      'global.vars.js': "export default { layout: 'root' }",
      'global.data.js': "export default { value: 'Recovered' }",
      'root.layout.js': "export const vars = { dataDeps: ['missing'] }; export default ({ children }) => children",
      'page.html': 'Page',
    },
  })
  await writeFile(path.join(src, 'root.layout.js'), "export const vars = { dataDeps: ['value'] }; export default ({data, children}) => data.value + children")
  await settle(domStack)
  assert.match(await readFile(path.join(dest, 'index.html'), 'utf8'), /Recovered/)
})

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

  return /** @type {Logger} */ (/** @type {unknown} */ (logger))
}

test.describe('watch', () => {
  test('maps pages to the layout that actually rendered them', { timeout: 20_000 }, async (t) => {
    const { src, dest, domStack } = await setupTempWatch(t, {
      prefix: '.tmp-layout-report-',
      files: {
        'global.vars.js': "export default { layout: 'root' }\n",
        'root.layout.js': "export const vars = { layout: 'shadowed' }; export default ({ children }) => 'root-v1:' + children\n",
        'shadowed.layout.js': "export default ({ children }) => 'shadowed:' + children\n",
        'page.js': "export default () => 'content'\n",
      },
    })
    const rootLayout = path.join(src, 'root.layout.js')
    const outputPath = path.join(dest, 'index.html')
    assert.equal(await readFile(outputPath, 'utf8'), 'root-v1:content')

    await writeFile(rootLayout, "export const vars = { layout: 'shadowed' }; export default ({ children }) => 'root-v2:' + children\n")
    await settle(domStack)

    assert.equal(await readFile(outputPath, 'utf8'), 'root-v2:content')
  })

  test('updates layout mapping after builder vars select a new layout', { timeout: 20_000 }, async (t) => {
    const { src, dest, domStack } = await setupTempWatch(t, {
      prefix: '.tmp-builder-layout-',
      files: {
        'global.vars.js': "export default { layout: 'root' }\n",
        'root.layout.js': "export default ({ children }) => 'root:' + children\n",
        'blog.layout.js': "export default ({ children }) => 'blog-v1:' + children\n",
        'page.js': "export const vars = { layout: 'root' }; export default () => 'content'\n",
      },
    })
    const pageFile = path.join(src, 'page.js')
    const blogLayout = path.join(src, 'blog.layout.js')
    const outputPath = path.join(dest, 'index.html')
    assert.equal(await readFile(outputPath, 'utf8'), 'root:content')

    await writeFile(pageFile, "export const vars = { layout: 'blog' }; export default () => 'content'\n")
    await settle(domStack)
    assert.equal(await readFile(outputPath, 'utf8'), 'blog-v1:content')

    await writeFile(blogLayout, "export default ({ children }) => 'blog-v2:' + children\n")
    await settle(domStack)
    assert.equal(await readFile(outputPath, 'utf8'), 'blog-v2:content')
  })

  test('retries a failed build without discarding successful outputs, then resumes targeted layout routing', { timeout: 20_000 }, async (t) => {
    const loggerLogs = /** @type {string[]} */ ([])
    const { src, dest, domStack } = await setupTempWatch(t, {
      prefix: '.tmp-failed-layout-',
      logger: createTestLogger(loggerLogs),
      files: {
        'global.vars.js': "export default { layout: 'root' }\n",
        'root.layout.js': "export default ({ children }) => 'root-v1:' + children\n",
        'page.js': "export default () => 'content'\n",
      },
    })
    const pageFile = path.join(src, 'page.js')
    const rootLayout = path.join(src, 'root.layout.js')
    await writeFile(pageFile, 'export default (\n')
    await settle(domStack)

    loggerLogs.length = 0
    await writeFile(rootLayout, "export default ({ children }) => 'root-v2:' + children\n")
    await settle(domStack)

    assert.ok(loggerLogs.some(line => line.includes('retrying all pages after the previous build failure')))
    assert.ok(!loggerLogs.some(line => line.includes('no pages use layout "root"')))
    assert.equal(await readFile(path.join(dest, 'index.html'), 'utf8'), 'root-v1:content')
    await writeFile(pageFile, "export default () => 'content'")
    await settle(domStack)
    assert.equal(await readFile(path.join(dest, 'index.html'), 'utf8'), 'root-v2:content')
    loggerLogs.length = 0
    await writeFile(rootLayout, "export default ({ children }) => 'root-v3:' + children")
    await settle(domStack)
    assert.equal(await readFile(path.join(dest, 'index.html'), 'utf8'), 'root-v3:content')
    assert.ok(loggerLogs.some(line => line.includes('"root.layout.js" changed:') && line.includes('index.html')))
  })

  test('targets generated-page owners independently', { timeout: 30_000 }, async (t) => {
    const tmp = await mkdtemp(path.join(import.meta.dirname, '.tmp-generated-'))
    const src = path.join(tmp, 'src')
    const dest = path.join(tmp, 'public')
    await mkdir(src, { recursive: true })

    const sourcePage = path.join(src, 'page.md')
    const alphaPages = path.join(src, 'alpha.pages.js')
    const betaPages = path.join(src, 'beta.pages.js')

    await Promise.all([
      writeFile(sourcePage, '# Source v1\n'),
      writeFile(alphaPages, "export default [{ outputName: 'generated/alpha.html', children: 'alpha v1' }]\n"),
      writeFile(betaPages, "export default [{ outputName: 'generated/beta.html', children: 'beta v1' }]\n"),
    ])

    const loggerLogs = /** @type {string[]} */ ([])
    const domStack = new DomStack(src, dest, { logger: createTestLogger(loggerLogs) })

    t.after(async () => {
      if (domStack.watching) await domStack.stopWatching()
      await rm(tmp, { recursive: true, force: true })
    })

    await domStack.watch({ serve: false })

    const alphaOutput = path.join(dest, 'generated/alpha.html')
    const alphaRenamedOutput = path.join(dest, 'generated/alpha-renamed.html')
    const betaOutput = path.join(dest, 'generated/beta.html')

    assert.match(await readFile(alphaOutput, 'utf8'), /alpha v1/)
    assert.match(await readFile(betaOutput, 'utf8'), /beta v1/)

    loggerLogs.length = 0
    await writeFile(sourcePage, '# Source v2\n')
    await settle(domStack)

    assert.match(await readFile(path.join(dest, 'index.html'), 'utf8'), /Source v2/)
    assert.match(await readFile(alphaOutput, 'utf8'), /alpha v1/)
    assert.ok(loggerLogs.some(line => line.includes('Pages built: 1')), 'source change rebuilds only its page')

    loggerLogs.length = 0
    await writeFile(alphaPages, "export default [{ outputName: 'generated/alpha-renamed.html', children: 'alpha v2' }]\n")
    await settle(domStack)

    assert.match(await readFile(alphaRenamedOutput, 'utf8'), /alpha v2/)
    await assert.rejects(() => stat(alphaOutput), 'removed owner output is cleaned')
    assert.match(await readFile(betaOutput, 'utf8'), /beta v1/)
    assert.ok(loggerLogs.some(line => line.includes('Pages built: 1')), 'only the changed owner is rendered')
  })

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
    assert.ok(!serviceWorkerContent.includes('process.env.DOMSTACK_MANIFEST_ENABLED'), 'watch service worker replaces the domstack manifest enabled expression')
    assert.ok(serviceWorkerContent.includes('"false"'), 'watch service worker knows the domstack manifest is disabled')

    // ── Watch keeps browser splitting but keeps the service worker self-contained ──
    const jsChunks = await readdir(path.join(dest, 'chunks', 'js'))
    assert.ok(jsChunks.length > 0, 'watch mode preserves shared browser JS chunks')
    assert.ok(
      !/import\s.+from\s+['"].*chunks\//.test(serviceWorkerContent),
      'watch service worker does not import shared chunks'
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

    await t.test('layout change rebuilds pages that select it through frontmatter', async () => {
      const layoutFile = path.join(src, 'layouts/blog.layout.js')
      const pageOutput = path.join(dest, 'md-page/index.html')
      const original = await readFile(layoutFile, 'utf8')
      await writeFile(layoutFile, original.replace('article-layout h-entry', 'article-layout frontmatter-layout-updated h-entry'))

      await settle(domStack)

      const output = await readFile(pageOutput, 'utf8')
      assert.match(output, /frontmatter-layout-updated/)
    })

    await t.test('changed global data keys rebuild consumers of those keys', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const sourcePage = path.join(src, 'blog/2023/a-blog-post-from-2023/README.md')
      const indexOutput = path.join(dest, 'index.html')
      const original = await readFile(sourcePage, 'utf8')
      assert.match(await readFile(indexOutput, 'utf8'), /A Blogpost from 2023/)
      await writeFile(sourcePage, original.replace('A Blogpost from 2023', 'Updated collection title'))

      await settle(domStack)

      const output = await readFile(indexOutput, 'utf8')
      assert.match(output, /Updated collection title/)
      assert.doesNotMatch(output, /A Blogpost from 2023/)
      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(logs.some(line => line.includes('Pages built: 2')), 'only the changed page and global-data consumer rebuild')
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

    // ── global.data.js change → only subscribers of changed keys rebuild ──
    await t.test('global.data.js change rebuilds only affected subscribers', async () => {
      mockLog.mock.resetCalls()
      loggerLogs.length = 0
      const globalData = path.join(src, 'global.data.js')
      const original = await readFile(globalData, 'utf8')
      await writeFile(globalData, original.replace(
        'data-from-global-dot-data',
        'updated-global-data-sentinel'
      ))

      await settle(domStack)

      const logs = getLogLines(mockLog, loggerLogs)
      assert.ok(
        logs.some(l => l.includes('rebuilding data subscribers')),
        'log shows declared data subscribers are being considered'
      )
      assert.ok(
        logs.some(l => l.includes('Pages built: 0 Templates built: 1')),
        'only the template subscribed to the changed key rebuilds'
      )
    })

    // ── stopWatching cleans up ───────────────────────────────────────
    await t.test('stopWatching completes without error', async () => {
      await domStack.stopWatching()
      assert.ok(!domStack.watching, 'watcher is stopped')
    })
  })
})
