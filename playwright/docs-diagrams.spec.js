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
  await expect(diagrams).toHaveCount(3)
  await expect(diagrams.first()).toBeVisible()
  for (const diagram of await diagrams.all()) {
    await expect(diagram.locator('svg')).toBeVisible()
    // Mermaid may render an error SVG without throwing a JavaScript error.
    await expect(diagram.locator('.error-icon')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('diagram edges and arrowheads follow live light/dark color changes', async ({ page, siteURL }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(`${siteURL}/docs/implementation/`)
  const diagrams = page.locator('.mermaid')
  await expect(diagrams).toHaveCount(3)
  for (const diagram of await diagrams.all()) {
    await expect(diagram.locator('svg')).toBeVisible()
  }

  const colors = new Set()
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    const color = await page.locator('body').evaluate(element => getComputedStyle(element).color)
    colors.add(color)
    for (const diagram of await diagrams.all()) {
      await expect(diagram.locator('.flowchart-link').first()).toHaveCSS('stroke', color)
      await expect(diagram.locator('.marker path').first()).toHaveCSS('fill', color)
      await expect(diagram.locator('.marker path').first()).toHaveCSS('stroke', color)
    }
  }
  expect(colors.size).toBe(2)
})
