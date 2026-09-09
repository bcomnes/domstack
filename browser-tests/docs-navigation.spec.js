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
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toHaveCount(1)
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open documentation menu' })).toBeHidden()
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
  await expect(page.locator('.docs-index > ul > li > a')).toHaveText([
    'CLI', 'Examples', 'Pages', 'Layouts', 'Assets', 'Settings', 'Data',
    'Generation', 'TypeScript', 'Workers', 'API', 'Recipes', 'Implementation',
    'About', 'v12 migration', 'v11 migration',
  ])
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
  await page.locator('.docs-index a[href="layouts/#declaring-nested-layouts"]').click()
  await expect(page).toHaveURL(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Layouts')
  await expect(nav.locator('a[aria-current="location"]')).toHaveText('Declaring nested layouts')
  const currentSection = nav.locator('a[aria-current="location"]')
  await currentSection.hover()
  const padding = await currentSection.evaluate(el => ({
    left: parseFloat(getComputedStyle(el).paddingLeft),
    right: parseFloat(getComputedStyle(el).paddingRight),
  }))
  expect(padding.left).toBeGreaterThan(0)
  expect(padding.right).toBe(padding.left)
  await expect(page.locator('.table-of-contents')).toHaveCount(0)
  await expect(nav.locator('details[open]')).toHaveCount(1)
  await expect(nav.locator('a[href="./#declaring-nested-layouts"]')).toBeInViewport()
  // Same hash on a different page must not be marked current.
  await expect(nav.locator('a[aria-current="location"]')).toHaveCount(1)
  const layout = await page.locator('.docs-shell').evaluate(element => {
    const nav = element.querySelector('.docs-navigation').getBoundingClientRect()
    const content = element.querySelector('.docs-content').getBoundingClientRect()
    return { navRight: nav.right, contentLeft: content.left, fits: document.documentElement.scrollWidth <= innerWidth }
  })
  expect(layout.navRight).toBeLessThanOrEqual(layout.contentLeft)
  expect(layout.fits).toBe(true)
  expect(errors).toEqual([])
})

test('migration guides are page-only links in the index, sidebar, and mobile menu', async ({ page, siteURL }) => {
  await page.goto(`${siteURL}/docs/`)
  for (const version of ['v12', 'v11']) {
    const indexLink = page.locator(`.docs-index a[href="${version}-migration.html"]`)
    await expect(indexLink).toHaveCount(1)
    await expect(indexLink.locator('..').locator('ul')).toHaveCount(0)
    const navLink = page.locator(`.docs-navigation nav > ul > li > a[href="${version}-migration.html"]`)
    await expect(navLink).toHaveText(`${version} migration`)
    await expect(page.locator(`.docs-navigation a[href*="${version}-migration.html#"]`)).toHaveCount(0)
  }
  await page.locator('.docs-index a[href="v12-migration.html"]').click()
  await expect(page.locator('.docs-navigation a[aria-current="page"]')).toHaveText('v12 migration')
  await expect(page.locator('.docs-navigation nav details[open]')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open documentation menu' }).click()
  const menu = page.getByRole('dialog')
  const migration = menu.getByRole('link', { name: 'v11 migration', exact: true })
  await migration.click()
  await expect(page).toHaveURL(`${siteURL}/docs/v11-migration.html`)
  await expect(menu).toBeHidden()
})

test('mobile navigation is a modal menu with keyboard controls and cross-page links', async ({ page, siteURL }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${siteURL}/docs/pages/`)
  const toggle = page.getByRole('button', { name: 'Open documentation menu' })
  const menu = page.getByRole('dialog', { name: 'Documentation', exact: true })
  await expect(menu).toBeHidden()
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const close = menu.getByRole('button', { name: 'Close documentation menu' })
  await expect(close).toBeFocused()
  // A native modal makes the rest of the document inert. It may still let
  // keyboard focus reach browser chrome, which is not a page-focus escape.
  await toggle.evaluate(el => el.focus())
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await menu.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  await menu.getByRole('link', { name: 'CLI', exact: true }).click()
  await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  await expect(menu).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Resizing an open drawer must restore the one navigation tree to the
  // desktop column, without leaving a modal or scroll lock behind.
  await toggle.click()
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(menu).toBeHidden()
  await expect(toggle).toBeHidden()
  await expect(page.locator('.docs-shell > .docs-navigation')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Documentation', exact: true })).toHaveCount(1)
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflow)).not.toBe('hidden')
  await page.locator('.docs-navigation a[aria-current="page"]').focus()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(toggle).toBeFocused()
  await expect(menu).toBeHidden()
})

test('mobile section links close the menu, focus content, and clear the sticky header', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${siteURL}/docs/layouts/`)
  const toggle = page.getByRole('button', { name: 'Open documentation menu' })
  const menu = page.getByRole('dialog')
  await toggle.click()
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflow)).toBe('hidden')
  const sectionLink = menu.getByRole('link', { name: 'Layout module exports', exact: true })
  expect(await sectionLink.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThan(0)
  await menu.getByRole('link', { name: 'Layout module exports', exact: true }).click()
  await expect(menu).toBeHidden()
  await expect(page).toHaveURL(`${siteURL}/docs/layouts/#layout-module-exports`)
  await expect(page.locator('#layout-module-exports')).toBeFocused()
  await expect.poll(async () => page.locator('#layout-module-exports').evaluate(el =>
    el.getBoundingClientRect().top >= document.querySelector('.site-header').getBoundingClientRect().bottom
  )).toBe(true)
  await toggle.click()
  await menu.getByRole('button', { name: 'Close documentation menu' }).click()
  await expect(toggle).toBeFocused()
  await toggle.click()
  // The full-width overlay has no outside click target; unused space stays open.
  await page.mouse.click(385, 400)
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('navigation and the expanded documentation index are server-rendered', async ({ page, siteURL }) => {
    test.setTimeout(30_000)
    await page.goto(`${siteURL}/docs/`)
    await page.locator('.docs-index a[href="layouts/#declaring-nested-layouts"]').click()
    await expect(page).toHaveURL(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
    const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Layouts')
    await nav.getByRole('link', { name: 'CLI', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  })

  test('mobile navigation falls back to an ordinary disclosure', async ({ page, siteURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${siteURL}/docs/pages/`)
    await expect(page.getByRole('button', { name: 'Open documentation menu' })).toBeHidden()
    const nav = page.locator('.docs-navigation')
    await expect(nav).toBeVisible()
    await nav.locator(':scope > summary').click()
    await expect(nav).not.toHaveAttribute('open')
    await nav.locator(':scope > summary').click()
    await nav.getByRole('link', { name: 'CLI', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  })
})
