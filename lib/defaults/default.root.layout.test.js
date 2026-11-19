import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { ESLint } from 'eslint'
import { neostandard } from 'neostandard'
import { generateDefaultRootLayout } from '../../scripts/build-defaults.js'
import canonicalRootLayout from './default.root.layout.ts'
import { load } from 'cheerio'
import { html, raw, render } from 'fragtml'
import defaultRootLayout from './default.root.layout.js'

test('checked-in JavaScript matches the canonical TypeScript build', async () => {
  const source = await readFile(new URL('./default.root.layout.ts', import.meta.url), 'utf8')
  const generated = await readFile(new URL('./default.root.layout.js', import.meta.url), 'utf8')
  assert.equal(generated, await generateDefaultRootLayout(source))
  assert.doesNotMatch(generated, /#types|import type|@domstack\/static\/types/)
  assert.match(generated, /html`<script type="module" src=/)
  assert.match(generated, /<\/script>`/)
  assert.doesNotMatch(generated, /__template|__freeze|__defProp|<\\\/script>/)
})

test('generated JavaScript passes neostandard without fixes or repository ignores', async () => {
  const generated = await readFile(new URL('./default.root.layout.js', import.meta.url), 'utf8')
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: neostandard({ env: ['browser'], ts: true }),
  })
  const [result] = await eslint.lintText(generated, { filePath: 'default.root.layout.js' })
  assert.ok(result)
  assert.deepEqual(result.messages, [])
})

test('generated script templates match TypeScript rendering and apply basePath', () => {
  const params = {
    vars: { title: 'Scripts', siteName: 'Test', basePath: '/docs', defaultStyle: true },
    scripts: ['/app.js', 'relative.js', 'https://example.com/app.js'],
    styles: ['/app.css'],
    children: '',
    data: {},
    page: /** @type {any} */ ({}),
  }
  const output = defaultRootLayout(params)
  assert.equal(output, canonicalRootLayout(params))
  const $ = load(output)
  assert.deepEqual($('script').map((_, script) => $(script).attr('src')).get(), [
    '/docs/app.js', 'relative.js', 'https://example.com/app.js',
  ])
  assert.equal($('link').attr('href'), '/docs/app.css')
  assert.equal($('script[type="module"]').length, 3)
})

test('string and HtmlResult children preserve whitespace through the root layout', async () => {
  const code = 'first line\n  indented line\n\n\tlast line\n'
  const contents = `<pre><code>${code}</code></pre><pre>${code}</pre><textarea>${code}</textarea>`
  for (const children of [contents, html`<article>${raw(contents)}</article>`]) {
    const params = {
      children,
      vars: { title: '<Title>', siteName: 'Test', defaultStyle: true, basePath: '' },
      data: {},
      // This layout does not inspect page metadata.
      page: /** @type {any} */ ({}),
    }
    const output = defaultRootLayout(params)
    assert.equal(output, canonicalRootLayout(params))
    const $ = load(output)
    assert.equal($('title').text(), '<Title> | Test', 'metadata remains escaped')
    assert.equal($('main pre code').text(), code, 'fenced code preserves exact whitespace')
    assert.equal($('main pre').eq(1).text(), code, 'raw pre preserves exact whitespace')
    assert.equal($('main textarea').text(), code, 'textarea preserves exact whitespace')
    assert.equal($('main').find('article').length, typeof children === 'string' ? 0 : 1)
    assert.equal($('main').text(), load(typeof children === 'string' ? children : render(children)).text())
  }
})
