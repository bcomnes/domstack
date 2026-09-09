import { resolve } from 'node:path'
import { expect, test } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: { ignore: ['examples', 'test-cases', 'coverage', '*.tsconfig.json', 'fonts'] },
})

test('complete index links reach real headings and sidebar follows the current page and section', async ({ page, siteURL }) => {
  test.setTimeout(30_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(`${siteURL}/docs/`)
  // Nested globals and layouts must still be discovered, bundled, and loaded.
  await expect(page.locator('link[rel="stylesheet"][href*="/site/globals/global-"]')).toHaveCount(1)
  await expect(page.locator('script[src*="/site/globals/global.client-"]')).toHaveCount(1)
  await expect(page.locator('link[rel="stylesheet"][href*="/site/layouts/docs/docs.layout-"]')).toHaveCount(1)
  await expect(page.locator('script[src*="/site/layouts/docs/docs.layout.client-"]')).toHaveCount(1)
  expect(await page.evaluate(async () => {
    const fonts = await document.fonts.load('16px "DSWeiss-Gotisch"')
    return fonts.length > 0 && fonts.every(font => font.status === 'loaded')
  })).toBe(true)
  const links = page.locator('.docs-index a')
  expect(await links.count()).toBeGreaterThan(100)
  const broken = await page.evaluate(async () => {
    const documents = new Map()
    const broken = []
    for (const link of document.querySelectorAll('.docs-index a')) {
      if (!documents.has(link.pathname)) {
        const response = await fetch(link.pathname)
        if (!response.ok) {
          broken.push(link.href)
          continue
        }
        documents.set(link.pathname, new DOMParser().parseFromString(await response.text(), 'text/html'))
      }
      if (link.hash && !documents.get(link.pathname).getElementById(decodeURIComponent(link.hash.slice(1)))) {
        broken.push(link.href)
      }
    }
    return broken
  })
  expect(broken).toEqual([])
  await page.locator('.docs-index a[href="pages/#layouts"]').click()
  await expect(page).toHaveURL(`${siteURL}/docs/pages/#layouts`)
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Pages')
  await expect(nav.locator('a[aria-current="location"]')).toHaveText('Layouts')
  await expect(page.locator('.table-of-contents')).toHaveCount(0)
  await expect(nav.locator('details[open]')).toHaveCount(1)
  await expect(nav.locator('a[href="./#layouts"]')).toBeInViewport()
  // Same hash on a different page must not be marked current.
  await expect(nav.locator('a[aria-current="location"]')).toHaveCount(1)
  const layout = await page.locator('.docs-shell').evaluate(element => {
    const nav = element.querySelector('.docs-navigation').getBoundingClientRect()
    const content = element.querySelector('.docs-content').getBoundingClientRect()
    return { navRight: nav.right, contentLeft: content.left, fits: document.documentElement.scrollWidth <= innerWidth }
  })
  expect(layout.navRight).toBeLessThan(layout.contentLeft)
  expect(layout.fits).toBe(true)
  expect(errors).toEqual([])
})

test('mobile navigation is a keyboard-operable disclosure with cross-page links', async ({ page, siteURL }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${siteURL}/docs/pages/`)
  const disclosure = page.locator('.docs-navigation')
  await expect(disclosure).not.toHaveAttribute('open')
  await disclosure.locator(':scope > summary').focus()
  await page.keyboard.press('Enter')
  await expect(disclosure).toHaveAttribute('open')
  await disclosure.getByRole('link', { name: 'CLI', exact: true }).click()
  await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  await expect(page.locator('.docs-navigation')).not.toHaveAttribute('open')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(page.locator('.docs-navigation')).toHaveAttribute('open')
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('navigation and the expanded documentation index are server-rendered', async ({ page, siteURL }) => {
    test.setTimeout(30_000)
    await page.goto(`${siteURL}/docs/`)
    await page.locator('.docs-index a[href="pages/#layouts"]').click()
    await expect(page).toHaveURL(`${siteURL}/docs/pages/#layouts`)
    const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Pages')
    await nav.getByRole('link', { name: 'CLI', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  })
})
