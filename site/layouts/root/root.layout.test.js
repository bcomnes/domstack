import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { html, raw } from 'fragtml'
import rootLayout from './root.layout.js'
import docsLayout from '../docs/docs.layout.js'

test('site shell preserves children, escapes metadata, and creates exactly one main landmark', async () => {
  const code = 'first line\n  indented\n\nlast line\n'
  const page = /** @type {any} */ ({ url: '/docs/layouts/' })
  for (const layout of ['root', 'docs']) {
    const contents = `<pre><code>${code}</code></pre>`
    // Exercise the real nested rendering path that previously stripped newlines.
    const children = layout === 'docs'
      ? await docsLayout({ children: html`<article>${raw(contents)}</article>`, page, vars: {}, data: { docsNavigation: [] } })
      : contents
    const output = await rootLayout({
      children,
      vars: { layout, title: '<Title>', lang: 'en', basePath: '/project' },
      page,
      data: {},
      scripts: ['/site/client.js'],
      styles: ['/site/styles.css'],
    })
    const $ = load(output)
    assert.equal($('title').text(), '<Title> | domstack')
    assert.equal($('main').length, 1)
    assert.equal($('main pre code').text(), code)
    assert.equal($('main header, main footer').length, 0)
    assert.equal($('script').attr('src'), '/project/site/client.js')
    assert.equal($('link[rel="stylesheet"]').attr('href'), '/project/site/styles.css')
  }
})
