/**
 * @import { TestContext } from 'node:test'
 * @import { PageInfo } from '../../../identify-pages.js'
 * @import { BuilderOptions } from '../../outputs/page-writer.js'
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import markdownIt from 'markdown-it'
import { identifyPages } from '../../../identify-pages.js'
import { buildPagesDirect } from '../../build.js'
import { prepareMarkdown } from '../../source-preparation/markdown.js'
import { createMdResolver } from './create-md-resolver.js'
import { mdBuilder } from './index.js'

const noOutputs = { pageFilterPaths: [], templateFilterPaths: [], pagesFileFilterPaths: [] }

/** @param {TestContext} t @param {string} [source] */
async function fixture (t, source = '# Original **title**\n\nOriginal body.') {
  const root = await mkdtemp(join(tmpdir(), 'domstack-lazy-md-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  /** @type {PageInfo} */
  const pageInfo = {
    pageFile: { root, filepath: join(root, 'page.md'), relname: 'page.md', basename: 'page.md', parentName: '' },
    type: 'md',
    path: '',
    url: '/',
    outputName: 'index.html',
    outputRelname: 'index.html',
    draft: false,
  }
  await writeFile(pageInfo.pageFile.filepath, source)
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  return { root, pageInfo, context: { vars: {}, data: {}, page: pageInfo } }
}

test('preparation exposes metadata without initializing a renderer and captures source', async t => {
  const { pageInfo, context } = await fixture(t, '---\ncategory: notes\n---\n# Original **title**\n\nOriginal body.')
  const use = t.mock.method(markdownIt.prototype, 'use')
  const render = t.mock.method(markdownIt.prototype, 'render')
  const prepared = await mdBuilder({ pageInfo, options: { getMarkdownRenderer: createMdResolver() } })
  assert.deepEqual(prepared.vars, { title: 'Original **title**', category: 'notes' })
  assert.equal(use.mock.callCount(), 0, 'no renderer plugins initialize during preparation')
  assert.equal(render.mock.callCount(), 0)

  await writeFile(pageInfo.pageFile.filepath, '# Replacement\n\nChanged body.')
  const html = await prepared.pageLayout(context)
  assert.match(html, /Original <strong>title<\/strong>/)
  assert.match(html, /Original body\./)
  assert.doesNotMatch(html, /Replacement|Changed body/)
  await rm(pageInfo.pageFile.filepath)
  assert.equal(await prepared.pageLayout(context), html, 'later renders need no source read')
})

test('concurrent first renders share one default renderer per build, not across builds', async t => {
  const { pageInfo, context } = await fixture(t)
  const use = t.mock.method(markdownIt.prototype, 'use')
  const render = t.mock.method(markdownIt.prototype, 'render')
  const options = { getMarkdownRenderer: createMdResolver() }
  const pages = await Promise.all(Array.from({ length: 12 }, () => mdBuilder({ pageInfo, options })))
  assert.equal(use.mock.callCount(), 0)
  const html = await Promise.all(pages.map(page => page.pageLayout(context)))
  assert.ok(html.every(value => value === html[0]))
  assert.match(html[0] ?? '', /Original <strong>title<\/strong>/)
  assert.equal(render.mock.callCount(), pages.length)
  const shared = await options.getMarkdownRenderer(null)
  assert.ok(render.mock.calls.every(call => call.this === shared))
  shared.renderer.rules['paragraph_open'] = () => '<p data-shared="true">'
  for (const output of await Promise.all(pages.map(page => page.pageLayout(context)))) {
    assert.match(output, /<p data-shared="true">Original body\./, 'later renders reuse the shared renderer')
  }

  const next = await mdBuilder({ pageInfo, options: { getMarkdownRenderer: createMdResolver() } })
  assert.doesNotMatch(await next.pageLayout(context), /data-shared/, 'a new build has independent renderer state')
})

test('concurrent lazy initialization failures are shared and evicted so prepared pages can retry', async t => {
  const { pageInfo, context } = await fixture(t)
  const failure = new Error('default renderer initialization failed')
  const failingUse = t.mock.method(markdownIt.prototype, 'use', () => { throw failure }, { times: 1 })
  const render = t.mock.method(markdownIt.prototype, 'render')
  const prepare = t.mock.fn(() => prepareMarkdown(pageInfo.pageFile.filepath))
  const options = { getMarkdownRenderer: createMdResolver(), prepareMarkdown: prepare }
  const pages = await Promise.all(Array.from({ length: 3 }, () => mdBuilder({ pageInfo, options })))
  assert.equal(prepare.mock.callCount(), pages.length)
  assert.ok(pages.every(page => page.vars['title'] === 'Original **title**'))
  assert.equal(failingUse.mock.callCount(), 0, 'metadata preparation succeeds without renderer initialization')
  await rm(pageInfo.pageFile.filepath)

  const results = await Promise.allSettled(pages.map(page => page.pageLayout(context)))
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    if (result.status === 'rejected') assert.equal(result.reason, failure)
  }
  assert.equal(failingUse.mock.callCount(), 1, 'concurrent first renders share one failed construction attempt')
  assert.equal(render.mock.callCount(), 0)
  assert.equal(prepare.mock.callCount(), pages.length, 'failed rendering does not reprepare source')

  failingUse.mock.restore()
  const [first, ...siblings] = pages
  assert.ok(first)
  const html = await first.pageLayout(context)
  assert.match(html, /Original <strong>title<\/strong>/)
  assert.match(html, /Original body\./)
  const siblingHtml = await Promise.all(siblings.map(page => page.pageLayout(context)))
  assert.ok(siblingHtml.every(value => value === html))
  const shared = await options.getMarkdownRenderer(null)
  assert.ok(render.mock.calls.every(call => call.this === shared))
  assert.equal(render.mock.callCount(), pages.length)
  assert.equal(prepare.mock.callCount(), pages.length, 'retry uses captured source even after the source file is removed')
})

test('standalone pages initialize independent renderers even when first rendered concurrently', async t => {
  const { pageInfo, context } = await fixture(t)
  const use = t.mock.method(markdownIt.prototype, 'use')
  const render = t.mock.method(markdownIt.prototype, 'render')
  const first = await mdBuilder({ pageInfo })
  const second = await mdBuilder({ pageInfo, options: {} })
  assert.equal(first.vars['title'], 'Original **title**')
  assert.equal(second.vars['title'], 'Original **title**')
  assert.equal(use.mock.callCount(), 0)
  assert.equal(render.mock.callCount(), 0)
  await rm(pageInfo.pageFile.filepath)
  for (const html of await Promise.all([first.pageLayout(context), second.pageLayout(context)])) {
    assert.match(html, /Original <strong>title<\/strong>/)
    assert.match(html, /Original body\./)
  }
  render.mock.resetCalls()
  await first.pageLayout(context)
  const firstRenderer = /** @type {InstanceType<typeof markdownIt>} */ (render.mock.calls[0]?.this)
  firstRenderer.renderer.rules['paragraph_open'] = () => '<p data-first="true">'
  assert.match(await first.pageLayout(context), /data-first="true"/)
  assert.doesNotMatch(await second.pageLayout(context), /data-first="true"/)
})

for (const cached of [false, true]) {
  test(`${cached ? 'createMdResolver(customLoader)' : 'injected resolver'} is awaited before source preparation`, async t => {
    const { pageInfo, context } = await fixture(t)
    const ready = Promise.withResolvers()
    const renderer = markdownIt()
    const events = /** @type {string[]} */ ([])
    const load = t.mock.fn(async (/** @type {string | null | undefined} */ path) => {
      assert.equal(path, null)
      events.push('resolver started')
      await ready.promise
      events.push('resolver finished')
      return renderer
    })
    const prepare = t.mock.fn(async () => {
      events.push('source prepared')
      return { markdownContent: 'Captured body', vars: { title: 'Captured title' } }
    })
    const pending = mdBuilder({
      pageInfo,
      options: { getMarkdownRenderer: cached ? createMdResolver(load) : load, prepareMarkdown: prepare },
    })
    assert.deepEqual(events, ['resolver started'])
    assert.equal(prepare.mock.callCount(), 0)
    ready.resolve(undefined)
    const page = await pending
    assert.deepEqual(events, ['resolver started', 'resolver finished', 'source prepared'])
    assert.equal(page.vars['title'], 'Captured title')
    assert.equal(await page.pageLayout(context), '<p>Captured body</p>\n')
    assert.equal(load.mock.callCount(), 1, 'rendering does not call the injected resolver again')
  })

  test(`${cached ? 'cached custom loader' : 'injected resolver'} failures reject preparation before source access`, async t => {
    const { pageInfo } = await fixture(t)
    await rm(pageInfo.pageFile.filepath)
    const failure = new Error('custom renderer failed')
    const ready = Promise.withResolvers()
    const load = t.mock.fn(async () => {
      await ready.promise
      throw failure
    })
    const prepare = t.mock.fn(() => prepareMarkdown(pageInfo.pageFile.filepath))
    const pending = mdBuilder({ pageInfo, options: { getMarkdownRenderer: cached ? createMdResolver(load) : load, prepareMarkdown: prepare } })
    assert.equal(load.mock.callCount(), 1)
    assert.equal(prepare.mock.callCount(), 0)
    const rejected = assert.rejects(pending, error => error === failure)
    ready.resolve(undefined)
    await rejected
    assert.equal(prepare.mock.callCount(), 0, 'renderer failure wins over the missing source error')
  })
}

test('an injected renderer reads mutable state before pageLayout returns its promise', async t => {
  const { pageInfo, context } = await fixture(t)
  const renderer = markdownIt()
  let state = 'before'
  const render = t.mock.method(renderer, 'render', () => `<p>${state}</p>`)
  const page = await mdBuilder({ pageInfo, options: { getMarkdownRenderer: async () => renderer } })

  const pending = page.pageLayout(context)
  state = 'after'
  assert.equal(await pending, '<p>before</p>')
  assert.equal(await page.pageLayout(context), '<p>after</p>', 'state is read per call, not snapshotted at preparation')
  assert.equal(render.mock.callCount(), 2)
})

test('an initialized default page renders synchronously on subsequent overlapping calls', async t => {
  const { pageInfo, context } = await fixture(t)
  const getMarkdownRenderer = createMdResolver()
  const page = await mdBuilder({ pageInfo, options: { getMarkdownRenderer } })
  // The first default render intentionally awaits renderer and module loading.
  await page.pageLayout(context)
  const renderer = await getMarkdownRenderer(null)
  let state = 'first'
  renderer.renderer.rules['paragraph_open'] = () => `<p data-state="${state}">`

  const first = page.pageLayout(context)
  state = 'second'
  const second = page.pageLayout(context)
  state = 'after both calls'
  const [firstHtml, secondHtml] = await Promise.all([first, second])
  assert.match(firstHtml, /<p data-state="first">Original body\./)
  assert.match(secondHtml, /<p data-state="second">Original body\./)
})

test('settings on a known default resolver finish before source preparation', { timeout: 10000 }, async t => {
  const { root, pageInfo, context } = await fixture(t)
  const settingsPath = join(root, 'settings.mjs')
  await writeFile(settingsPath, `
    export const started = Promise.withResolvers()
    export const ready = Promise.withResolvers()
    export default async md => {
      started.resolve()
      await ready.promise
      md.renderer.rules.paragraph_open = () => '<p data-settings="true">'
      return md
    }
  `)
  const settings = await import(settingsPath)
  const prepare = t.mock.fn(() => prepareMarkdown(pageInfo.pageFile.filepath))
  const pending = mdBuilder({
    pageInfo,
    options: { markdownItSettingsPath: settingsPath, getMarkdownRenderer: createMdResolver(), prepareMarkdown: prepare },
  })
  await settings.started.promise
  assert.equal(prepare.mock.callCount(), 0)
  await writeFile(pageInfo.pageFile.filepath, '# After settings\n\nUpdated body.')
  settings.ready.resolve()
  const page = await pending
  assert.equal(prepare.mock.callCount(), 1)
  assert.equal(page.vars['title'], 'After settings')
  assert.match(await page.pageLayout(context), /<p data-settings="true">Updated body\./)
})

for (const failure of ['sync', 'async', 'missing module']) {
  test(`${failure} settings failure logs eagerly and retains the shared default fallback`, async t => {
    const { root, pageInfo, context } = await fixture(t)
    const settingsPath = join(root, 'settings.mjs')
    if (failure !== 'missing module') {
      await writeFile(settingsPath, `export default ${failure === 'async' ? 'async' : ''} () => {
        ${failure === 'async' ? 'await Promise.resolve()' : ''}
        throw new Error('settings failed')
      }`)
    }
    const errors = t.mock.method(console, 'error', () => {})
    const prepare = t.mock.fn(async () => {
      assert.equal(errors.mock.callCount(), 1, 'settings fallback completes before preparing source')
      return prepareMarkdown(pageInfo.pageFile.filepath)
    })
    const options = { markdownItSettingsPath: settingsPath, getMarkdownRenderer: createMdResolver(), prepareMarkdown: prepare }
    const pages = await Promise.all(Array.from({ length: 3 }, () => mdBuilder({ pageInfo, options })))
    assert.equal(prepare.mock.callCount(), 3)
    assert.equal(errors.mock.callCount(), 1)
    assert.equal(errors.mock.calls[0]?.arguments[0], 'Error loading markdown-it settings:')
    const render = t.mock.method(markdownIt.prototype, 'render')
    for (const page of pages) assert.match(await page.pageLayout(context), /Original <strong>title<\/strong>/)
    assert.equal(new Set(render.mock.calls.map(call => call.this)).size, 1)
    assert.equal(errors.mock.callCount(), 1, 'the fallback is cached rather than retrying settings at render time')
  })
}

test('lazy pages capture the default resolver, null settings, and source before options mutate', async t => {
  const { pageInfo, context } = await fixture(t)
  const original = createMdResolver()
  /** @type {BuilderOptions} */
  const options = { getMarkdownRenderer: original }
  const page = await mdBuilder({ pageInfo, options })
  const replacement = t.mock.fn(async () => { throw new Error('replacement resolver must not run') })
  const prepare = t.mock.fn(async () => { throw new Error('replacement preparation must not run') })
  options.getMarkdownRenderer = replacement
  options.markdownItSettingsPath = join(pageInfo.pageFile.root, 'must-not-load.mjs')
  options.prepareMarkdown = prepare
  const errors = t.mock.method(console, 'error', () => {})
  const render = t.mock.method(markdownIt.prototype, 'render')
  await rm(pageInfo.pageFile.filepath)
  assert.match(await page.pageLayout(context), /Original <strong>title<\/strong>/)
  assert.equal(render.mock.calls[0]?.this, await original(null))
  assert.equal(replacement.mock.callCount(), 0)
  assert.equal(prepare.mock.callCount(), 0)
  assert.equal(errors.mock.callCount(), 0, 'mutated settings must not be imported')
})

test('eager pages retain the resolved custom renderer and settings identity after options mutate', async t => {
  const { root, pageInfo, context } = await fixture(t)
  const renderer = markdownIt()
  renderer.renderer.rules['paragraph_open'] = () => '<p data-original="true">'
  const original = t.mock.fn(async (/** @type {string | null | undefined} */ path) => {
    assert.equal(path, join(root, 'original.mjs'))
    return renderer
  })
  /** @type {BuilderOptions} */
  const options = { markdownItSettingsPath: join(root, 'original.mjs'), getMarkdownRenderer: original }
  const page = await mdBuilder({ pageInfo, options })
  assert.equal(original.mock.callCount(), 1)
  const replacement = t.mock.fn(async () => { throw new Error('replacement resolver must not run') })
  options.getMarkdownRenderer = replacement
  options.markdownItSettingsPath = join(root, 'replacement.mjs')
  await rm(pageInfo.pageFile.filepath)
  assert.match(await page.pageLayout(context), /<p data-original="true">Original body\./)
  assert.equal(original.mock.callCount(), 1)
  assert.equal(replacement.mock.callCount(), 0)
})

for (const fails of [false, true]) {
  test(`filtered no-render builds eagerly await ${fails ? 'failing' : 'successful'} settings before preparing metadata`, async t => {
    const { root, pageInfo } = await fixture(t, '---\ntitle: [invalid\n---\n# Unreadable until settings run')
    const settingsPath = join(root, 'markdown-it.settings.js')
    await writeFile(settingsPath, `
      import { writeFile } from 'node:fs/promises'
      export let calls = 0
      export default async md => {
        calls++
        await writeFile(${JSON.stringify(pageInfo.pageFile.filepath)}, '# Prepared after settings')
        ${fails ? 'throw new Error("filtered settings failure")' : 'return md'}
      }
    `)
    await writeFile(join(root, 'global.data.js'), `
      export let titles
      export default ({ pages }) => {
        titles = pages.map(page => page.vars.title)
        return {}
      }
    `)
    const siteData = await identifyPages(root)
    const render = t.mock.method(markdownIt.prototype, 'render')
    const errors = t.mock.method(console, 'error', () => {})
    const result = await buildPagesDirect(root, join(root, 'output'), siteData, noOutputs)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.report.pages, [])
    assert.deepEqual(result.outputs, [])
    assert.equal(render.mock.callCount(), 0)
    assert.equal((await import(settingsPath)).calls, 1)
    assert.deepEqual((await import(join(root, 'global.data.js'))).titles, ['Prepared after settings'])
    assert.equal(errors.mock.callCount(), fails ? 1 : 0)
  })
}

test('fresh metadata-only builds and raw reads load no renderer modules; first render loads get-md and highlight only', async t => {
  const { root, pageInfo } = await fixture(t)
  await writeFile(join(root, 'global.data.js'), `
    export let records
    export default async ({ pages }) => {
      records = await Promise.all(pages.map(async page => ({
        title: page.vars.title,
        raw: await page.readMarkdownContent(),
      })))
      return {}
    }
  `)
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict'
    import { createRequire, registerHooks } from 'node:module'
    const require = createRequire(import.meta.url)
    const loaded = new Set()
    const hook = registerHooks({ load(url, context, nextLoad) {
      loaded.add(url)
      return nextLoad(url, context)
    } })
    const getMdUrl = new URL('./get-md.js', import.meta.url).href
    const highlightLoaded = () => [...loaded, ...Object.keys(require.cache)].some(url => url.includes('/highlight.js/'))
    const handlebarsLoaded = () => [...loaded, ...Object.keys(require.cache)].some(url => url.includes('/handlebars/'))
    const assertCold = () => {
      assert.equal(loaded.has(getMdUrl), false, 'get-md must not load during metadata preparation')
      assert.equal(highlightLoaded(), false, 'highlight.js must not load during metadata preparation')
      assert.equal(handlebarsLoaded(), false, 'metadata preparation must not load Handlebars')
    }
    const { mdBuilder } = await import('./index.js')
    const { identifyPages } = await import('../../../identify-pages.js')
    const { buildPagesDirect } = await import('../../build.js')
    assertCold()
    const root = ${JSON.stringify(root)}
    const pageInfo = ${JSON.stringify(pageInfo)}
    const siteData = await identifyPages(root)
    const result = await buildPagesDirect(root, root + '/output', siteData, ${JSON.stringify(noOutputs)})
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.report.pages, [])
    assert.deepEqual(result.outputs, [])
    const { records } = await import(root + '/global.data.js')
    assert.deepEqual(records, [{ title: 'Original **title**', raw: '# Original **title**\\n\\nOriginal body.' }])
    assertCold()
    const page = await mdBuilder({ pageInfo })
    assert.equal(page.vars.title, 'Original **title**')
    assertCold()
    assert.match(await page.pageLayout({ vars: {}, data: {}, page: pageInfo }), /Original <strong>title<\\/strong>/)
    assert.equal(loaded.has(getMdUrl), true, 'first render loads get-md')
    assert.equal(highlightLoaded(), true, 'first render loads highlighting')
    assert.equal(handlebarsLoaded(), false, 'plain rendering must not introduce an eager Handlebars load')
    hook.deregister()
  `], { cwd: import.meta.dirname, encoding: 'utf8', timeout: 15000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
