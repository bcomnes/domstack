import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { render } from 'fragtml'
import { breadcrumb } from './docs.layout.js'

for (const { url, labels, links } of [
  { url: '/docs/', labels: ['Home', 'docs'], links: ['../'] },
  { url: '/docs/pages/', labels: ['Home', 'docs', 'pages'], links: ['../../', '../'] },
  { url: '/docs/v12-migration.html', labels: ['Home', 'docs', 'v12-migration'], links: ['../', './'] },
  { url: '/docs/nested/page/', labels: ['Home', 'docs', 'nested', 'page'], links: ['../../../', '../../', '../'] },
]) {
  test(`breadcrumbs for ${url}`, () => {
    const $ = load(render(breadcrumb(url)))
    const nav = $('nav[aria-label="Breadcrumb"]')
    assert.deepEqual(nav.find('li').map((_, element) => $(element).text().trim()).get(), labels)
    assert.deepEqual(nav.find('a').map((_, element) => $(element).attr('href')).get(), links)
    assert.equal(nav.find('[aria-current="page"]').length, 1)
    assert.equal(nav.find('[aria-current="page"]').text(), labels.at(-1))

    for (const basePath of ['', '/domstack']) {
      const base = `https://example.com${basePath}${url}`
      assert.equal(new URL(links[0], base).pathname, `${basePath}/`)
      if (links[1]) assert.equal(new URL(links[1], base).pathname, `${basePath}/docs/`)
    }
  })
}

test('breadcrumb labels escape HTML', () => {
  const $ = load(render(breadcrumb('/docs/<script>alert(1)<script>/')))
  assert.equal($('script').length, 0)
  assert.equal($('[aria-current="page"]').text(), '<script>alert(1)<script>')
})
