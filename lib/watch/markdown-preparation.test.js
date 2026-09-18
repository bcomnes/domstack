/**
 * @import { TestContext } from 'node:test'
 * @import { InputEvent } from './incremental-global-data-tests/helpers.js'
 * @typedef {{ previous: { filepath: string, sourceId: string, title: string }[] | null, resetReason: string | null, reads: string[] }} PreparationRun
 */
import assert from 'node:assert/strict'
import fsPromises, { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { article, assertDelta, fixture, waitFor } from './incremental-global-data-tests/helpers.js'

const options = { timeout: 30_000 }

// Layouts load before page initialization. Like output-cache.test.js, instrument
// only the worker's fs bindings; the control log lives outside the watched src.
const preparationProbeLayout = `import fs from 'node:fs/promises'
  import { appendFileSync } from 'node:fs'
  import { syncBuiltinESMExports } from 'node:module'
  import { relative } from 'node:path'
  import { workerData } from 'node:worker_threads'
  const log = new URL('../preparation.jsonl', import.meta.url)
  const record = entry => appendFileSync(log, JSON.stringify(entry) + '\\n')
  const previous = workerData.opts.previousMarkdownPreparation
  record({
    kind: 'input',
    previous: previous == null ? null : [...previous].map(([filepath, entry]) => ({
      filepath: relative(workerData.src, filepath),
      sourceId: entry.sourceId,
      title: entry.prepared.vars.title,
    })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    resetReason: workerData.opts.globalDataInputChanges?.resetReason ?? null,
  })
  const readFile = fs.readFile
  fs.readFile = async (...args) => {
    if (String(args[0]).endsWith('.md')) record({ kind: 'read', path: relative(workerData.src, String(args[0])) })
    return readFile(...args)
  }
  syncBuiltinESMExports()
  export default ({ vars, children }) => '<header>' + vars.title + '</header>' + children`

/** @param {{ src: string }} site @returns {Promise<PreparationRun[]>} */
async function preparationRuns (site) {
  const log = await readFile(join(site.src, '../preparation.jsonl'), 'utf8')
  /** @type {PreparationRun[]} */
  const runs = []
  for (const line of log.trim().split('\n')) {
    const entry = JSON.parse(line)
    if (entry.kind === 'input') {
      runs.push({ previous: entry.previous, resetReason: entry.resetReason, reads: [] })
    } else {
      const run = runs.at(-1)
      assert.ok(run, 'worker input is recorded before source reads')
      run.reads.push(entry.path)
    }
  }
  for (const run of runs) run.reads.sort()
  return runs
}

/**
 * @param {{ src: string }} site
 * @param {number} count
 * @param {Record<string, string> | null} previous
 * @param {string[]} reads
 * @param {string | null} [resetReason]
 */
async function assertPreparation (site, count, previous, reads, resetReason = null) {
  const runs = await preparationRuns(site)
  assert.equal(runs.length, count, 'one probe per build worker')
  assert.deepEqual(runs.at(-1), {
    previous: previous === null
      ? null
      : Object.entries(previous).map(([sourceId, title]) => ({
        filepath: sourceId, sourceId, title,
      })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    resetReason,
    reads: [...reads].sort(),
  })
}

/** @param {TestContext} t @param {Record<string, string>} [files] */
async function withoutProducer (t, files = {}) {
  const site = await fixture(t, {
    files: {
      'global.vars.js': "export default { layout: 'root' }",
      'root.layout.js': "export default ({ vars, children }) => '<header>' + vars.title + '</header>' + children",
      ...files,
    },
  })
  await rm(join(site.src, 'global.data.js'))
  await rm(join(site.src, 'data.json.template.js'))
  return {
    ...site,
    // The shared helper's rebuild requires a producer invocation; these sites
    // deliberately exercise preparation lifecycle without any global data.
    async rebuild (/** @type {InputEvent[]} */ events) {
      site.emit(events)
      await nextTurn()
      await site.dom.settled()
    },
  }
}

/** @param {{ dest: string }} site @param {string} [name] */
const output = (site, name = 'a/index.html') => readFile(join(site.dest, name), 'utf8')

/** @param {{ dest: string }} site @param {string} name */
const absent = (site, name) => assert.rejects(stat(join(site.dest, name)), { code: 'ENOENT' })

test('watch accepts Markdown preparation deltas and retains the baseline through a template-only build', options, async t => {
  const site = await withoutProducer(t, {
    'root.layout.js': preparationProbeLayout,
    'status.txt.template.js': "export const dataDeps = []; export default () => 'initial template'",
  })
  await site.start()
  await assertPreparation(site, 1, null, ['a/page.md', 'b/page.md'])

  await site.write('b/page.md', article('Beta two'))
  await site.rebuild([site.event('b/page.md')])
  await assertPreparation(site, 2, { 'a/page.md': 'Alpha', 'b/page.md': 'Beta' }, ['b/page.md'])
  assert.match(await output(site, 'b/index.html'), /<header>Beta two<\/header>/)

  await site.write('b/page.md', article('Beta three'))
  await site.rebuild([site.event('b/page.md')])
  await assertPreparation(site, 3, { 'a/page.md': 'Alpha', 'b/page.md': 'Beta two' }, ['b/page.md'])
  assert.match(await output(site, 'b/index.html'), /<header>Beta three<\/header>/)

  await site.write('status.txt.template.js', "export const dataDeps = []; export default () => 'changed template'")
  await site.rebuild([site.event('status.txt.template.js')])
  await assertPreparation(site, 4, { 'a/page.md': 'Alpha', 'b/page.md': 'Beta three' }, [])
  assert.equal(await output(site, 'status.txt'), 'changed template')

  await site.write('b/page.md', article('After template'))
  await site.rebuild([site.event('b/page.md')])
  await assertPreparation(site, 5, { 'a/page.md': 'Alpha', 'b/page.md': 'Beta three' }, ['b/page.md'])
  assert.match(await output(site, 'b/index.html'), /<header>After template<\/header>/)
})

test('broad configuration resets omit warm Markdown preparation and reread silently changed source', options, async t => {
  const site = await withoutProducer(t, {
    'root.layout.js': preparationProbeLayout,
    'markdown-it.settings.js': 'export default md => md',
  })
  await site.start()
  await assertPreparation(site, 1, null, ['a/page.md', 'b/page.md'])
  await site.write('b/page.md', article('Warm Beta'))
  await site.rebuild([site.event('b/page.md')])
  await assertPreparation(site, 2, { 'a/page.md': 'Alpha', 'b/page.md': 'Beta' }, ['b/page.md'])

  let builds = 2
  for (const [config, content, title, resetReason] of /** @type {const} */ ([
    ['global.vars.js', "export default { layout: 'root', changed: true }", 'After global vars', 'global-vars-changed'],
    ['markdown-it.settings.js', 'export default md => md.set({ typographer: false })', 'After settings', 'markdown-settings-changed'],
  ])) {
    await site.write('a/page.md', article(title, `Fresh body ${title}.`))
    await site.write(config, content)
    await site.rebuild([site.event(config)])
    await assertPreparation(site, ++builds, null, ['a/page.md', 'b/page.md'], resetReason)
    const html = await output(site)
    assert.ok(html.includes(`<header>${title}</header>`))
    assert.ok(html.includes(`Fresh body ${title}.`))

    // The reset's replacement baseline must itself be accepted by watch.
    await site.write('b/page.md', article('Warm Beta'))
    await site.rebuild([site.event('b/page.md')])
    await assertPreparation(site, ++builds, { 'a/page.md': title, 'b/page.md': 'Warm Beta' }, ['b/page.md'])
  }
})

test('a warm active Markdown snapshot survives an enqueued edit while raw reads see the current file', options, async t => {
  const site = await fixture(t, {
    files: {
      'global.vars.js': "export default { layout: 'root' }",
      'root.layout.js': preparationProbeLayout,
    },
  })
  await rename(join(site.src, 'global.data.js'), join(site.src, 'index-producer.js'))
  await site.write('global.data.js', `import index from './index-producer.js'
    import { appendFileSync, existsSync } from 'node:fs'
    import { writeFile } from 'node:fs/promises'
    import { setTimeout as delay } from 'node:timers/promises'
    const gate = new URL('../hold-producer', import.meta.url)
    export default async params => {
      const page = params.pages.find(page => page.sourceId === 'a/page.md')
      if (existsSync(gate)) {
        await writeFile(new URL('../snapshot-ready', import.meta.url), '')
        const deadline = Date.now() + 8000
        while (existsSync(gate)) {
          if (Date.now() > deadline) throw new Error('Timed out waiting for snapshot gate')
          await delay(10)
        }
      }
      const raw = await page.readMarkdownContent()
      const html = await page.renderInnerPage()
      appendFileSync(new URL('../snapshots.jsonl', import.meta.url), JSON.stringify({ title: page.vars.title, raw, html }) + '\\n')
      return index(params)
    }`)
  await site.start()
  await writeFile(site.gate, '')
  await site.write('b/page.md', article('Trigger warm build'))
  site.emit([site.event('b/page.md')])
  try {
    await waitFor(() => stat(join(site.src, '../snapshot-ready')).then(() => true, () => false), 'producer reached its gate after page initialization')
    await assertPreparation(site, 2, { 'a/page.md': 'Alpha', 'b/page.md': 'Beta' }, ['b/page.md'])
    await site.write('a/page.md', article('Changed Alpha', 'Changed body.'))
    site.emit([site.event('a/page.md')])
  } finally {
    await rm(site.gate, { force: true })
    await site.dom.settled()
  }

  const snapshots = (await readFile(join(site.src, '../snapshots.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(snapshots.length, 3, 'startup, warm active build, and buffered source edit')
  const active = snapshots[1]
  assert.equal(active.title, 'Alpha')
  assert.match(active.html, />Alpha<\/h1>/)
  assert.match(active.html, /Original body/)
  assert.doesNotMatch(active.html, /Changed Alpha|Changed body/)
  assert.match(active.raw, /# Changed Alpha\s+Changed body\./)
  assert.equal(snapshots[2].title, 'Changed Alpha')
  assert.match(snapshots[2].html, />Changed Alpha<\/h1>/)
  assert.match(snapshots[2].html, /Changed body/)
  assert.match(await output(site), /<header>Changed Alpha<\/header>.*Changed body/s)
  const calls = await site.calls()
  assert.equal(calls.length, 3)
  assertDelta(calls[1], ['b/page.md'])
  assertDelta(calls[2], ['a/page.md'])
  // The active build accepts B's delta without losing the cached A identity.
  // This final worker reads A twice: preparation, then the explicit raw read.
  await assertPreparation(site, 3, { 'a/page.md': 'Alpha', 'b/page.md': 'Trigger warm build' }, ['a/page.md', 'a/page.md'])
})

test('unchanged Markdown selected by a derived data key renders with the new data', options, async t => {
  const source = '---\nhandlebars: true\ndataDeps: [index]\n---\n# Stable subscriber\n\nSelected: {{data.index.[0].title}}\n'
  const site = await fixture(t, {
    files: {
      'a/page.md': source,
      'global.vars.js': "export default { layout: 'root' }",
      'root.layout.js': 'export default ({ children }) => children',
    },
  })
  let callbacks = 0
  const initial = await site.dom.watch({
    serve: false,
    onInitialBuild (result) {
      callbacks++
      assert.deepEqual(result.pageBuildResults?.errors, [])
      assert.ok(result.pageBuildResults)
      assert.equal(Object.hasOwn(result.pageBuildResults.report, 'markdownPreparationUpdate'), false, 'worker preparation metadata is removed before public callbacks')
    },
  })
  assert.equal(callbacks, 1)
  assert.ok(initial.pageBuildResults)
  assert.equal(Object.hasOwn(initial.pageBuildResults.report, 'markdownPreparationUpdate'), false)
  assert.match(await output(site), /Selected: Beta/)

  // A source document, not global.data or settings, changes the derived index.
  // A is absent from input upserts and only becomes selected by its dataDeps.
  for (const title of ['Second selection', 'Third selection']) {
    await site.write('b/page.md', article(title))
    assertDelta(await site.rebuild([site.event('b/page.md')]), ['b/page.md'])
    assert.match(await output(site), new RegExp(`Selected: ${title}`))
    assert.match(await output(site), /Stable subscriber/)
  }
  assert.equal(await readFile(join(site.src, 'a/page.md'), 'utf8'), source)
})

test('Markdown source edits and producer mutations cannot poison later nested frontmatter', options, async t => {
  const details = 'details:\n  author:\n    name: original\n  tags: [source]\n'
  const site = await fixture(t, {
    files: {
      'a/page.md': `---\n${details}dataDeps: [index]\nhandlebars: true\n---\n# Inferred title\n\nFirst body.\n\nSelected: {{data.index.[0].title}}\n`,
      'global.vars.js': "export default { layout: 'root' }",
      'root.layout.js': `export default ({ vars, children }) =>
        '<header>' + vars.title + '</header>' +
        (vars.details ? '<aside>' + vars.details.author.name + ':' + vars.details.tags.join(',') + '</aside>' : '') + children`,
    },
  })
  await rename(join(site.src, 'global.data.js'), join(site.src, 'index-producer.js'))
  await site.write('global.data.js', `import index from './index-producer.js'
    export default async params => {
      const page = params.pages.find(page => page.sourceId === 'a/page.md')
      page.vars.details.author.name += '-mutated'
      page.vars.details.tags.push('producer')
      return index(params)
    }`)
  await site.start()
  const cleanMutation = /<aside>original-mutated:source,producer<\/aside>/
  assert.match(await output(site), cleanMutation)

  for (const title of ['Beta two', 'Beta three']) {
    await site.write('b/page.md', article(title))
    assertDelta(await site.rebuild([site.event('b/page.md')]), ['b/page.md'])
    assert.match(await output(site), cleanMutation, 'each worker receives pristine nested objects and arrays')
    assert.ok((await output(site)).includes(`Selected: ${title}`), 'the unchanged page was actually rerendered')
  }

  for (const [heading, body, frontmatter, title, author] of /** @type {const} */ ([
    ['Inferred title', 'Body-only replacement.', details, 'Inferred title', 'original'],
    ['New inferred title', 'Body-only replacement.', details, 'New inferred title', 'original'],
    ['Ignored heading', 'New frontmatter body.', details.replace('original', 'fresh') + 'title: Explicit title\n', 'Explicit title', 'fresh'],
  ])) {
    await site.write('a/page.md', `---\n${frontmatter}dataDeps: [index]\nhandlebars: true\n---\n# ${heading}\n\n${body}\n\nSelected: {{data.index.[0].title}}\n`)
    assertDelta(await site.rebuild([site.event('a/page.md')]), ['a/page.md'])
    const html = await output(site)
    assert.ok(html.includes(`<header>${title}</header>`))
    assert.ok(html.includes(body))
    assert.ok(html.includes(`<aside>${author}-mutated:source,producer</aside>`))
  }
  await site.write('b/page.md', article('After frontmatter edit'))
  await site.rebuild([site.event('b/page.md')])
  assert.match(await output(site), /<aside>fresh-mutated:source,producer<\/aside>/)
})

test('unchanged Markdown uses fresh companions, imported helpers, layouts and settings without global data', options, async t => {
  const site = await withoutProducer(t, {
    'a/page.md': article('Heading', 'Message: {{vars.message}}', 'handlebars: true\n'),
    'a/page.vars.js': "import { message } from '../message.js'; export default { message }",
    'message.js': "export const message = 'first'",
    'root.layout.js': "export default ({ children }) => '<main>' + children + '</main>'",
    'markdown-it.settings.js': "import { level } from './markdown-helper.js'; export default md => { md.renderer.rules.heading_open = () => '<h' + level + '>'; md.renderer.rules.heading_close = () => '</h' + level + '>'; return md }",
    'markdown-helper.js': 'export const level = 2',
  })
  await site.start()
  assert.match(await output(site), /<main>\s*<h2>Heading<\/h2>\s*<p>Message: first<\/p>/)

  await site.write('a/page.vars.js', "import { message } from '../message.js'; export default { message: 'companion-' + message }")
  await site.rebuild([site.event('a/page.vars.js')])
  assert.match(await output(site), /Message: companion-first/)
  await site.write('message.js', "export const message = 'second'")
  await site.rebuild([site.event('message.js')])
  assert.match(await output(site), /Message: companion-second/)
  await site.write('root.layout.js', "export default ({ children }) => '<section>' + children + '</section>'")
  await site.rebuild([site.event('root.layout.js')])
  assert.match(await output(site), /<section>\s*<h2>Heading<\/h2>\s*<p>Message: companion-second<\/p>/)
  await site.write('markdown-helper.js', 'export const level = 3')
  await site.rebuild([site.event('markdown-helper.js')])
  assert.match(await output(site), /<section>\s*<h3>Heading<\/h3>/)
  await site.write('markdown-it.settings.js', "export default md => { md.renderer.rules.heading_open = () => '<h4>'; md.renderer.rules.heading_close = () => '</h4>'; return md }")
  await site.rebuild([site.event('markdown-it.settings.js')])
  assert.match(await output(site), /<section>\s*<h4>Heading<\/h4>\s*<p>Message: companion-second<\/p>/)
})

test('Markdown source identity follows rename, replacement, deletion and a restarted watch session', options, async t => {
  const site = await withoutProducer(t)
  await site.start()
  await mkdir(join(site.src, 'moved'))
  await rename(join(site.src, 'a/page.md'), join(site.src, 'moved/page.md'))
  await site.rebuild([site.event('a/page.md', 'removed'), site.event('moved/page.md', 'added')])
  await absent(site, 'a/index.html')
  assert.match(await output(site, 'moved/index.html'), /<header>Alpha<\/header>/)

  await rm(join(site.src, 'moved/page.md'))
  await site.write('moved/page.html', '<p>HTML replacement</p>')
  await site.rebuild([site.event('moved/page.md', 'removed'), site.event('moved/page.html', 'added')])
  assert.match(await output(site, 'moved/index.html'), /<p>HTML replacement<\/p>/)
  assert.doesNotMatch(await output(site, 'moved/index.html'), /Alpha|Original body/)
  await rm(join(site.src, 'moved/page.html'))
  await site.write('moved/page.md', article('Replacement Markdown', 'Replacement body.'))
  await site.rebuild([site.event('moved/page.html', 'removed'), site.event('moved/page.md', 'added')])
  assert.match(await output(site, 'moved/index.html'), /<header>Replacement Markdown<\/header>.*Replacement body/s)

  await rm(join(site.src, 'moved/page.md'))
  await site.rebuild([site.event('moved/page.md', 'removed')])
  await absent(site, 'moved/index.html')
  await site.write('a/page.md', article('Recreated Alpha', 'Recreated body.'))
  await site.rebuild([site.event('a/page.md', 'added')])
  assert.match(await output(site), /<header>Recreated Alpha<\/header>.*Recreated body/s)

  await site.dom.stopWatching()
  await site.write('a/page.md', article('Edited while stopped', 'Restarted body.', 'title: Restart title\n'))
  await site.start()
  assert.match(await output(site), /<header>Restart title<\/header>.*Restarted body/s)
  assert.doesNotMatch(await output(site), /Recreated Alpha|Recreated body/)
})

test('failed Markdown rendering forces fresh source preparation on recovery without a source event', options, async t => {
  const site = await withoutProducer(t, {
    'root.layout.js': `import { existsSync } from 'node:fs'
      export default ({ vars, children }) => {
        if (vars.article && existsSync(new URL('../fail-render', import.meta.url))) throw new Error('intentional render failure')
        return '<header>' + vars.title + '</header>' + children
      }`,
  })
  await site.start()
  const before = await output(site)
  await writeFile(site.renderFailure, '')
  await site.write('a/page.md', article('Failed candidate', 'Failed body.'))
  await site.rebuild([site.event('a/page.md')])
  assert.equal(await output(site), before, 'failed rendering leaves the last successful page')

  await rm(site.renderFailure)
  // Only B notifies: recovery must discard both the old and failed A snapshots.
  await site.write('a/page.md', article('Recovery heading', 'Recovered body.', 'title: Recovered title\n'))
  await site.write('b/page.md', article('Recovery trigger'))
  await site.rebuild([site.event('b/page.md')])
  assert.match(await output(site), /<header>Recovered title<\/header>.*Recovered body/s)
  assert.doesNotMatch(await output(site), /Failed candidate|Failed body/)
  await site.write('a/page.md', article('After recovery', 'Later body.'))
  await site.rebuild([site.event('a/page.md')])
  assert.match(await output(site), /<header>After recovery<\/header>.*Later body/s)
})

test('cleanup failure cannot commit Markdown preparation even without a global-data baseline', options, async t => {
  const site = await withoutProducer(t, {
    'a/page.md': article('Initial title', 'Initial body.', 'sidecar: initial.txt\n'),
    'a/page.vars.js': 'export const pageOutputs = ({ vars }) => ({ outputName: vars.sidecar, content: vars.title })',
  })
  await site.start()
  const stale = join(site.dest, 'a/initial.txt')
  const originalRm = fsPromises.rm
  let cleanupAttempts = 0
  /** @param {Parameters<typeof originalRm>} args */
  const failFirstCleanup = async (...args) => {
    if (String(args[0]) === stale && cleanupAttempts++ === 0) {
      throw Object.assign(new Error('intentional Markdown sidecar cleanup failure'), { code: 'EACCES' })
    }
    return originalRm(...args)
  }
  const cleanup = t.mock.method(fsPromises, 'rm', failFirstCleanup)
  syncBuiltinESMExports()
  try {
    await site.write('a/page.md', article('Candidate title', 'Candidate body.', 'sidecar: candidate.txt\n'))
    await site.rebuild([site.event('a/page.md')])
    assert.equal(cleanupAttempts, 1, 'failure occurs after rendering wrote the candidate')
    assert.equal(await output(site, 'a/initial.txt'), 'Initial title')
    assert.equal(await output(site, 'a/candidate.txt'), 'Candidate title')
    assert.match(await output(site), /<header>Candidate title<\/header>.*Candidate body/s)

    await site.write('a/page.md', article('Recovery heading', 'Recovered body.', 'title: Recovered title\nsidecar: recovered.txt\n'))
    await site.write('b/page.md', article('Recovery trigger'))
    await site.rebuild([site.event('b/page.md')])
    assert.match(await output(site), /<header>Recovered title<\/header>.*Recovered body/s)
    assert.equal(await output(site, 'a/recovered.txt'), 'Recovered title')
    await absent(site, 'a/initial.txt')
    await absent(site, 'a/candidate.txt')

    await site.write('a/page.md', article('After cleanup', 'Later body.', 'sidecar: final.txt\n'))
    await site.rebuild([site.event('a/page.md')])
    assert.match(await output(site), /<header>After cleanup<\/header>.*Later body/s)
    assert.equal(await output(site, 'a/final.txt'), 'After cleanup')
    await absent(site, 'a/recovered.txt')
  } finally {
    cleanup.mock.restore()
    syncBuiltinESMExports()
  }
})
