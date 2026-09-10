/** @import { DocsPageVars, NavigationPage } from './navigation.js' */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { render } from 'fragtml'
import { renderMd } from '../../../lib/build-pages/page-builders/md/get-md.js'
import { collectDocsNavigation, docsIndex, navigationHref } from './navigation.js'
import { documentationContent, navigation } from './docs.layout.js'

/** @param {string} url @param {string} markdown @param {DocsPageVars} [vars] @returns {NavigationPage} */
function page (url, markdown, vars = {}) {
  return { pageInfo: { url, type: 'md' }, vars, renderInnerPage: () => renderMd(markdown, {}) }
}

test('page metadata orders navigation and rendered Markdown supplies real heading IDs', async () => {
  const entries = await collectDocsNavigation([
    page('/docs/second/', '# Second\n\n## Same\n\n## Same\n\n### Child', { docsOrder: 20 }),
    page('/unrelated/', '# Ignore me'),
    page('/docs/first/', '# First `title`\n\n### No parent\n\n## Table of Contents\n\n[[toc]]\n\n## Custom {#café}\n\n### <em>Nested</em>\n\n#### Too deep', { docsOrder: 10 }),
  ])
  assert.deepEqual(entries, [
    {
      title: 'First title',
      url: '/docs/first/',
      sections: [
        { title: 'No parent', url: '/docs/first/#no-parent', sections: [] },
        {
          title: 'Custom',
          url: '/docs/first/#caf%C3%A9',
          sections: [{ title: 'Nested', url: '/docs/first/#nested', sections: [] }],
        },
      ],
    },
    {
      title: 'Second',
      url: '/docs/second/',
      sections: [
        { title: 'Same', url: '/docs/second/#same', sections: [] },
        {
          title: 'Same',
          url: '/docs/second/#same-1',
          sections: [{ title: 'Child', url: '/docs/second/#child', sections: [] }],
        },
      ],
    },
  ])
  const $ = load(render(navigation(entries, '/docs/first/')))
  assert.equal($('details[open]').length, 2, 'outer disclosure and current page are open in server HTML')
  assert.equal($('a[aria-current="page"]').text(), 'First title')
  assert.equal($('a[href="./#caf%C3%A9"]').text(), 'Custom')

  const landing = load(render(docsIndex(entries)))
  assert.equal(landing('.docs-index a[href="first/#caf%C3%A9"]').text(), 'Custom')
  assert.equal(landing('.docs-index a[href="second/#same-1"]').text(), 'Same')
})

test('new docs are discovered automatically without rendering the data-dependent index', async () => {
  const index = page('/docs/', '{{{ data.docsIndexHtml }}}')
  index.renderInnerPage = async () => { throw new Error('Index data is not ready') }
  const nonMarkdown = page('/docs/html/', '# Not Markdown')
  nonMarkdown.pageInfo.type = 'html'
  const pages = [
    index,
    page('/docs/z-new/', '# New page'),
    page('/elsewhere/', '# Not documentation'),
    nonMarkdown,
    page('/docs/a-new/', '# Another new page'),
    page('/docs/ordered/', '# Ordered', { docsOrder: 10 }),
  ]
  const original = [...pages]
  const entries = await collectDocsNavigation(pages)
  assert.deepEqual(entries.map(entry => entry.url), ['/docs/ordered/', '/docs/a-new/', '/docs/z-new/'])
  assert.deepEqual(pages, original, 'collection must not reorder the source pages')
  assert.deepEqual(await collectDocsNavigation([...pages].reverse()), entries, 'discovery order must not affect navigation')
  assert.deepEqual(await collectDocsNavigation([index]), [])
})

test('page-only migration guides nest under their parent and select the active child', async () => {
  const entries = await collectDocsNavigation([
    page('/docs/migrations/v11-migration.html', '# v11 migration\n\n## First step', { docsParent: '/docs/migrations/', docsPageOnly: true, docsOrder: 20 }),
    page('/docs/migrations/v12-migration.html', '# v12 migration\n\n## First step', { docsParent: '/docs/migrations/', docsPageOnly: true, docsOrder: 10 }),
    page('/docs/guide/', '# Guide', { docsOrder: 10 }),
    page('/docs/migrations/', '# Migrations', { docsOrder: 160 }),
  ])
  assert.deepEqual(entries, [
    { title: 'Guide', url: '/docs/guide/', sections: [] },
    {
      title: 'Migrations',
      url: '/docs/migrations/',
      sections: [
        { title: 'v12 migration', url: '/docs/migrations/v12-migration.html', sections: [] },
        { title: 'v11 migration', url: '/docs/migrations/v11-migration.html', sections: [] },
      ],
    },
  ])
  const sidebar = load(render(navigation(entries, '/docs/migrations/v12-migration.html')))
  assert.equal(sidebar('nav details[open]').length, 1)
  assert.equal(sidebar('nav details > summary').text().trim(), 'Migrations')
  assert.equal(sidebar('nav a[aria-current="page"]').text(), 'v12 migration')
  const landing = load(render(docsIndex(entries)))
  assert.equal(landing('.docs-index > ul > li > a').length, 2)
  assert.equal(landing('.docs-index > ul > li > ul a').length, 2)
  assert.equal(landing('.docs-index a[href="migrations/v12-migration.html"]').text(), 'v12 migration')
})

test('navigation parents must be existing ancestor pages', async () => {
  for (const docsParent of ['/docs/missing/', '/docs/other/', '/docs/migrations/guide/']) {
    await assert.rejects(collectDocsNavigation([
      page('/docs/migrations/guide/', '# Guide', { docsParent }),
      page('/docs/other/', '# Not an ancestor'),
    ]), /Invalid documentation parent/)
  }
})

test('navigation links preserve deployment prefixes for directory and flat pages', () => {
  for (const base of ['', '/domstack']) {
    for (const from of ['/docs/', '/docs/pages/', '/docs/migrations/v12-migration.html']) {
      for (const to of ['/docs/', '/docs/cli/#usage', '/docs/migrations/v12-migration.html#changes']) {
        const actual = new URL(navigationHref(from, to), `https://example.com${base}${from}`)
        assert.equal(actual.pathname + actual.hash, base + to)
      }
    }
  }
})

test('website content replaces only the local ToC and escapes navigation labels', async () => {
  const content = await renderMd('# Title\n\n## Table of Contents\n\n[[toc]]\n\n## Content\n\n```html\n<script>example</script>\n```', {})
  const $ = load(render(documentationContent(content)))
  assert.equal($('.table-of-contents, #table-of-contents').length, 0)
  assert.equal($('#content').text(), 'Content')
  assert.equal($('pre code').text().trim(), '<script>example</script>')
  const entries = [{ title: '<script>unsafe</script>', url: '/docs/page/', sections: [], group: '<script>group</script>' }]
  const nav = load(render(navigation(entries, '/docs/')))
  assert.equal(nav('script').length, 0)
  assert.equal(nav('nav > ul > li > a').text(), '<script>unsafe</script>')
  const index = load(render(docsIndex(entries)))
  assert.equal(index('script').length, 0)
  assert.equal(index('.docs-index > h2').text(), '<script>group</script>')
  assert.equal(index('.docs-index a').text(), '<script>unsafe</script>')
})
