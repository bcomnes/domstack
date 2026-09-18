/**
 * @import { TestContext } from 'node:test'
 * @import { PageInfo } from '../../../identify-pages.js'
 * @import { BuilderOptions } from '../../outputs/page-writer.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import markdownIt from 'markdown-it'
import { mdBuilder } from './index.js'
import { createMdResolver } from './create-md-resolver.js'
import { buildPagesDirect } from '../../build.js'
import { setup } from '../../outputs/test-helpers.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-md-builder-'))
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
  const getMarkdownRenderer = createMdResolver()
  return {
    root,
    pageInfo,
    /** @param {string} source @param {BuilderOptions} [options] */
    async build (source, options = { getMarkdownRenderer }) {
      await writeFile(pageInfo.pageFile.filepath, source)
      return mdBuilder({ pageInfo, options })
    },
  }
}

test('explicit frontmatter titles skip parsing and preserve all override values', async t => {
  const { build } = await fixture(t)
  const parse = t.mock.method(markdownIt.prototype, 'parse')
  for (const [yaml, expected] of [
    ['title: Custom', 'Custom'],
    ['title: ""', ''],
    ['title: null', null],
    ['title:', null],
    ['title: false', false],
    ['title: 0', 0],
  ]) {
    const built = await build(`---\n${yaml}\n---\n# Inferred title\n`)
    assert.equal(built.vars['title'], expected, String(yaml))
  }
  assert.equal(parse.mock.callCount(), 0, 'no title parser runs for overridden titles')
})

test('missing titles still infer H1 and tolerate non-object frontmatter', async t => {
  const { build } = await fixture(t)
  const parse = t.mock.method(markdownIt.prototype, 'parse')
  for (const frontmatter of ['', 'description: Example', 'null', '42', '[]']) {
    const built = await build(`---\n${frontmatter}\n---\n# Heading with **bold**\n`)
    assert.equal(built.vars['title'], 'Heading with **bold**')
  }
  assert.equal(parse.mock.callCount(), 5)
  assert.equal((await build('No heading')).vars['title'], null)
})

test('pages capture their settings-specific renderer even after other pages initialize', async t => {
  const { root, pageInfo, build } = await fixture(t)
  const firstSettings = join(root, 'first.mjs')
  const secondSettings = join(root, 'second.mjs')
  for (const [path, tag] of /** @type {const} */ ([[firstSettings, 'h2'], [secondSettings, 'h3']])) {
    await writeFile(path, `export default md => {
      md.renderer.rules.heading_open = () => '<${tag}>'
      md.renderer.rules.heading_close = () => '</${tag}>'
      return md
    }`)
  }
  const getMarkdownRenderer = createMdResolver()
  const first = await build('# Heading', { markdownItSettingsPath: firstSettings, getMarkdownRenderer })
  const second = await build('# Heading', { markdownItSettingsPath: secondSettings, getMarkdownRenderer })
  const defaults = await build('# Heading', { getMarkdownRenderer })
  assert.equal(await first.pageLayout({ vars: {}, data: {}, page: pageInfo }), '<h2>Heading</h2>')
  assert.equal(await second.pageLayout({ vars: {}, data: {}, page: pageInfo }), '<h3>Heading</h3>')
  assert.match(await defaults.pageLayout({ vars: {}, data: {}, page: pageInfo }), /<h1 id="heading"[^>]*>Heading<\/h1>/)
})

test('standalone builders do not retain a previous call\'s settings', async t => {
  const { root, pageInfo, build } = await fixture(t)
  const settings = join(root, 'settings.mjs')
  await writeFile(settings, `export default md => {
    md.renderer.rules.heading_open = () => '<h2>'
    md.renderer.rules.heading_close = () => '</h2>'
    return md
  }`)
  const custom = await build('# Heading', { markdownItSettingsPath: settings })
  const defaults = await build('# Heading', {})
  assert.match(await defaults.pageLayout({ vars: {}, data: {}, page: pageInfo }), /<h1 id="heading"[^>]*>/)
  assert.equal(await custom.pageLayout({ vars: {}, data: {}, page: pageInfo }), '<h2>Heading</h2>')
})

test('settings errors keep the existing default-renderer fallback within a build', async t => {
  const { root, pageInfo, build } = await fixture(t)
  const settings = join(root, 'settings.mjs')
  await writeFile(settings, 'export default () => { throw new Error("bad settings") }')
  const errors = t.mock.method(console, 'error', () => {})
  const options = { markdownItSettingsPath: settings, getMarkdownRenderer: createMdResolver() }
  const first = await build('# First', options)
  const second = await build('# Second', options)
  assert.equal(errors.mock.callCount(), 1)
  assert.match(await first.pageLayout({ vars: {}, data: {}, page: pageInfo }), /<h1 id="first"[^>]*>First<\/h1>/)
  assert.match(await second.pageLayout({ vars: {}, data: {}, page: pageInfo }), /<h1 id="second"[^>]*>Second<\/h1>/)
})

test('async settings failure is shared as a fallback, and a fresh build can recover', async t => {
  const { root, pageInfo } = await fixture(t)
  const settingsPath = join(root, 'settings.mjs')
  await writeFile(pageInfo.pageFile.filepath, '# Heading')
  await writeFile(settingsPath, `export let calls = 0
    let failing = true
    export function recover () { failing = false }
    export default async md => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 5))
      if (failing) throw new Error('async settings failure')
      md.renderer.rules.heading_open = () => '<h2>'
      md.renderer.rules.heading_close = () => '</h2>'
      return md
    }`)
  const settings = await import(settingsPath)
  const errors = t.mock.method(console, 'error', () => {})
  const options = { markdownItSettingsPath: settingsPath, getMarkdownRenderer: createMdResolver() }
  const pages = await Promise.all(Array.from({ length: 12 }, () => mdBuilder({ pageInfo, options })))
  assert.equal(settings.calls, 1)
  assert.equal(errors.mock.callCount(), 1)
  for (const page of pages) {
    assert.match(await page.pageLayout({ vars: {}, data: {}, page: pageInfo }), /<h1 id="heading"[^>]*>Heading<\/h1>/)
  }
  settings.recover()
  await mdBuilder({ pageInfo, options })
  assert.equal(settings.calls, 1, 'the fulfilled fallback remains cached for this build')
  const next = await mdBuilder({ pageInfo, options: { ...options, getMarkdownRenderer: createMdResolver() } })
  assert.equal(settings.calls, 2)
  assert.equal(errors.mock.callCount(), 1)
  assert.equal(await next.pageLayout({ vars: {}, data: {}, page: pageInfo }), '<h2>Heading</h2>')
})

test('concurrent pages share one settings initialization per direct build, not across builds', async t => {
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`article-${i}/page.md`, '# Heading']))
  const fixture = await setup(t, {
    ...files,
    'markdown-it.settings.js': `export let calls = 0
      export default async md => {
        const id = ++calls
        await new Promise(resolve => setTimeout(resolve, 5))
        md.renderer.rules.heading_open = () => '<h1 data-renderer="' + id + '">'
        return md
      }`,
  })
  const initial = await fixture.build()
  const settings = await import(join(fixture.src, 'markdown-it.settings.js'))
  assert.equal(settings.calls, 0, 'the initial worker does not share application module state')
  for (const expected of [1, 2]) {
    const result = await buildPagesDirect(fixture.src, fixture.dest, initial.siteData)
    assert.deepEqual(result.errors, [])
    assert.equal(result.report.pages.length, 12)
    assert.equal(settings.calls, expected)
    for (let i = 0; i < 12; i++) {
      assert.match(await fixture.read(`article-${i}/index.html`), new RegExp(`data-renderer="${expected}"`))
    }
  }
})
