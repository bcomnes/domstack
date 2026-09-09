import { resolve } from 'node:path'
import { expect, test } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: { ignore: ['examples', 'test-cases', 'coverage', '*.tsconfig.json', 'fonts'] },
})

for (const colorScheme of ['light', 'dark']) {
  test(`renders documentation diagrams and bookmark redirects in ${colorScheme} mode`, async ({ page, siteURL }) => {
    test.setTimeout(30_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ colorScheme })
    await page.goto(`${siteURL}/docs/implementation/`)

    async function expectDiagrams () {
      const diagrams = page.locator('.mermaid')
      await expect(diagrams).toHaveCount(3)
      for (const diagram of await diagrams.all()) {
        // Mermaid can render an error SVG without throwing a page error.
        await expect(diagram.locator('svg')).toBeVisible()
        await expect(diagram.locator('svg .flowchart-link').first()).toBeAttached()
        await expect(diagram.locator('.error-icon')).toHaveCount(0)
        const colors = await diagram.evaluate(element => ({
          text: getComputedStyle(element).color,
          edges: [...element.querySelectorAll('.flowchart-link')].map(path => getComputedStyle(path).stroke),
          arrows: [...element.querySelectorAll('marker path')].map(path => getComputedStyle(path).fill),
        }))
        expect(colors.arrows.length).toBeGreaterThan(0)
        expect(colors.edges.every(color => color === colors.text)).toBe(true)
        expect(colors.arrows.every(color => color === colors.text)).toBe(true)
      }
    }

    await expectDiagrams()
    await page.goto(`${siteURL}/#build-process-flow`)
    await expect(page).toHaveURL(`${siteURL}/docs/implementation/#build-process-flow`)
    await expectDiagrams()
    expect(errors).toEqual([])
  })
}
