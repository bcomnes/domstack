import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

test('the built documentation loads Mermaid and renders diagrams without errors', async ({ page, siteURL }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${siteURL}/docs/implementation/`)
  const diagrams = page.locator('.mermaid')
  await expect(diagrams.first()).toBeVisible()
  for (const diagram of await diagrams.all()) {
    await expect(diagram.locator('svg')).toBeVisible()
    // Mermaid may render an error SVG without throwing a JavaScript error.
    await expect(diagram.locator('.error-icon')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})
