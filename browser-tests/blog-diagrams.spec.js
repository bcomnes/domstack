import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

const postPath = '/blog/2026/inside-the-domstack-build-and-watch-cycle/'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: { ...websiteOptions, buildDrafts: true },
})

test('the architecture draft renders page-scoped diagrams in both themes and on narrow screens', async ({ page, siteURL }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${siteURL}${postPath}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inside the DOMStack build and watch cycle')

  const diagrams = page.locator('.mermaid')
  await expect(diagrams).toHaveCount(4)
  for (const diagram of await diagrams.all()) {
    await expect(diagram.locator('svg')).toBeVisible()
    await expect(diagram.locator('.error-icon')).toHaveCount(0)
  }

  const colors = new Set()
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    const color = await page.locator('body').evaluate(element => getComputedStyle(element).color)
    colors.add(color)
    for (const diagram of await diagrams.all()) {
      await expect(diagram.locator('.flowchart-link').first()).toHaveCSS('stroke', color)
      await expect(diagram.locator('.marker path').first()).toHaveCSS('fill', color)
    }
  }
  expect(colors.size).toBe(2)

  await page.setViewportSize({ width: 375, height: 812 })
  for (const diagram of await diagrams.all()) {
    await expect(diagram).toHaveCSS('overflow-x', 'auto')
    await expect(diagram).toHaveAttribute('tabindex', '0')
  }
  const overflowsPage = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflowsPage).toBe(false)
  expect(errors).toEqual([])
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the article and diagram source remain readable', async ({ page, siteURL }) => {
    await page.goto(`${siteURL}${postPath}`)
    await expect(page.getByRole('heading', { name: 'Global data is not one big cache', exact: true })).toBeVisible()
    const diagrams = page.locator('.mermaid')
    await expect(diagrams).toHaveCount(4)
    for (const diagram of await diagrams.all()) {
      await expect(diagram).toContainText('flowchart TD')
      await expect(diagram.locator('svg')).toHaveCount(0)
    }
  })
})

test.describe('production build', () => {
  test.use({ siteOptions: websiteOptions })

  test('the draft is not published or included in feeds', async ({ page, siteURL }) => {
    const response = await page.goto(`${siteURL}${postPath}`)
    expect(response?.status()).toBe(404)
    const feed = await page.request.get(`${siteURL}/feed.json`)
    expect(feed.ok()).toBe(true)
    expect(await feed.text()).not.toContain(postPath)
  })
})
