import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { html, raw } from 'fragtml'
import rootLayout from './root.layout.js'

test('site shell preserves children, escapes metadata, and creates exactly one main landmark', async () => {
  const code = 'first line\n  indented\n\nlast line\n'
  for (const layout of ['root', 'docs']) {
    const contents = `<pre><code>${code}</code></pre>`
    const children = layout === 'docs' ? html`<main id="docs-content">${raw(contents)}</main>` : contents
    const output = await rootLayout({
      children,
      vars: { layout, title: '<Title>', lang: 'en', basePath: '/project' },
      // Only the canonical URL is consumed by the website's shell.
      page: /** @type {any} */ ({ url: '/docs/layouts/' }),
      data: {},
      scripts: ['/site/client.js'],
      styles: ['/site/styles.css'],
    })
    const $ = load(output)
    assert.equal($('html').attr('lang'), 'en')
    assert.equal($('title').text(), '<Title> | domstack')
    assert.equal($('meta[name="viewport"]').attr('content'), 'width=device-width, initial-scale=1')
    assert.equal($('main').length, 1)
    assert.equal($('main pre code').text(), code)
    assert.equal($('main header, main footer').length, 0)
    assert.equal($('body > header').length, 1)
    assert.equal($('body > footer').length, 1)
    assert.equal($('script').attr('src'), '/project/site/client.js')
    assert.equal($('link[rel="stylesheet"]').attr('href'), '/project/site/styles.css')
    assert.equal($('.site-menu-toggle').length, layout === 'docs' ? 1 : 0)
    assert.equal($('.site-skip-link').attr('href'), layout === 'docs' ? '#docs-content' : '#main-content')
    assert.equal($('header .site-brand').attr('href'), '../../')
    assert.equal($('header nav a').first().attr('href'), '../')
  }
})

test('footer copyright uses the current year on every render', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2030, 5, 1) })
  for (const year of [2030, 2031]) {
    t.mock.timers.setTime(Date.UTC(year, 5, 1))
    const output = await rootLayout({
      children: '',
      vars: {},
      page: /** @type {any} */ ({ url: '/docs/' }),
      data: {},
    })
    const $ = load(output)
    assert.equal($('.site-copyright').text(), `domstack © ${year}`)
    assert.equal($('.site-copyright .site-brand').attr('href'), '../')
  }
})
