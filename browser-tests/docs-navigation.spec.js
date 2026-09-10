import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

test('an index section link navigates and selects the matching sidebar entry', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(`${siteURL}/docs/`)
  await page.locator('.docs-index a[href="layouts/#declaring-nested-layouts"]').click()
  await expect(page).toHaveURL(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Layouts')
  await expect(nav.locator('a[aria-current="location"]')).toHaveText('Declaring nested layouts')
})

test('disclosure arrows animate around a stable center and respect reduced motion', async ({ page, siteURL }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(`${siteURL}/docs/layouts/`)
  const summary = page.locator('.docs-navigation summary').filter({ has: page.getByRole('link', { name: 'CLI', exact: true }) })
  const arrowStyle = () => summary.locator('.docs-navigation-chevron').evaluate(element => {
    const style = getComputedStyle(element)
    return {
      width: parseFloat(style.width),
      height: parseFloat(style.height),
      origin: style.transformOrigin,
      transform: style.transform,
      duration: style.transitionDuration,

    }
  })
  const closed = await arrowStyle()
  expect(closed.duration).toBe('0.2s')
  expect(closed.width).toBe(16)
  expect(closed.height).toBe(16)
  const bounds = await summary.boundingBox()
  await summary.click({ position: { x: bounds.width - 16, y: bounds.height / 2 } })
  await expect(summary.locator('..')).toHaveAttribute('open', '')
  await expect.poll(async () => (await arrowStyle()).transform).not.toBe(closed.transform)
  const opened = await arrowStyle()
  expect(opened.width).toBe(closed.width)
  expect(opened.height).toBe(closed.height)
  expect(opened.origin).toBe(closed.origin)
  expect(opened.transform).not.toBe(closed.transform)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => (await arrowStyle()).duration).toBe('0s')
})

test('global bundles and cookbook subpages are linked from the documentation', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(`${siteURL}/docs/`)
  await page.locator('.docs-index a[href="global-bundles/"]').click()
  await expect(page.locator('.docs-content > h1')).toHaveText('Global bundles')
  await expect(page.locator('.docs-navigation a[aria-current="page"]')).toHaveText('Global bundles')

  await page.goto(`${siteURL}/docs/cookbook/`)
  const recipes = await page.locator('.docs-content > ul > li > a').evaluateAll(links => links.map(link => ({
    href: link.href,
    title: link.textContent,
  })))
  expect(recipes).toHaveLength(4)
  for (const recipe of recipes) {
    const response = await page.goto(recipe.href)
    expect(response.status()).toBe(200)
    await expect(page.locator('.docs-content > h1')).toHaveText(recipe.title)
    await expect(page.locator('.docs-navigation a[aria-current="page"]')).toHaveText(recipe.title)
    await expect(page.locator('.docs-navigation nav > ul > li > details[open] > summary')).toHaveText('Recipes')
    await expect(page.locator('.docs-navigation nav > ul > li > details[open] > ul > li > a[aria-current="page"]')).toHaveText(recipe.title)
    await page.getByRole('link', { name: 'All recipes', exact: true }).click()
    await expect(page).toHaveURL(`${siteURL}/docs/cookbook/`)
  }
})

test('mobile navigation manages focus, section links, and return to desktop', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${siteURL}/docs/layouts/`)
  const toggle = page.getByRole('button', { name: 'Open documentation menu' })
  const menu = page.getByRole('dialog', { name: 'Documentation', exact: true })
  const close = menu.getByRole('button', { name: 'Close documentation menu' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(close).toBeFocused()
  // Opening the modal must prevent focus from escaping into the page.
  await toggle.evaluate(el => el.focus())
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  await menu.getByRole('link', { name: 'Layout module exports', exact: true }).click()
  await expect(menu).toBeHidden()
  await expect(page).toHaveURL(`${siteURL}/docs/layouts/#layout-module-exports`)
  await expect(page.locator('#layout-module-exports')).toBeFocused()
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflow)).not.toBe('hidden')

  // Resizing an open menu must restore navigation without leaving a modal or
  // scroll lock behind. The restored links must still work.
  await toggle.click()
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(menu).toBeHidden()
  await expect(toggle).toBeHidden()
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(nav).toBeVisible()
  await expect(nav).toHaveCount(1)
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflow)).not.toBe('hidden')
  await nav.getByRole('link', { name: 'CLI', exact: true }).click()
  await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
})

test('migration links support pointer navigation', async ({ page, siteURL }) => {
  await page.goto(`${siteURL}/docs/migrations/`)
  for (const version of ['v12', 'v11']) {
    await page.locator('.docs-content > ul').getByRole('link', { name: `${version} migration`, exact: true }).click()
    await expect(page).toHaveURL(`${siteURL}/docs/migrations/${version}-migration.html`)
    await page.getByRole('link', { name: 'All migrations', exact: true }).click()
    await expect(page).toHaveURL(`${siteURL}/docs/migrations/`)
  }
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('migration guides are nested and linked through the migrations page', async ({ page, siteURL }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto(`${siteURL}/docs/`)
    await page.locator('.docs-index > ul > li > a[href="migrations/"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.docs-content > h1')).toHaveText('Migrations')
    for (const version of ['v12', 'v11']) {
      await page.locator('.docs-content > ul').getByRole('link', { name: `${version} migration`, exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(`${siteURL}/docs/migrations/${version}-migration.html`)
      await expect(page.locator('.docs-content > h1')).toHaveText(`${version} migration`)
      await expect(page.locator('.docs-navigation a[aria-current="page"]')).toHaveText(`${version} migration`)
      await expect(page.locator('.docs-navigation nav details[open] > summary')).toHaveText('Migrations')
      await expect(page.locator('.docs-breadcrumb').getByRole('link', { name: 'migrations', exact: true })).toHaveAttribute('href', './')
      await page.getByRole('link', { name: 'All migrations', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(`${siteURL}/docs/migrations/`)
    }
  })

  test('the server-rendered index and mobile navigation remain usable', async ({ page, siteURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${siteURL}/docs/`)
    await page.locator('.docs-index a[href="layouts/#declaring-nested-layouts"]').click()
    await expect(page).toHaveURL(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
    await expect(page.getByRole('button', { name: 'Open documentation menu' })).toBeHidden()
    const nav = page.locator('.docs-navigation')
    await expect(nav).toBeVisible()
    await nav.getByRole('link', { name: 'CLI', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  })
})
