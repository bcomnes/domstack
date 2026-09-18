/**
 * @import { TestContext } from 'node:test'
 * @import { FSWatcher } from 'chokidar'
 * @import { DomStack as DomStackInstance } from '../../index.js'
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsPromises, { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { after, before, describe, mock, test } from 'node:test'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import chokidar from 'chokidar'
import pino from 'pino'

/** @type {typeof DomStackInstance} */
let DomStack
/** @type {string[]} */
const analyzerReads = []

/** @param {string} name @param {string} [helper] */
const layout = (name, helper = './label.js') => `
  import { label } from ${JSON.stringify(helper)}
  import { appendFileSync, existsSync } from 'node:fs'
  export default ({ vars, children }) => {
    appendFileSync(new URL('../renders.jsonl', import.meta.url), JSON.stringify({ layout: ${JSON.stringify(name)}, title: vars.title }) + '\\n')
    if (existsSync(new URL('../fail-render', import.meta.url))) throw new Error('intentional dependency watch render failure')
    return '<main data-layout="${name}" data-label="' + label + '">' + children + '</main>'
  }`

/** @param {string} body @param {string} [selectedLayout] */
const markdown = (body, selectedLayout = 'root') => `---\ntitle: Alpha\nlayout: ${selectedLayout}\n---\n${body}\n`

/**
 * Only source event delivery is fake. Workers, discovery, analysis, esbuild and
 * output writes are real. Canonical repo-local paths satisfy watcher observation
 * (macOS /var temporary paths can otherwise be aliases of /private/var).
 * @param {TestContext} t
 * @param {Record<string, string>} [files]
 * @param {string[]} [ignore]
 */
async function fixture (t, files = {}, ignore = []) {
  const root = await realpath(await mkdtemp(join(import.meta.dirname, '.tmp-dependency-')))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  /** @type {string[]} */
  const logs = []
  const dom = new DomStack(src, dest, {
    metafile: false,
    domstackManifest: false,
    ignore,
    logger: pino({ level: 'info' }, { write: line => logs.push(JSON.parse(line).msg) }),
  })
  /** @type {(EventEmitter & { closed: boolean, close: () => Promise<void>, getWatched: FSWatcher['getWatched'] })[]} */
  const watchers = []
  let failStartup = false
  const watch = chokidar.watch
  /** @param {Parameters<typeof watch>} args */
  const sourceWatch = (...args) => {
    if (args[0] !== src) return watch(...args)
    // Use Chokidar's real traversal/membership rather than approximating its
    // directory filters, atomic exclusions or symlink handling. Only delivery
    // of source edits is manual; readiness and resource cleanup remain real.
    const source = watch(...args)
    const fake = Object.assign(new EventEmitter(), {
      closed: false,
      getWatched: () => source.getWatched(),
      async close () {
        fake.closed = true
        await source.close()
      },
    })
    watchers.push(fake)
    source.on('error', error => { if (!fake.closed) fake.emit('error', error) })
    source.once('ready', () => {
      if (fake.closed) return
      if (failStartup) {
        failStartup = false
        fake.emit('error', new Error('intentional source watcher startup failure'))
      } else fake.emit('ready')
    })
    return /** @type {FSWatcher} */ (/** @type {unknown} */ (fake))
  }
  t.mock.method(chokidar, 'watch', sourceWatch)
  t.after(async () => {
    try {
      if (dom.watching) await dom.stopWatching()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  /** @param {string} name @param {string} content */
  const write = async (name, content) => {
    const filepath = join(src, name)
    await mkdir(dirname(filepath), { recursive: true })
    await writeFile(filepath, content)
  }
  await Promise.all(Object.entries({
    'global.vars.js': "export default { layout: 'root' }",
    'root.layout.js': layout('root'),
    'other.layout.js': layout('other', './other-label.js'),
    'label.js': "export const label = 'initial'",
    'other-label.js': "export const label = 'other-initial'",
    'a/page.md': markdown('Initial Markdown'),
    'b/page.html': '<p>Initial HTML</p>',
    'b/page.vars.js': "export default { title: 'Beta' }",
    ...files,
  }).map(([name, content]) => write(name, content)))
  let readCursor = analyzerReads.length
  const watcher = () => {
    const current = watchers.at(-1)
    assert.ok(current, 'source watcher has been created')
    return current
  }
  /** @param {string} name @param {'change' | 'add' | 'unlink'} [type] */
  const emit = (name, type = 'change') => watcher().emit(type, join(src, name))
  return {
    root,
    src,
    dom,
    logs,
    watchers,
    watcher,
    write,
    emit,
    resetReads () { readCursor = analyzerReads.length },
    reads () { return analyzerReads.slice(readCursor).filter(path => path.startsWith(root + '/')).map(path => relative(src, path)) },
    failNextStart () { failStartup = true },
    /** @param {string} [name] */
    output: (name = 'a/index.html') => readFile(join(dest, name), 'utf8'),
    async renders () {
      const text = await readFile(join(root, 'renders.jsonl'), 'utf8')
      return /** @type {{ layout: string, title: string }[]} */ (text.trim().split('\n').map(line => JSON.parse(line)))
    },
    async start () {
      const report = await dom.watch({ serve: false })
      assert.deepEqual(report.pageBuildResults?.errors, [], 'initial page build succeeds')
      return report
    },
    /** @param {string} name @param {'change' | 'add' | 'unlink'} [type] */
    async deliver (name, type = 'change') {
      emit(name, type)
      await nextTurn()
      await dom.settled()
    },
  }
}

/** @param {() => Promise<boolean>} predicate */
async function waitForBundle (predicate) {
  const deadline = Date.now() + 8000
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, 'real esbuild watcher publishes the changed browser helper')
    await delay(20)
  }
}

/** @param {TestContext} t @param {string} filepath */
function pauseObservation (t, filepath) {
  const entered = Promise.withResolvers()
  const resumed = Promise.withResolvers()
  const original = fsPromises.realpath
  let paused = false
  /** @param {Parameters<typeof original>} args */
  async function gatedRealpath (...args) {
    if (!paused && args[0] === filepath) {
      paused = true
      entered.resolve(undefined)
      await resumed.promise
    }
    return original(...args)
  }
  const probe = t.mock.method(fsPromises, 'realpath', gatedRealpath)
  syncBuiltinESMExports()
  t.after(() => {
    probe.mock.restore()
    syncBuiltinESMExports()
  })
  return {
    entered: () => Promise.race([
      entered.promise,
      delay(8000, undefined, { ref: false }).then(() => assert.fail('analysis reaches the realpath observation gate')),
    ]),
    release: () => resumed.resolve(undefined),
  }
}

describe('watch coordinator dependency analysis', { concurrency: false, timeout: 60_000 }, () => {
  before(async () => {
    // The installed CJS analyzer destructures readFileSync at module load. Install
    // before importing DomStack, and count only its actual reads, not worker I/O,
    // module loading, fixture assertions, or supplied rebuild options.
    const readFileSync = fs.readFileSync
    /** @param {Parameters<typeof readFileSync>} args */
    const probe = (...args) => {
      if (typeof args[0] === 'string' && args[0].includes('.tmp-dependency-') &&
        new Error().stack?.includes('@11ty/dependency-tree-esm/main.js')) {
        analyzerReads.push(resolve(args[0]))
      }
      return readFileSync(...args)
    }
    mock.method(fs, 'readFileSync', probe)
    syncBuiltinESMExports()
    ;({ DomStack } = await import('../../index.js'))
  })
  after(() => {
    mock.restoreAll()
    syncBuiltinESMExports()
  })

  test('warm Markdown and HTML skip analyzer work while current frontmatter refreshes layout routes', async t => {
    const site = await fixture(t)
    await site.start()
    const membership = t.mock.method(site.watcher(), 'getWatched')
    assert.ok(site.reads().includes('root.layout.js'), 'cold watch really runs the parent analyzer')
    assert.ok(site.reads().includes('label.js'), 'the analyzer traverses ordinary imports')

    site.resetReads()
    await site.write('a/page.md', markdown('Switched layout', 'other'))
    await site.deliver('a/page.md')
    assert.deepEqual(site.reads(), [], 'filtered Markdown build opts into actual analysis reuse')
    assert.match(await site.output(), /data-layout="other".*Switched layout/s)
    await site.write('b/page.html', '<p>Warm HTML</p>')
    await site.deliver('b/page.html')
    assert.deepEqual(site.reads(), [], 'HTML-only edits also reuse the import closures')
    assert.match(await site.output('b/index.html'), /Warm HTML/)
    assert.equal(membership.mock.callCount(), 0, 'warm analysis does not snapshot watcher membership')

    let cursor = (await site.renders()).length
    await site.write('label.js', "export const label = 'old-layout-fresh'")
    await site.deliver('label.js')
    assert.ok(site.reads().includes('label.js'), 'a delivered helper change invalidates its real analysis')
    assert.equal(membership.mock.callCount(), 1, 'one watcher snapshot serves the entire invalidated closure')
    assert.deepEqual((await site.renders()).slice(cursor), [{ layout: 'root', title: 'Beta' }], 'old layout no longer selects Alpha')
    assert.match(await site.output('b/index.html'), /old-layout-fresh/)
    assert.doesNotMatch(await site.output(), /old-layout-fresh/)

    cursor = (await site.renders()).length
    site.resetReads()
    await site.write('other-label.js', "export const label = 'new-layout-fresh'")
    await site.deliver('other-label.js')
    assert.ok(site.reads().includes('other-label.js'))
    assert.equal(membership.mock.callCount(), 2, 'the next analysis pass obtains fresh watcher membership')
    assert.deepEqual((await site.renders()).slice(cursor), [{ layout: 'other', title: 'Alpha' }], 'new layout routes to the current page')
    assert.match(await site.output(), /new-layout-fresh.*Switched layout/s)
  })

  test('filtered raw events and browser-only skips invalidate analysis without an intervening page build', async t => {
    const site = await fixture(t, {
      'global.client.js': "import { message } from './browser.js'; console.log(message)",
      'browser.js': "import { message } from './old-browser-leaf.js'; export { message }",
      'old-browser-leaf.js': "export const message = 'browser-old'",
      'new-browser-leaf.js': "export const message = 'browser-new'",
    })
    await site.start()
    site.resetReads()
    await site.write('a/page.md', markdown('Warm before raw events'))
    await site.deliver('a/page.md')
    assert.deepEqual(site.reads(), [])

    for (const type of /** @type {const} */ (['change', 'add', 'unlink'])) {
      if (type === 'unlink') await rm(join(site.src, 'untracked.txt'))
      else await site.write('untracked.txt', type)
      const renders = await site.renders()
      site.resetReads()
      await site.deliver('untracked.txt', type)
      assert.deepEqual(await site.renders(), renders, 'filtered raw events do not build pages')
      assert.deepEqual(site.reads(), [], 'no intervening analysis captures the dirty event')
      await site.write('a/page.md', markdown('After filtered ' + type))
      await site.deliver('a/page.md')
      assert.ok(site.reads().includes('root.layout.js'), 'even a filtered event invalidates retained analysis')
      assert.match(await site.output(), new RegExp('After filtered ' + type))
      site.resetReads()
      await site.deliver('a/page.md')
      assert.deepEqual(site.reads(), [], 'successful analysis becomes reusable again')
    }

    const renders = await site.renders()
    await site.write('browser.js', "import { message } from './new-browser-leaf.js'; export { message }")
    await site.deliver('browser.js')
    assert.deepEqual(await site.renders(), renders, 'known browser-only helper skips the page phase')
    assert.deepEqual(site.reads(), [], 'browser import change remains dirty until a later page build')
    await site.write('a/page.md', markdown('Refresh browser routes'))
    await site.deliver('a/page.md')
    assert.ok(site.reads().includes('global.client.js'))
    assert.ok(site.reads().includes('new-browser-leaf.js'), 'later analysis follows the actual changed import')
    assert.ok(!site.reads().includes('root.layout.js'), 'unaffected server closure stays warm')
    assert.match(await site.output(), /Refresh browser routes/)

    const refreshedRenders = await site.renders()
    site.resetReads()
    await site.write('new-browser-leaf.js', "export const message = 'browser-fresh'")
    await site.deliver('new-browser-leaf.js')
    assert.deepEqual(await site.renders(), refreshedRenders, 'new helper is now known browser-only, not an unknown-event full build')
    assert.deepEqual(site.reads(), [])
    await waitForBundle(async () => (await site.output('global.client.js')).includes('browser-fresh'))
    await site.write('label.js', "export const label = 'server-fresh'")
    await site.deliver('label.js')
    assert.ok(site.reads().includes('label.js'))
    assert.ok(site.reads().includes('new-browser-leaf.js'), 'second skipped browser edit also remains dirty')
    assert.match(await site.output(), /server-fresh.*Refresh browser routes/s)
  })

  test('failed page work forces fresh analysis on recovery before warm reuse resumes', async t => {
    const site = await fixture(t, { 'recovery-label.js': "export const label = 'recovered'" })
    await site.start()
    site.resetReads()
    const previous = await site.output()
    await writeFile(join(site.root, 'fail-render'), '')
    await site.write('a/page.md', markdown('Failed candidate'))
    await site.deliver('a/page.md')
    assert.ok(site.logs.some(line => line.includes('intentional dependency watch render failure')))
    assert.equal(await site.output(), previous)
    assert.deepEqual(site.reads(), [], 'failed rendering does not run dependency analysis')

    // No helper/layout event: recovery, rather than recordEvent invalidation,
    // must discard the successful pre-failure closure and reread this import.
    await site.write('root.layout.js', layout('root', './recovery-label.js'))
    await site.write('a/page.md', markdown('Recovered Markdown'))
    await rm(join(site.root, 'fail-render'))
    await site.write('b/page.html', '<p>Recovery trigger</p>')
    await site.deliver('b/page.html')
    assert.ok(site.reads().includes('root.layout.js'))
    assert.ok(site.reads().includes('recovery-label.js'))
    assert.match(await site.output(), /recovered.*Recovered Markdown/s)
    assert.match(await site.output('b/index.html'), /recovered.*Recovery trigger/s)
    site.resetReads()
    await site.write('a/page.md', markdown('Warm after recovery'))
    await site.deliver('a/page.md')
    assert.deepEqual(site.reads(), [], 'successful recovery restores reuse')
    await site.write('recovery-label.js', "export const label = 'recovered-helper-fresh'")
    await site.deliver('recovery-label.js')
    assert.ok(site.reads().includes('recovery-label.js'))
    assert.match(await site.output(), /recovered-helper-fresh.*Warm after recovery/s)
  })

  test('watcher errors distrust the entire session; stop/start and startup-error cleanup establish fresh observation', async t => {
    const site = await fixture(t, { 'restart-label.js': "export const label = 'restarted'" })
    await site.start()
    const oldWatcher = site.watcher()
    oldWatcher.emit('error', new Error('intentional observation loss'))
    assert.ok(site.logs.some(line => line.includes('intentional observation loss')))
    for (const body of ['First untrusted build', 'Still untrusted after success']) {
      site.resetReads()
      await site.write('a/page.md', markdown(body))
      await site.deliver('a/page.md')
      assert.ok(site.reads().includes('root.layout.js'), 'successful analysis cannot repair lost event history')
      assert.match(await site.output(), new RegExp(body))
    }

    await site.dom.stopWatching()
    assert.equal(oldWatcher.closed, true)
    await site.write('root.layout.js', layout('root', './restart-label.js'))
    site.resetReads()
    await site.start()
    assert.ok(site.reads().includes('restart-label.js'), 'stopped-session edits receive cold analysis')
    assert.match(await site.output(), /restarted/)
    site.resetReads()
    oldWatcher.emit('change', join(site.src, 'label.js'))
    oldWatcher.emit('error', new Error('obsolete watcher must not poison the new session'))
    await site.write('a/page.md', markdown('New trusted session'))
    await site.deliver('a/page.md')
    assert.deepEqual(site.reads(), [], 'fresh session reuses analysis and rejects old callbacks')
    assert.match(await site.output(), /restarted.*New trusted session/s)

    await site.dom.stopWatching()
    site.failNextStart()
    await assert.rejects(site.dom.watch({ serve: false }), /intentional source watcher startup failure/)
    assert.equal(site.dom.watching, false)
    assert.equal(site.watcher().closed, true, 'failed startup releases its source watcher')
    site.resetReads()
    await site.start()
    assert.ok(site.reads().includes('root.layout.js'))
    site.resetReads()
    await site.write('a/page.md', markdown('After startup failure'))
    await site.deliver('a/page.md')
    assert.deepEqual(site.reads(), [], 'startup failure does not leak distrust into the next session')
    assert.match(await site.output(), /restarted.*After startup failure/s)
  })

  test('traversal and atomic exclusions cannot retain a silently changed helper import edge', async t => {
    for (const directory of ['blocked', 'helpers~']) {
      await t.test(directory, async t => {
        const helper = directory + '/helper.js'
        const site = await fixture(t, {
          'root.layout.js': layout('root', './' + helper),
          [helper]: "import { label as value } from '../before.js'; export const label = value",
          'before.js': "export const label = 'before-edge'",
          'after.js': "export const label = 'after-edge'",
        }, directory === 'blocked' ? ['blocked', '!blocked/'] : [])
        await site.start()
        assert.equal(site.watcher().getWatched()[join(site.src, directory)], undefined, 'real Chokidar never traverses the helper directory')
        assert.match(await site.output(), /before-edge/)
        const membership = t.mock.method(site.watcher(), 'getWatched')
        const renders = await site.renders()
        await site.write(helper, "import { label as value } from '../after.js'; export const label = value")
        assert.deepEqual(await site.renders(), renders, 'no helper event or capturing page build is delivered')
        site.resetReads()
        await site.write('a/page.md', markdown('After silent import change'))
        await site.deliver('a/page.md')
        assert.ok(site.reads().includes('root.layout.js'))
        assert.ok(site.reads().includes(helper), 'unobserved helper forces fresh analysis')
        assert.ok(site.reads().includes('after.js'), 'analysis follows the changed import edge')
        assert.ok(!site.reads().includes('before.js'), 'the old edge is not analyzed')
        assert.ok(!site.reads().includes('other.layout.js'), 'unrelated observed closures stay warm')
        assert.equal(membership.mock.callCount(), 1, 'one membership snapshot covers the pass')
        assert.match(await site.output(), /after-edge.*After silent import change/s)

        // Output alone could be fresh even with stale routing. A newly imported
        // helper must target the layout consumers, not fall back to a full build.
        const cursor = site.logs.length
        await site.write('after.js', "export const label = 'new-edge-fresh'")
        await site.deliver('after.js')
        assert.ok(!site.logs.slice(cursor).some(line => line.includes('Triggering full rebuild')))
        assert.match(await site.output(), /new-edge-fresh.*After silent import change/s)
        assert.match(await site.output('b/index.html'), /new-edge-fresh/)
        site.resetReads()
        await site.write('a/page.md', markdown('Still unobserved'))
        await site.deliver('a/page.md')
        assert.ok(site.reads().includes(helper), 'later successful builds still cannot retain the excluded closure')
        assert.match(await site.output(), /new-edge-fresh.*Still unobserved/s)
      })
    }
  })

  test('watcher error during in-flight observation prevents publication and stays untrusted across later builds', async t => {
    const site = await fixture(t)
    await site.start()
    const gate = pauseObservation(t, join(site.src, 'root.layout.js'))
    site.resetReads()
    await site.write('label.js', "export const label = 'in-flight-error'")
    const building = site.deliver('label.js')
    try {
      await gate.entered()
      assert.ok(site.reads().includes('root.layout.js'), 'real analysis is running when observation is lost')
      site.watcher().emit('error', new Error('in-flight observation loss'))
    } finally {
      gate.release()
      await building
    }
    assert.ok(site.logs.some(line => line.includes('in-flight observation loss')))
    assert.match(await site.output(), /in-flight-error/)
    for (const body of ['Recovery pass', 'Successful but untrusted']) {
      site.resetReads()
      await site.write('a/page.md', markdown(body))
      await site.deliver('a/page.md')
      assert.ok(site.reads().includes('root.layout.js'), 'neither in-flight nor subsequent analysis repairs event history')
      assert.match(await site.output(), new RegExp('in-flight-error.*' + body, 's'))
    }
  })

  test('stop drains in-flight observation without retaining it for the next session', async t => {
    const site = await fixture(t, { 'restart-label.js': "export const label = 'after-in-flight-stop'" })
    await site.start()
    const oldWatcher = site.watcher()
    const gate = pauseObservation(t, join(site.src, 'root.layout.js'))
    site.resetReads()
    await site.write('label.js', "export const label = 'in-flight-stop'")
    const building = site.deliver('label.js')
    let stopped = false
    let stopping = Promise.resolve()
    try {
      await gate.entered()
      assert.ok(site.reads().includes('root.layout.js'))
      stopping = site.dom.stopWatching().then(() => { stopped = true })
      await nextTurn()
      assert.equal(stopped, false, 'stop waits for the active analysis pass')
    } finally {
      gate.release()
      await Promise.all([building, stopping])
    }
    assert.equal(stopped, true)
    assert.equal(oldWatcher.closed, true)
    assert.equal(site.dom.watching, false)
    await site.write('root.layout.js', layout('root', './restart-label.js'))
    site.resetReads()
    await site.start()
    assert.ok(site.reads().includes('restart-label.js'), 'restart analyzes the stopped-session import edit')
    assert.match(await site.output(), /after-in-flight-stop/)
    site.resetReads()
    oldWatcher.emit('error', new Error('obsolete in-flight session'))
    await site.write('a/page.md', markdown('Warm after in-flight stop'))
    await site.deliver('a/page.md')
    assert.deepEqual(site.reads(), [], 'the new session is trusted and warm')
    assert.match(await site.output(), /after-in-flight-stop.*Warm after in-flight stop/s)
  })

  test('ignored, external and symlink dependencies never retain an unobserved closure', async t => {
    for (const kind of ['ignored', 'external', 'symlink']) {
      await t.test(kind, async t => {
        const helper = kind === 'external' ? '../outside.js' : kind === 'ignored' ? './ignored.js' : './alias.js'
        const target = kind === 'external' ? '../outside.js' : kind === 'ignored' ? 'ignored.js' : 'target.js'
        const site = await fixture(t, {
          'root.layout.js': layout('root', helper),
          [target]: "export const label = 'unobserved-initial'",
        }, kind === 'ignored' ? ['ignored.js'] : [])
        if (kind === 'symlink') await symlink(join(site.src, target), join(site.src, 'alias.js'))
        await site.start()
        assert.match(await site.output(), /unobserved-initial/)
        for (const version of ['one', 'two']) {
          site.resetReads()
          // Deliberately no helper event: it is outside reliable observation.
          await site.write(target, `export const label = 'unobserved-${version}'`)
          await site.write('a/page.md', markdown('Markup ' + version))
          await site.deliver('a/page.md')
          assert.ok(site.reads().includes('root.layout.js'), kind + ' closure is analyzed on every successful pass')
          assert.ok(site.reads().includes(helper.replace(/^\.\//, '')))
          assert.ok(!site.reads().includes('other.layout.js'), 'fully observed unrelated closure still reuses analysis')
          assert.match(await site.output(), new RegExp('unobserved-' + version + '.*Markup ' + version, 's'))
        }
      })
    }
  })
})
