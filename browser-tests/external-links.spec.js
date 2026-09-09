import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

for (const javaScriptEnabled of [true, false]) {
  test.describe(`external link markers with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, () => {
    test.use({ javaScriptEnabled })

    test('footer and documentation share decorative markers without changing link behavior', async ({ page, siteURL }) => {
      await page.goto(`${siteURL}/docs/implementation/`)
      const footer = page.getByRole('navigation', { name: 'Footer', exact: true })
      for (const name of ['npm', 'GitHub', 'MIT license']) {
        // The marker must not become part of the link's accessible name.
        const link = footer.getByRole('link', { name, exact: true })
        expect(await link.evaluate(el => getComputedStyle(el, '::after').content)).toContain('↗')
        await expect(link).not.toHaveAttribute('target')
      }
      const headerLink = page.getByRole('navigation', { name: 'Site', exact: true })
        .getByRole('link', { name: 'GitHub', exact: true })
      await expect(headerLink).toHaveText('GitHub') // No duplicated hand-written arrow.
      expect(await headerLink.evaluate(el => getComputedStyle(el, '::after').content)).toContain('↗')
      const toolLink = page.locator('.docs-content').getByRole('link', { name: 'esbuild', exact: true }).first()
      expect(await toolLink.evaluate(el => getComputedStyle(el, '::after').content)).toContain('↗')
      expect(await footer.getByRole('link', { name: 'Docs', exact: true })
        .evaluate(el => getComputedStyle(el, '::after').content)).toBe('none')

      // Exercise the shared stylesheet, including Markdown's possible URL forms.
      // Browser evaluation still works when page JavaScript is disabled.
      const markers = await page.evaluate(() => {
        const cases = [
          ['https://example.com/', true],
          ['http://example.com/', true],
          ['HTTPS://example.com/', true],
          ['//example.com/', true],
          ['../pages/', false],
          ['/docs/pages/', false],
          ['#build-process-flow', false],
          ['mailto:hello@example.com', false],
          ['tel:+15555555555', false],
        ]
        const container = document.createElement('div')
        document.querySelector('.docs-content').append(container)
        const results = cases.map(([href, expected]) => {
          const link = document.createElement('a')
          link.setAttribute('href', href)
          link.textContent = 'Example'
          container.append(link)
          return { href, expected, marked: getComputedStyle(link, '::after').content.includes('↗') }
        })
        for (const tag of ['img', 'svg']) {
          const link = document.createElement('a')
          link.href = 'https://example.com/'
          link.append(tag === 'svg'
            ? document.createElementNS('http://www.w3.org/2000/svg', tag)
            : document.createElement(tag))
          container.append(link)
          results.push({ href: tag, expected: false, marked: getComputedStyle(link, '::after').content.includes('↗') })
        }
        container.remove()
        return results.filter(result => result.marked !== result.expected)
      })
      expect(markers).toEqual([])
    })
  })
}
