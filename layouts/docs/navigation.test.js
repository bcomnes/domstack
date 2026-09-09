import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { render } from 'fragtml'
import { renderMd } from '../../lib/build-pages/page-builders/md/get-md.js'
import { collectDocsNavigation, navigationHref } from './navigation.js'
import { documentationContent, navigation } from './docs.layout.js'

/** @param {string} url @param {string} markdown */
function page (url, markdown) {
  return { pageInfo: { url, type: 'md' }, renderInnerPage: () => renderMd(markdown, {}) }
}

test('index order and rendered IDs define navigation, not discovery order or a separate slugger', async () => {
  const entries = await collectDocsNavigation([
    page('/docs/second/', '# Second\n\n## Same\n\n## Same\n\n### Child'),
    page('/unrelated/', '# Ignore me'),
    page('/docs/unlisted/', '# Not in the index'),
    page('/docs/', '<div class="docs-index">\n\n- [First](./first/)\n- [Second](second/)\n\n</div>'),
    page('/docs/first/', '# First `title`\n\n### No parent\n\n## Table of Contents\n\n[[toc]]\n\n## Custom {#café}\n\n### <em>Nested</em>\n\n#### Too deep'),
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

  const index = await page('/docs/', '<div class="docs-index">\n\n- [First](./first/)\n- [Second](second/)\n\n</div>').renderInnerPage()
  const landing = load(render(documentationContent(index, entries, '/docs/')))
  assert.equal(landing('.docs-index a[href="first/#caf%C3%A9"]').text(), 'Custom')
  assert.equal(landing('.docs-index a[href="second/#same-1"]').text(), 'Same')
})

test('invalid and duplicate index links fail with an actionable build error', async () => {
  for (const href of ['missing/', 'https://example.com/', 'first/#heading', 'first/?query']) {
    await assert.rejects(collectDocsNavigation([
      page('/docs/', `<div class="docs-index">\n\n- [Invalid](${href})\n\n</div>`),
      page('/docs/first/', '# First'),
    ]), /Invalid documentation index page/)
  }
  await assert.rejects(collectDocsNavigation([
    page('/docs/', '<div class="docs-index">\n\n- [First](first/)\n- [Duplicate](./first/)\n\n</div>'),
    page('/docs/first/', '# First'),
  ]), /Duplicate documentation index page/)
})

test('navigation links preserve deployment prefixes for directory and flat pages', () => {
  for (const base of ['', '/domstack']) {
    for (const from of ['/docs/', '/docs/pages/', '/docs/v12-migration.html']) {
      for (const to of ['/docs/', '/docs/cli/#usage', '/docs/v12-migration.html#changes']) {
        const actual = new URL(navigationHref(from, to), `https://example.com${base}${from}`)
        assert.equal(actual.pathname + actual.hash, base + to)
      }
    }
  }
})

test('website content replaces only the local ToC and escapes navigation labels', async () => {
  const content = await renderMd('# Title\n\n## Table of Contents\n\n[[toc]]\n\n## Content\n\n```html\n<script>example</script>\n```', {})
  const $ = load(render(documentationContent(content, [], '/docs/page/')))
  assert.equal($('.table-of-contents, #table-of-contents').length, 0)
  assert.equal($('#content').text(), 'Content')
  assert.equal($('pre code').text().trim(), '<script>example</script>')
  const nav = load(render(navigation([{ title: '<script>unsafe</script>', url: '/docs/page/', sections: [] }], '/docs/')))
  assert.equal(nav('script').length, 0)
  assert.equal(nav('summary a').text(), '<script>unsafe</script>')
})
