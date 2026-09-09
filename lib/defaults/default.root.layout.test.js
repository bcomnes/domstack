import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { html, raw, render } from 'fragtml'
import defaultRootLayout from './default.root.layout.js'

test('string and HtmlResult children preserve whitespace through the root layout', async () => {
  const code = 'first line\n  indented line\n\n\tlast line\n'
  const contents = `<pre><code>${code}</code></pre><pre>${code}</pre><textarea>${code}</textarea>`
  for (const children of [contents, html`<article>${raw(contents)}</article>`]) {
    const output = await defaultRootLayout({
      children,
      vars: { title: '<Title>', siteName: 'Test', defaultStyle: true, basePath: '' },
      data: {},
      // This layout does not inspect page metadata.
      page: /** @type {any} */ ({}),
    })
    const $ = load(output)
    assert.equal($('title').text(), '<Title> | Test', 'metadata remains escaped')
    assert.equal($('main pre code').text(), code, 'fenced code preserves exact whitespace')
    assert.equal($('main pre').eq(1).text(), code, 'raw pre preserves exact whitespace')
    assert.equal($('main textarea').text(), code, 'textarea preserves exact whitespace')
    assert.equal($('main').find('article').length, typeof children === 'string' ? 0 : 1)
    assert.equal($('main').text(), load(typeof children === 'string' ? children : render(children)).text())
  }
})
