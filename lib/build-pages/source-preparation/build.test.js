/**
 * @import { TestContext } from 'node:test'
 * @import { SiteData } from '../../builder.js'
 * @import { GlobalDataInputChanges } from '../global-data/global-data-state.js'
 * @import { PageBuilderReport } from '../index.js'
 * @import { BuildPagesFilterOptions } from '../worker/protocol.js'
 */
import assert from 'node:assert/strict'
import fsPromises, { writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

import markdownIt from 'markdown-it'
import { classifyWatchEvent } from '../../watch/plan.js'
import { identifyPages } from '../../identify-pages.js'
import { buildPagesDirect } from '../build.js'
import { errorText, setup } from '../outputs/test-helpers.js'
import { buildPages } from '../worker/index.js'
import { applyMarkdownPreparationUpdate } from './markdown-cache.js'

const options = { timeout: 30_000 }
const noOutputs = { pageFilterPaths: [], templateFilterPaths: [], pagesFileFilterPaths: [] }

/** @param {string[]} paths @returns {GlobalDataInputChanges} */
const delta = (...paths) => ({
  upsertedPaths: paths,
  events: paths.map(path => classifyWatchEvent('change', path)),
})

/** @param {string} title @param {string} [body] @param {string} [frontmatter] */
const article = (title, body = 'Original **body**.', frontmatter = '') => `---\n${frontmatter}---\n# ${title}\n\n${body}\n`

/** @param {TestContext} t @param {Record<string, string>} files */
async function fixture (t, files) {
  const site = await setup(t, files)
  const siteData = await identifyPages(site.src)
  assert.deepEqual(siteData.errors, [])
  return {
    ...site,
    siteData,
    /** @param {BuildPagesFilterOptions} [opts] */
    direct: opts => buildPagesDirect(site.src, site.dest, siteData, opts),
    /** @param {BuildPagesFilterOptions} [opts] */
    worker: opts => buildPages(site.src, site.dest, siteData, opts ?? null),
  }
}

/** @param {TestContext} t @param {SiteData} siteData */
function countPreparation (t, siteData) {
  const sources = new Set(siteData.pages.filter(page => page.type === 'md').map(page => page.pageFile.filepath))
  const reads = t.mock.method(fsPromises, 'readFile')
  const parses = t.mock.method(markdownIt.prototype, 'parse')
  syncBuiltinESMExports()
  t.after(() => {
    reads.mock.restore()
    syncBuiltinESMExports()
    parses.mock.restore()
  })
  return {
    /** @param {string[]} paths @param {readonly string[]} bodies @param {number} [renders] */
    assertWork (paths, bodies, renders = 0) {
      assert.deepEqual(reads.mock.calls.map(call => String(call.arguments[0])).filter(path => sources.has(path)).sort(), [...paths].sort(), 'only expected Markdown source reads')
      // Title extraction disables the inline core rule; HTML rendering does not.
      const titleCalls = parses.mock.calls.filter(call => {
        const parser = /** @type {InstanceType<typeof markdownIt>} */ (call.this)
        return !parser.core.ruler.getRules('').some(rule => rule.name === 'inline')
      })
      assert.deepEqual(titleCalls.map(call => call.arguments[0]).sort(), [...bodies].sort(), 'only expected title parses')
      assert.equal(parses.mock.callCount() - titleCalls.length, renders, 'render parses are counted separately')
      reads.mock.resetCalls()
      parses.mock.resetCalls()
    },
  }
}

/** @param {{ errors: unknown[], report: PageBuilderReport }} result */
function candidate (result) {
  assert.deepEqual(result.errors, [])
  const update = result.report.markdownPreparationUpdate
  assert.ok(update, 'successful watch builds return a preparation candidate')
  assert.deepEqual(structuredClone(update), update)
  return update
}

test('direct delta preparation reads and title-parses only the edited source while global.data sees every initialized page', options, async t => {
  const names = Array.from({ length: 6 }, (_, i) => `article-${i}/page.md`)
  const bodies = names.map((_, i) => `\n# Title ${i}\n\nOriginal **body**.\n`)
  const files = Object.fromEntries(names.flatMap((name, i) => [
    [name, article(`Title ${i}`)],
    [name.replace('.md', '.vars.js'), `export default { companionValue: ${i} }`],
  ]))
  const site = await fixture(t, {
    ...files,
    'global.vars.js': "export default { layout: 'root', globalValue: 'global' }",
    'root.layout.js': "export const vars = { layoutValue: 'layout' }; export default ({ children }) => children",
    'global.data.js': `let readBodies = false
      export function enableBodyReads () { readBodies = true }
      export default async ({ pages, changes, setState }) => {
        const records = await Promise.all(pages.map(async page => ({
          sourceId: page.sourceId,
          title: page.vars.title,
          global: page.vars.globalValue,
          layout: page.vars.layoutValue,
          companion: page.vars.companionValue,
          raw: readBodies ? await page.readMarkdownContent() : null,
        })))
        records.sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        setState({ records, kind: changes.kind, upserted: changes.kind === 'delta' ? changes.upserted.map(page => page.sourceId) : [] })
        return {}
      }`,
  })
  const work = countPreparation(t, site.siteData)
  const paths = names.map(name => join(site.src, name))
  const expectedRecords = names.map((sourceId, i) => ({ sourceId, title: `Title ${i}`, global: 'global', layout: 'layout', companion: i, raw: null }))
  let result = await site.direct({ ...noOutputs, trackWatchDependencies: true })
  let update = candidate(result)
  assert.equal(update.replace, true)
  assert.deepEqual([...update.upserts.keys()].sort(), [...paths].sort())
  assert.deepEqual(update.removed, [])
  assert.deepEqual(result.report.pages, [])
  assert.deepEqual(result.outputs, [])
  assert.deepEqual(result.report.globalDataBaseline?.state, { records: expectedRecords, kind: 'reset', upserted: [] })
  work.assertWork(paths, bodies)
  let previous = applyMarkdownPreparationUpdate(null, update)

  const edited = join(site.src, 'article-2/page.md')
  const editedBody = '\n# Changed title\n\nReplacement **body**.\n'
  bodies[2] = editedBody
  assert.ok(expectedRecords[2])
  expectedRecords[2].title = 'Changed title'
  await writeFile(edited, article('Changed title', 'Replacement **body**.'))
  result = await site.direct({
    ...noOutputs,
    trackWatchDependencies: true,
    previousMarkdownPreparation: previous,
    previousGlobalDataBaseline: result.report.globalDataBaseline,
    globalDataInputChanges: delta(edited),
  })
  update = candidate(result)
  assert.equal(update.replace, false)
  assert.deepEqual([...update.upserts.keys()], [edited])
  assert.deepEqual(update.removed, [edited])
  assert.deepEqual(result.report.globalDataBaseline?.state, { records: expectedRecords, kind: 'delta', upserted: [names[2]] })
  assert.deepEqual(result.outputs, [])
  work.assertWork([edited], [editedBody])
  previous = applyMarkdownPreparationUpdate(previous, update)

  const cachedOptions = {
    ...noOutputs,
    trackWatchDependencies: true,
    previousMarkdownPreparation: previous,
    previousGlobalDataBaseline: result.report.globalDataBaseline,
    globalDataInputChanges: delta(),
  }
  result = await site.direct(cachedOptions)
  assert.deepEqual(candidate(result), { replace: false, upserts: new Map(), removed: [] })
  assert.deepEqual(result.report.globalDataBaseline?.state, { records: expectedRecords, kind: 'delta', upserted: [] })
  work.assertWork([], [])

  const producer = await import(join(site.src, 'global.data.js'))
  producer.enableBodyReads()
  result = await site.direct(cachedOptions)
  assert.deepEqual(candidate(result), { replace: false, upserts: new Map(), removed: [] })
  assert.deepEqual(result.report.globalDataBaseline?.state, {
    records: expectedRecords.map((record, i) => ({ ...record, raw: bodies[i] })), kind: 'delta', upserted: [],
  })
  // Explicit readMarkdownContent calls remain independent I/O, not cache misses.
  work.assertWork(paths, [])
})

test('without global.data, cached bodies render fresh HTML and source edits prepare only one page', options, async t => {
  const site = await fixture(t, {
    'a/page.md': article('Alpha'),
    'b/page.md': article('Beta'),
    'markdown-it.settings.js': `let calls = 0
      export default md => {
        const id = ++calls
        md.renderer.rules.heading_open = () => '<h1 data-renderer="' + id + '">'
        return md
      }`,
  })
  assert.equal(site.siteData.globalData, undefined)
  const work = countPreparation(t, site.siteData)
  const a = join(site.src, 'a/page.md')
  const b = join(site.src, 'b/page.md')
  let result = await site.direct({ trackWatchDependencies: true })
  let previous = applyMarkdownPreparationUpdate(null, candidate(result))
  assert.equal(result.report.globalDataBaseline, undefined)
  work.assertWork([a, b], ['\n# Alpha\n\nOriginal **body**.\n', '\n# Beta\n\nOriginal **body**.\n'], 2)
  assert.match(await site.read('a/index.html'), /data-renderer="1"/)

  await writeFile(b, article('New Beta', 'New **content**.'))
  result = await site.direct({ trackWatchDependencies: true, previousMarkdownPreparation: previous, globalDataInputChanges: delta(b) })
  const update = candidate(result)
  assert.equal(update.replace, false)
  assert.deepEqual([...update.upserts.keys()], [b])
  previous = applyMarkdownPreparationUpdate(previous, update)
  work.assertWork([b], ['\n# New Beta\n\nNew **content**.\n'], 2)
  assert.match(await site.read('a/index.html'), /<h1 data-renderer="2">Alpha<\/h1>/)
  assert.match(await site.read('a/index.html'), /Original <strong>body<\/strong>/)
  const html = await site.read('b/index.html')
  assert.match(html, /<h1 data-renderer="2">New Beta<\/h1>/)
  assert.match(html, /New <strong>content<\/strong>/)
  assert.doesNotMatch(html, /Original|---/)
  assert.equal(previous.get(b)?.prepared.markdownContent, '\n# New Beta\n\nNew **content**.\n')

  result = await site.direct({ ...noOutputs, trackWatchDependencies: true, previousMarkdownPreparation: previous, globalDataInputChanges: delta() })
  assert.deepEqual(candidate(result), { replace: false, upserts: new Map(), removed: [] })
  work.assertWork([], [])
})

for (const mode of ['missing changes', 'reset', 'non-watch']) {
  test(`${mode} does not silently reuse a direct build's Markdown baseline`, options, async t => {
    const site = await fixture(t, { 'a/page.md': article('Alpha'), 'b/page.md': article('Beta') })
    const first = await site.direct({ ...noOutputs, trackWatchDependencies: true })
    const previous = applyMarkdownPreparationUpdate(null, candidate(first))
    const a = join(site.src, 'a/page.md')
    const b = join(site.src, 'b/page.md')
    await writeFile(a, article('Changed without a source delta', 'Fresh body.'))
    const work = countPreparation(t, site.siteData)
    const result = await site.direct({
      ...noOutputs,
      trackWatchDependencies: mode !== 'non-watch',
      previousMarkdownPreparation: previous,
      globalDataInputChanges: mode === 'missing changes' ? undefined : { ...delta(), ...(mode === 'reset' ? { resetReason: 'recovery' } : {}) },
    })
    assert.deepEqual(result.errors, [])
    work.assertWork([a, b], ['\n# Changed without a source delta\n\nFresh body.\n', '\n# Beta\n\nOriginal **body**.\n'])
    if (mode === 'non-watch') {
      assert.equal(Object.hasOwn(result.report, 'markdownPreparationUpdate'), false)
    } else {
      const update = candidate(result)
      assert.equal(update.replace, true)
      assert.deepEqual([...update.upserts.keys()].sort(), [a, b].sort())
      assert.equal(update.upserts.get(a)?.prepared.vars['title'], 'Changed without a source delta')
    }
    assert.equal(previous.get(a)?.prepared.vars['title'], 'Alpha', 'the accepted baseline is not modified')
  })
}

for (const mode of ['missing changes', 'reset', 'non-watch']) {
  test(`${mode} omits a noncloneable Markdown baseline at the worker boundary`, options, async t => {
    const site = await fixture(t, {
      'page.md': article('Stale heading', 'Stale body.', 'title: Stale title\n'),
      'root.layout.js': "export default ({ vars, children }) => '<header>' + vars.title + '</header>' + children",
    })
    const first = await site.direct({ ...noOutputs, trackWatchDependencies: true })
    const previous = applyMarkdownPreparationUpdate(null, candidate(first))
    const path = join(site.src, 'page.md')
    const entry = previous.get(path)
    assert.ok(entry)
    entry.prepared.vars['fn'] = () => 'cannot cross the worker boundary'
    assert.throws(() => structuredClone(previous), { name: 'DataCloneError' })

    await writeFile(path, article('Fresh heading', 'Fresh **body**.', 'title: Fresh title\n'))
    const result = await site.worker({
      trackWatchDependencies: mode !== 'non-watch',
      previousMarkdownPreparation: previous,
      globalDataInputChanges: mode === 'missing changes' ? undefined : { ...delta(), ...(mode === 'reset' ? { resetReason: 'recovery' } : {}) },
    })
    assert.deepEqual(result.errors, [])
    const html = await site.read('index.html')
    assert.match(html, /<header>Fresh title<\/header>/)
    assert.match(html, />Fresh heading<\/h1>/)
    assert.match(html, /Fresh <strong>body<\/strong>/)
    assert.doesNotMatch(html, /Stale/)
    if (mode === 'non-watch') {
      assert.equal(Object.hasOwn(result.report, 'markdownPreparationUpdate'), false)
    } else {
      assert.deepEqual(candidate(result), {
        replace: true,
        upserts: new Map([[path, { sourceId: 'page.md', prepared: { markdownContent: '\n# Fresh heading\n\nFresh **body**.\n', vars: { title: 'Fresh title' } } }]]),
        removed: [],
      })
    }
  })
}

test('empty membership candidates clear accepted Markdown state, unlike unchanged candidates, and readded pages prepare fresh source', options, async t => {
  const site = await fixture(t, { 'a/page.md': article('Alpha'), 'b/page.md': article('Beta') })
  const a = join(site.src, 'a/page.md')
  const b = join(site.src, 'b/page.md')
  const work = countPreparation(t, site.siteData)
  const first = await site.direct({ ...noOutputs, trackWatchDependencies: true })
  const populated = applyMarkdownPreparationUpdate(null, candidate(first))
  assert.equal(populated.size, 2)
  work.assertWork([a, b], ['\n# Alpha\n\nOriginal **body**.\n', '\n# Beta\n\nOriginal **body**.\n'])

  const unchanged = candidate(await site.direct({
    ...noOutputs,
    trackWatchDependencies: true,
    previousMarkdownPreparation: populated,
    globalDataInputChanges: delta(),
  }))
  assert.deepEqual(unchanged, { replace: false, upserts: new Map(), removed: [] })
  assert.deepEqual(applyMarkdownPreparationUpdate(populated, unchanged), populated)
  work.assertWork([], [])

  for (const reset of [false, true]) {
    const result = await buildPagesDirect(site.src, site.dest, { ...site.siteData, pages: [] }, {
      ...noOutputs,
      trackWatchDependencies: true,
      previousMarkdownPreparation: populated,
      globalDataInputChanges: { ...delta(), ...(reset ? { resetReason: 'recovery' } : {}) },
    })
    const update = candidate(result)
    assert.deepEqual({ ...update, removed: [...update.removed].sort() }, {
      replace: reset,
      upserts: new Map(),
      removed: reset ? [] : [a, b].sort(),
    })
    assert.deepEqual(result.report.pages, [])
    assert.deepEqual(result.outputs, [])
    const empty = applyMarkdownPreparationUpdate(populated, update)
    assert.deepEqual(empty, new Map(), 'accept an empty candidate rather than retaining the populated baseline')
    assert.equal(populated.size, 2, 'acceptance does not mutate the previous map')
    work.assertWork([], [])

    const title = reset ? 'Readded after reset' : 'Readded after removal'
    const body = `\n# ${title}\n\nFresh **body**.\n`
    await writeFile(a, article(title, 'Fresh **body**.'))
    const readded = await buildPagesDirect(site.src, site.dest, {
      ...site.siteData,
      pages: site.siteData.pages.filter(page => page.pageFile.filepath === a),
    }, {
      trackWatchDependencies: true,
      previousMarkdownPreparation: empty,
      // No explicit invalidation should be needed after accepting empty membership.
      globalDataInputChanges: delta(),
    })
    const readdedUpdate = candidate(readded)
    assert.deepEqual(readdedUpdate, {
      replace: false,
      upserts: new Map([[a, { sourceId: 'a/page.md', prepared: { markdownContent: body, vars: { title } } }]]),
      removed: [],
    })
    assert.deepEqual(applyMarkdownPreparationUpdate(empty, readdedUpdate), readdedUpdate.upserts)
    work.assertWork([a], [body], 1)
    const html = await site.read('a/index.html')
    assert.ok(html.includes(`>${title}</h1>`))
    assert.match(html, /Fresh <strong>body<\/strong>/)
    assert.doesNotMatch(html, /Alpha|Original/)
  }
})

test('initialization and rendering errors emit no Markdown preparation candidate', options, async t => {
  const site = await fixture(t, {
    'a/page.md': article('Alpha'),
    'b/page.md': article('Beta'),
    'root.layout.js': `export default ({ vars, children }) => {
      if (vars.failRender) throw new Error('intentional render failure')
      return children
    }`,
  })
  const first = await site.direct({ ...noOutputs, trackWatchDependencies: true })
  const previous = applyMarkdownPreparationUpdate(null, candidate(first))
  const a = join(site.src, 'a/page.md')
  const work = countPreparation(t, site.siteData)
  for (const [source, message, titleBodies, renders] of /** @type {const} */ ([
    ['---\nbroken: [\n---\n# Invalid\n', /YAML|flow collection|unexpected end/i, [], 0],
    [article('Failed candidate', 'New body.', 'failRender: true\n'), /intentional render failure/, ['\n# Failed candidate\n\nNew body.\n'], 1],
  ])) {
    await writeFile(a, source)
    const result = await site.direct({
      ...noOutputs,
      pageFilterPaths: [a],
      trackWatchDependencies: true,
      previousMarkdownPreparation: previous,
      globalDataInputChanges: delta(a),
    })
    assert.equal(result.errors.length, 1)
    assert.ok(result.errors[0])
    assert.match(errorText(result.errors[0].error), message)
    assert.equal(Object.hasOwn(result.report, 'markdownPreparationUpdate'), false)
    work.assertWork([a], titleBodies, renders)
    assert.equal(previous.get(a)?.prepared.vars['title'], 'Alpha')
  }
})

test('fresh workers return only changed source preparation and rerender cached Markdown selected by global data', options, async t => {
  const subscriberBody = '\n# Stable subscriber\n\nSelected: {{data.selection}}; companion: {{vars.companion}}.\n'
  const site = await fixture(t, {
    'a/page.md': `---\nhandlebars: true\ndataDeps: [selection]\n---${subscriberBody}`,
    'a/page.vars.js': "export default { companion: 'first', liveFunction: () => 'not cloneable' }",
    'b/page.md': article('Beta'),
    'c/page.md': article('Untouched'),
    'global.vars.js': "export default { layout: 'root', globalOnly: 'not source vars' }",
    'global.data.js': `let calls = 0
      export default ({ pages, changes, setState }) => {
        setState({ calls: ++calls, titles: pages.map(page => page.vars.title).sort(),
          upserted: changes.kind === 'delta' ? changes.upserted.map(page => page.sourceId) : [] })
        return { selection: pages.find(page => page.sourceId === 'b/page.md').vars.title }
      }`,
  })
  const a = join(site.src, 'a/page.md')
  const b = join(site.src, 'b/page.md')
  let result = await site.worker({ trackWatchDependencies: true })
  const initialUpdate = candidate(result)
  assert.equal(initialUpdate.replace, true)
  assert.equal(initialUpdate.upserts.size, 3)
  assert.deepEqual(initialUpdate.upserts.get(a), {
    sourceId: 'a/page.md',
    prepared: { markdownContent: subscriberBody, vars: { title: 'Stable subscriber', handlebars: true, dataDeps: ['selection'] } },
  }, 'no PageData, resolved vars, companions, layout or renderer is retained')
  assert.match(await site.read('a/index.html'), /Selected: Beta; companion: first/)
  let previous = applyMarkdownPreparationUpdate(null, initialUpdate)

  for (const title of ['Second selection', 'Third selection']) {
    await writeFile(b, article(title, 'Edited body.'))
    // Fresh workers must resolve companions and layouts, not cache live pages.
    await writeFile(join(site.src, 'a/page.vars.js'), `export default { companion: ${JSON.stringify(title)}, liveFunction: () => 'still not cloneable' }`)
    await writeFile(join(site.src, 'root.layout.js'), `export default ({ children }) => '<section data-build="${title}">' + children + '</section>'`)
    result = await site.worker({
      ...noOutputs,
      pageFilterPaths: [b],
      trackWatchDependencies: true,
      previousMarkdownPreparation: previous,
      previousGlobalDataBaseline: result.report.globalDataBaseline,
      previousWatchDependencies: result.report.watchDependencies,
      globalDataInputChanges: delta(b),
    })
    const update = candidate(result)
    assert.deepEqual(update, {
      replace: false,
      upserts: new Map([[b, { sourceId: 'b/page.md', prepared: { markdownContent: `\n# ${title}\n\nEdited body.\n`, vars: { title } } }]]),
      removed: [b],
    })

    assert.deepEqual(result.report.globalDataBaseline?.state, {
      calls: 1, titles: [title, 'Stable subscriber', 'Untouched'].sort(), upserted: ['b/page.md'],
    }, 'each worker runs a fresh producer with every initialized page')
    assert.deepEqual(result.report.pages.map(page => page.sourcePageFilePath).sort(), [a, b].sort(), 'global-data diff selects A even though only B was an input upsert')
    const html = await site.read('a/index.html')
    assert.ok(html.includes(`Selected: ${title}; companion: ${title}`))
    assert.ok(html.includes(`<section data-build="${title}">`))
    assert.match(html, /Stable subscriber/)
    const next = applyMarkdownPreparationUpdate(previous, update)
    assert.deepEqual(next.get(a), previous.get(a), 'the accepted delta preserves unchanged prepared Markdown')
    assert.equal(next.size, 3)
    previous = next
  }
})
