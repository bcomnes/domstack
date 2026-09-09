import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load } from 'cheerio'
import { renderMd } from '../lib/build-pages/page-builders/md/get-md.js'
import { parseMdFileContents } from '../lib/build-pages/page-builders/md/parse-md.js'
import { expect, test } from './support.js'

const root = resolve(import.meta.dirname, '..')
test.use({
  siteSrc: root,
  siteOptions: { ignore: ['examples', 'test-cases', 'coverage', '*.tsconfig.json', 'fonts'] },
})

test('page-by-page documentation audit preserves content, whitespace, and local link targets', async ({ page, siteURL }) => {
  test.setTimeout(90_000)
  const sources = (await readdir(join(root, 'docs'), { recursive: true }))
    .filter(file => file.endsWith('.md')).sort()
  const responses = new Map()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  for (const source of sources) {
    await test.step(source, async () => {
      const { markdownContent } = parseMdFileContents(await readFile(join(root, 'docs', source), 'utf8'))
      const expected = load(await renderMd(markdownContent, {}))
      expected('.table-of-contents').remove()
      expected('h2, h3').filter((_, el) => expected(el).text().trim().toLowerCase() === 'table of contents').remove()
      const url = `/docs/${source.replaceAll('\\', '/').replace(/README\.md$/, '').replace(/\.md$/, '.html')}`
      const response = await page.goto(siteURL + url)
      expect(response?.status()).toBe(200)
      const actual = load(await response.text())
      const content = actual('.docs-content')
      expect.soft(content.length, `${source}: one content region`).toBe(1)

      const expectedPre = expected('pre').map((_, el) => expected(el).text()).get()
      const actualPre = content.find('pre').map((_, el) => actual(el).text()).get()
      expect.soft(actualPre.length, `${source}: pre count`).toBe(expectedPre.length)
      const damaged = expectedPre.flatMap((text, index) => text === actualPre[index] ? [] : [index + 1])
      expect.soft(damaged, `${source}: pre blocks with changed whitespace (1-based)`).toEqual([])

      // Check normal Markdown structure independently of our ToC transformer.
      for (const selector of ['h1, h2, h3, h4, h5, h6', 'table tr', 'blockquote', 'code:not(pre code)']) {
        const text = (value) => value.replace(/\s+/g, ' ').trim()
        expect.soft(
          content.find(selector).map((_, el) => text(actual(el).text())).get(),
          `${source}: ${selector}`
        ).toEqual(expected(selector).map((_, el) => text(expected(el).text())).get())
      }
      expect.soft(
        content.find('h1, h2, h3, h4, h5, h6').map((_, el) => actual(el).attr('id')).get(),
        `${source}: heading IDs`
      ).toEqual(expected('h1, h2, h3, h4, h5, h6').map((_, el) => expected(el).attr('id')).get())

      // Mermaid replaces its pre with an SVG; its visual rendering has separate
      // tests. All other code samples must retain both text and preformatted CSS.
      const browserPre = await page.locator('.docs-content pre:not(.mermaid)').evaluateAll(elements => elements.map(el => ({
        text: el.textContent,
        whitespace: getComputedStyle(el.querySelector('code') ?? el).whiteSpace,
      })))
      const expectedCode = expected('pre:not(.mermaid)').map((_, el) => expected(el).text()).get()
      expect.soft(browserPre.length, `${source}: browser code count`).toBe(expectedCode.length)
      expect.soft(browserPre.flatMap((block, index) =>
        block.text === expectedCode[index] && ['pre', 'pre-wrap', 'break-spaces'].includes(block.whitespace)
          ? []
          : [index + 1]), `${source}: damaged browser code blocks`).toEqual([])

      const ids = actual('[id]').map((_, el) => actual(el).attr('id')).get()
      expect.soft(ids.filter((id, i) => ids.indexOf(id) !== i), `${source}: duplicate IDs`).toEqual([])
      const broken = []
      for (const link of actual('.docs-content a[href], .docs-navigation a[href]').toArray()) {
        const target = new URL(actual(link).attr('href'), siteURL + url)
        if (target.origin !== siteURL) continue
        let destination = responses.get(target.pathname)
        if (!destination) {
          const response = await page.request.get(siteURL + target.pathname)
          destination = { status: response.status(), document: load(await response.text()) }
          responses.set(target.pathname, destination)
        }
        if (destination.status !== 200 || (target.hash && !destination.document('[id]').toArray().some(
          el => [target.hash.slice(1), decodeURIComponent(target.hash.slice(1))].includes(destination.document(el).attr('id'))
        ))) broken.push(target.pathname + target.hash)
      }
      expect.soft([...new Set(broken)], `${source}: broken local links`).toEqual([])
      console.log(`${source}: ${expectedPre.length} pre blocks, ${expected('h1,h2,h3,h4,h5,h6').length} headings audited`)
    })
  }
  expect(errors).toEqual([])
})

test('the v11 migration cross-reference lands on section 7', async ({ page, siteURL }) => {
  await page.goto(`${siteURL}/docs/v11-migration.html`)
  await page.locator('.docs-content').getByRole('link', { name: 'section 7', exact: true }).click()
  await expect(page.locator(':target')).toHaveAttribute('id', '7.-postvars-removed-%E2%86%92-global.data.js')
  await expect(page.locator('.docs-navigation a[aria-current="location"]')).toHaveText('7. postVars Removed → global.data.js')
})
