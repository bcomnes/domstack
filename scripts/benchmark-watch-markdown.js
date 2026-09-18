// Run from any cwd: node scripts/benchmark-watch-markdown.js --pages 100 --edits 10 --sessions 3
// This measures real watch latency, not just Markdown rendering. No timing assertions.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import pino from 'pino'
import { DomStack } from '../index.js'

const { values } = parseArgs({
  options: {
    pages: { type: 'string', default: '100' },
    edits: { type: 'string', default: '10' },
    sessions: { type: 'string', default: '3' },
    warmup: { type: 'string', default: '1' },
    settings: { type: 'string', default: 'on' },
    title: { type: 'string', default: 'explicit' },
    'timeout-ms': { type: 'string', default: '30000' },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(`Usage: node scripts/benchmark-watch-markdown.js [options]
  --pages N        Total Markdown pages, minimum 2 (default 100)
  --edits N        Measured one-page edits per session (default 10)
  --sessions N     Fresh temporary sites/watchers, sequential in one process (default 3)
  --warmup N       Unmeasured edits per session (default 1)
  --title explicit|inferred  Keep the fixture title or infer its H1 (default explicit)
  --settings on|plain|off    Instrument, pass through, or omit settings (default on)
  --timeout-ms N   Deadline per startup/edit operation (default 30000)
                  Shutdown has a minimum 30-second grace period

Copies test-cases/page-outputs/src and replicates its article, adding a fixed
Markdown payload. Checks HTML, raw Markdown, metadata, and one untouched sibling.
No server, no search/LLM outputs, no Oro fixture, no runtime/package modifications.
Every copied page uses the selected title mode. Explicit preserves the original
workload; inferred removes only its frontmatter title to exercise H1 extraction.
Settings 'on' appends one line per callback outside src/dest: it counts configured
renderer initialization, not title parsers, and adds I/O cost that optimizations may
remove. Use 'plain' to exercise the same async settings import/callback path without
counter I/O. 'off' omits that path; it is not an overhead-corrected 'on' measurement.
JSON retains every sample (including warm-ups), pooled timings, and single-build /
multi-build latency groups. Build counts and timestamped logger messages include
the post-edit drain; outputMs and settledMs stop BEFORE that drain. No samples are
discarded for duplicate builds; empty groups have count 0 and null summaries.
Fixture setup, 500ms quiet drains, correctness checks, and cleanup are not timed.
Draining repeats until logs stay quiet across settled() and a 500ms wait; it is a
heuristic, not a guarantee against arbitrarily late native notifications. Polling
(5ms), in-memory logging, and instrumentation add overhead. Sessions share a process.
Rebaseline each configuration with this script: draining also changes edit pacing.`)
} else {
  await main()
}

async function main () {
  const config = Object.fromEntries(['pages', 'edits', 'sessions', 'warmup', 'timeout-ms'].map(key => {
    const value = Number(values[key])
    const minimum = key === 'warmup' ? 0 : key === 'pages' ? 2 : 1
    assert.ok(Number.isSafeInteger(value) && value >= minimum, `--${key} must be an integer >= ${minimum}`)
    return [key, value]
  }))
  assert.ok(['on', 'plain', 'off'].includes(values.settings), '--settings must be on, plain, or off')
  assert.ok(['explicit', 'inferred'].includes(values.title), '--title must be explicit or inferred')
  const instrument = values.settings === 'on'
  const timeoutMs = config['timeout-ms']
  const abort = new AbortController()
  const interrupt = () => abort.abort(new Error('Benchmark interrupted'))

  // Output polling establishes that Chokidar observed this particular edit before
  // settled() is called. Calling settled() immediately after writeFile can race it.
  const pollMs = 5
  const quietMs = 500 // Match the test helpers: longer than Chokidar's atomic window.
  const fixture = new URL('../test-cases/page-outputs/src/', import.meta.url)
  const base = await readFile(new URL('article/page.md', fixture), 'utf8')
  const payload = '\n[[toc]]\n\n' + Array.from({ length: 8 }, (_, index) => [
    `## Section ${index + 1}`,
    '',
    '**Bold**, *emphasis*, ==marked==, H~2~O, x^2^, :smile: and [a link](https://example.com).',
    '',
    '- [x] Checked task',
    '- [ ] Pending task',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| Markdown | Watch |',
    '',
    '> [!NOTE]',
    '> A deterministic watch benchmark paragraph.',
    '',
    '```javascript',
    `const section = ${index + 1}`,
    'console.log(section)',
    '```',
    '',
    `Footnote[^note${index}].`,
    '',
    `[^note${index}]: A deterministic footnote.`,
    '',
  ].join('\n')).join('\n')
  const document = (values.title === 'inferred' ? base.replace(/^title:.*\r?\n/m, '') : base) + payload
  // readMarkdownContent preserves the newline after the frontmatter delimiter.
  const rawDocument = document.replace(/^---\r?\n(?:[\s\S]*?\r?\n)?---/, '')
  const sessions = []

  /** Bound asynchronous work without leaving timeout handles behind. */
  async function bounded (promise, label, signal = abort.signal, deadlineMs = timeoutMs) {
    let timer
    let onAbort
    try {
      return await Promise.race([
        promise,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out after ${deadlineMs}ms: ${label}`)), deadlineMs)
          onAbort = () => reject(signal.reason)
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
        }),
      ])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    for (let session = 1; session <= config.sessions; session++) {
      abort.signal.throwIfAborted()
      const root = await mkdtemp(join(tmpdir(), 'domstack-benchmark-markdown-'))
      const src = join(root, 'src')
      const dest = join(root, 'public')
      const counter = join(root, 'renderer-inits.log')
      const logs = []
      const site = new DomStack(src, dest, {
        static: true,
        domstackManifest: false,
        logger: pino({ level: 'debug' }, {
          write: line => logs.push({ ...JSON.parse(line), observedAt: performance.now() }),
        }),
      })
      const read = name => readFile(join(dest, name), 'utf8')
      const countInits = async () => instrument ? (await readFile(counter, 'utf8')).split('\n').length - 1 : null
      const checkErrors = () => {
        const errors = logs.filter(entry => entry.level >= 50 || entry.msg === 'Build Failed!')
        assert.equal(errors.length, 0, JSON.stringify(errors))
      }
      const buildCount = () => logs.filter(entry => entry.msg === 'Build Success!').length
      const drain = label => bounded((async () => {
        const deadline = performance.now() + timeoutMs
        while (true) {
          abort.signal.throwIfAborted()
          assert.ok(performance.now() < deadline, `${label}: events did not become quiet`)
          await site.settled()
          const cursor = logs.length
          await delay(quietMs, undefined, { signal: abort.signal })
          await site.settled()
          checkErrors()
          if (cursor === logs.length) return
        }
      })(), label)
      const snapshot = async name => {
        const info = await stat(join(dest, name), { bigint: true })
        return { content: await read(name), mtime: info.mtimeNs, ctime: info.ctimeNs, inode: info.ino }
      }
      const sibling = 'sibling-0001'
      const siblingOutputs = ['index.html', 'source.md', 'metadata.json'].map(name => `${sibling}/${name}`)

      try {
        await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
        await cp(fixture, src, { recursive: true })
        await writeFile(join(src, 'article/page.md'), document)
        for (let page = 1; page < config.pages; page++) {
          await cp(join(src, 'article'), join(src, `sibling-${String(page).padStart(4, '0')}`), { recursive: true })
        }
        await mkdir(dest)
        if (instrument) {
          await writeFile(counter, '')
          await writeFile(join(src, 'markdown-it.settings.js'), `import { appendFileSync } from 'node:fs'
export default md => {
  appendFileSync(${JSON.stringify(counter)}, 'init\\n')
  return md
}
`)
        } else if (values.settings === 'plain') {
          await writeFile(join(src, 'markdown-it.settings.js'), 'export default md => md\n')
        }

        const started = performance.now()
        const initial = await bounded(site.watch({ serve: false }), 'watch startup')
        const startupMs = performance.now() - started
        checkErrors()
        assert.equal(initial.siteData.pages.length, config.pages)
        assert.equal(initial.pageBuildResults.outputs.length, config.pages * 3)
        const initialRendererInits = await countInits()

        // Drain delayed fixture-creation notifications outside the measured edits.
        await drain('startup quiet period')
        const readyRendererInits = await countInits()
        const readyBuilds = buildCount()
        const siblingBefore = await Promise.all(siblingOutputs.map(snapshot))
        const metadata = JSON.parse(await read('article/metadata.json'))
        assert.deepEqual(metadata, {
          title: 'An article with sidecars', url: '/article/', edition: 'Example edition',
        })
        const initialHtml = await read('article/index.html')
        for (const expected of ['<main>', 'table-of-contents', 'hljs-keyword', 'footnote-ref', 'task-list-item-checkbox', '<table>']) {
          assert.ok(initialHtml.includes(expected), `Initial HTML missing ${expected}`)
        }
        assert.equal(await read('article/source.md'), rawDocument)
        if (instrument) assert.ok(readyRendererInits > 0, 'Settings instrumentation must be invoked')

        const samples = []
        for (let edit = 0; edit < config.warmup + config.edits; edit++) {
          abort.signal.throwIfAborted()
          const marker = `BENCHMARK-EDIT-${String(edit + 1).padStart(6, '0')}`
          const suffix = `\n${marker}\n`
          const beforeInits = await countInits()
          const beforeBuilds = buildCount()
          const logCursor = logs.length
          const start = performance.now()
          const timings = await bounded((async () => {
            await writeFile(join(src, 'article/page.md'), document + suffix)
            while (true) {
              abort.signal.throwIfAborted()
              checkErrors()
              if ((await read('article/index.html')).includes(`<p>${marker}</p>`)) break
              assert.ok(performance.now() - start < timeoutMs, `Timed out waiting for HTML marker ${marker}`)
              await delay(pollMs, undefined, { signal: abort.signal })
            }
            const outputMs = performance.now() - start
            await site.settled()
            return { outputMs, settledMs: performance.now() - start }
          })(), `edit ${edit + 1}`)
          checkErrors()
          const buildsBeforeDrain = buildCount() - beforeBuilds
          assert.ok(buildsBeforeDrain >= 1, 'Expected a successful watch rebuild')
          // Keep delayed duplicates with this edit, not the following sample.
          // Latencies above exclude this quiet wait and any rebuilds it drains.
          const drainStarted = performance.now()
          await drain(`edit ${edit + 1} quiet period`)
          const drainMs = performance.now() - drainStarted
          const builds = buildCount() - beforeBuilds
          assert.ok((await read('article/index.html')).includes(`<p>${marker}</p>`))
          assert.equal(await read('article/source.md'), rawDocument + suffix)
          assert.deepEqual(JSON.parse(await read('article/metadata.json')), metadata)
          assert.deepEqual(await Promise.all(siblingOutputs.map(snapshot)), siblingBefore, 'Sibling outputs must not be rewritten')
          const afterInits = await countInits()
          samples.push({
            edit: edit + 1,
            warmup: edit < config.warmup,
            ...timings,
            rendererInits: instrument ? afterInits - beforeInits : null,
            builds,
            buildsBeforeDrain,
            buildsDuringDrain: builds - buildsBeforeDrain,
            buildGroup: builds === 1 ? 'singleBuild' : 'multiBuild',
            drainMs,
            events: logs.slice(logCursor).map(({ observedAt, level, msg }) => ({
              atMs: observedAt - start,
              phase: observedAt - start <= timings.settledMs ? 'timed' : 'drain',
              level,
              msg,
            })),
          })
        }
        const measured = samples.filter(sample => !sample.warmup)
        const report = {
          session,
          startupMs,
          initialRendererInits,
          readyRendererInits,
          readyBuilds,
          outputMs: summarize(measured.map(sample => sample.outputMs)),
          settledMs: summarize(measured.map(sample => sample.settledMs)),
          latencyGroups: groupLatencies(measured),
          samples,
        }
        sessions.push(report)
        console.log(JSON.stringify({ type: 'session', ...report }))
      } finally {
        // Even a failed startup or assertion must release native/esbuild/copy watchers.
        // Cleanup must not inherit SIGINT's aborted signal or an intentionally
        // tiny operation timeout: startup work must drain before removing files.
        try {
          await bounded(site.stopWatching(), 'watch shutdown', new AbortController().signal, Math.max(timeoutMs, 30_000))
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    }
    const measured = sessions.flatMap(session => session.samples.filter(sample => !sample.warmup))
    console.log(JSON.stringify({
      type: 'summary',
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpu: cpus()[0]?.model,
      config: { ...config, title: values.title, settings: values.settings, pollMs, quietMs },
      workload: {
        fixture: 'test-cases/page-outputs/src',
        markdownBytesPerPage: Buffer.byteLength(document),
        payloadSections: 8,
        outputsPerPage: ['HTML', 'raw Markdown', 'JSON metadata'],
        editedPage: 'article/page.md',
        siblingChecked: 'sibling-0001 (contents, mtimeNs, ctimeNs, inode; all three outputs)',
        excluded: 'Oro, search/LLM producers, browser bundles, server, settings edits, cold-process isolation',
      },
      measuredEdits: measured.length,
      warmupEdits: config.sessions * config.warmup,
      startupMs: summarize(sessions.map(session => session.startupMs)),
      outputMs: summarize(measured.map(sample => sample.outputMs)),
      settledMs: summarize(measured.map(sample => sample.settledMs)),
      latencyGroups: groupLatencies(measured),
      rendererInitsPerMeasuredEdit: instrument ? summarize(measured.map(sample => sample.rendererInits)) : null,
      successfulBuildsPerMeasuredEdit: summarize(measured.map(sample => sample.builds)),
    }))
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

function groupLatencies (samples) {
  return Object.fromEntries(['singleBuild', 'multiBuild'].map(group => {
    const selected = samples.filter(sample => sample.buildGroup === group)
    return [group, {
      count: selected.length,
      outputMs: summarize(selected.map(sample => sample.outputMs)),
      settledMs: summarize(selected.map(sample => sample.settledMs)),
    }]
  }))
}

function summarize (values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  return {
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  }
}
